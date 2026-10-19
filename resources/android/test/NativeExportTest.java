package com.rayzen.riganimationstudio;

import static org.junit.Assert.*;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.intent.Intents.intended;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasAction;
import android.app.Activity;
import android.app.Instrumentation.ActivityResult;
import android.content.Intent;
import android.net.Uri;
import android.net.ConnectivityManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.espresso.intent.Intents;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class NativeExportTest {
    private ActivityScenario<MainActivity> scenario;
    private static final String URI = "content://com.rayzen.riganimationstudio.export.test/";
    @Before public void launch() throws Exception {
        Intents.init();
        scenario = ActivityScenario.launch(MainActivity.class);
        long deadline = System.currentTimeMillis() + 60000;
        while (!"true".equals(evaluate("document.readyState === 'complete' && location.pathname.endsWith('/create.html') && !!window.Capacitor?.nativePromise"))) {
            if (System.currentTimeMillis() > deadline) fail("WebView and real Capacitor bridge did not become ready");
            Thread.sleep(150);
        }
    }
    @After public void close() {
        if (scenario != null) scenario.close();
        Intents.release();
    }
    @Test public void writesExactBytesThroughRealBridgeAndContentResolver() throws Exception {
        intending(hasAction(Intent.ACTION_CREATE_DOCUMENT)).respondWith(new ActivityResult(Activity.RESULT_OK,
                new Intent().setData(Uri.parse(URI + "saved.glb"))));
        JSONObject result = export();
        assertEquals(result.toString(), "saved", result.optString("status"));
        // Read back through the document provider: instrumentation and provider contexts
        // may have different cache directories despite belonging to the same test APK.
        android.content.ContentResolver resolver = InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
        byte[] bytes;
        try (InputStream input = resolver.openInputStream(Uri.parse(URI + "saved.glb"))) {
            assertNotNull(input);
            bytes = input.readAllBytes();
        }
        assertEquals(524305, bytes.length);
        for (int i = 0; i < bytes.length; i++) assertEquals("Byte " + i, (i * 13) % 256, bytes[i] & 255);
        intended(hasAction(Intent.ACTION_CREATE_DOCUMENT));
        assertEquals(1, resolver.delete(Uri.parse(URI + "saved.glb"), null, null));
    }
    @Test public void cancellationReturnsCancelledAndAllowsAnotherExport() throws Exception {
        intending(hasAction(Intent.ACTION_CREATE_DOCUMENT)).respondWith(new ActivityResult(Activity.RESULT_CANCELED, null));
        assertEquals("cancelled", export().optString("status"));
        assertEquals("cancelled", export().optString("status"));
    }
    @Test public void providerWriteFailureRejectsInsteadOfReportingSuccess() throws Exception {
        intending(hasAction(Intent.ACTION_CREATE_DOCUMENT)).respondWith(new ActivityResult(Activity.RESULT_OK,
                new Intent().setData(Uri.parse(URI + "denied.glb"))));
        JSONObject result = export();
        assertEquals(result.toString(), "error", result.optString("status"));
        assertTrue(result.optString("message").contains("Не удалось записать файл"));
    }
    @Test public void rigsAnimatesAndSavesGlbFromFreshOfflineLaunch() throws Exception {
        ConnectivityManager connectivity = InstrumentationRegistry.getInstrumentation()
                .getTargetContext().getSystemService(ConnectivityManager.class);
        assertNull("Android must have no active network, not just an offline UI flag", connectivity.getActiveNetwork());
        assertEquals("Emulator must have Wi-Fi and mobile data disabled", "false", evaluate("navigator.onLine"));
        intending(hasAction(Intent.ACTION_CREATE_DOCUMENT)).respondWith(new ActivityResult(Activity.RESULT_OK,
                new Intent().setData(Uri.parse(URI + "saved.glb"))));
        evaluate("document.getElementById('model-selection').value='models/model-human.glb';document.getElementById('load-model-button').click()");
        awaitTrue("document.getElementById('skeleton-selection').getClientRects().length > 0");
        evaluate("const select=document.getElementById('skeleton-selection');select.value='human-mobile-female';select.dispatchEvent(new Event('change',{bubbles:true}));");
        awaitTrue("!document.getElementById('load-skeleton-button').disabled");
        evaluate("document.getElementById('load-skeleton-button').click()");
        awaitTrue("document.getElementById('autorig-humanoid-button')?.getClientRects().length > 0");
        evaluate("document.getElementById('autorig-humanoid-button').click()");
        awaitTrue("document.getElementById('action_bind_pose').getClientRects().length > 0 && !document.getElementById('action_bind_pose').disabled");
        evaluate("document.getElementById('action_bind_pose').click()");
        awaitTrue("document.getElementById('action_weights_to_animations').getClientRects().length > 0 && !document.getElementById('action_weights_to_animations').closest('[inert]')");
        evaluate("document.getElementById('action_weights_to_animations').click()");
        awaitTrue("document.querySelectorAll('#animations-items .anim-play-button').length >= 178");
        evaluate("document.querySelector('#animations-items .anim-play-button').click();document.querySelector('#animations-items input[type=checkbox]').click();");
        awaitTrue("!document.getElementById('export-button').disabled");
        evaluate("document.getElementById('export-button').click()");
        awaitTrue("document.getElementById('rig-export-notice')?.classList.contains('export-notice-success')");
        android.content.ContentResolver resolver = InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
        byte[] bytes;
        try (InputStream input = resolver.openInputStream(Uri.parse(URI + "saved.glb"))) {
            assertNotNull(input);
            bytes = input.readAllBytes();
        }
        ByteBuffer header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(0x46546c67, header.getInt(0));
        assertEquals(bytes.length, header.getInt(8));
        JSONObject gltf = new JSONObject(new String(bytes, 20, header.getInt(12), StandardCharsets.UTF_8));
        assertEquals(1, gltf.getJSONArray("animations").length());
        assertTrue(gltf.getJSONArray("skins").length() > 0);
        assertTrue(gltf.getJSONArray("meshes").length() > 0);
        intended(hasAction(Intent.ACTION_CREATE_DOCUMENT));
        resolver.delete(Uri.parse(URI + "saved.glb"), null, null);
    }
    private void awaitTrue(String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 120000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate("Boolean(" + expression + ")"))) return;
            Thread.sleep(150);
        }
        throw new AssertionError("Offline UI did not finish: " + expression + "; notice=" + evaluate("document.getElementById('rig-export-notice')?.textContent"));
    }
    private JSONObject export() throws Exception {
        evaluate("window.__nativeExportResult = null; (async () => { let id; try {" +
                "const invoke = (method, data) => Capacitor.nativePromise('RigFileExport', method, data);" +
                "const size = 524305; ({id} = await invoke('begin', {filename:'monster.glb', size}));" +
                "for (let offset=0; offset<size; offset+=262144) { let raw='';" +
                "for(let i=offset;i<Math.min(size,offset+262144);i++) raw+=String.fromCharCode((i*13)%256);" +
                "await invoke('append',{id,offset,data:btoa(raw)}); }" +
                "window.__nativeExportResult = await invoke('finish',{id});" +
                "} catch(error) { window.__nativeExportResult={status:'error',message:error.message}; }" +
                "finally { if(id) await Capacitor.nativePromise('RigFileExport','abort',{id}); } })();");
        long deadline = System.currentTimeMillis() + 60000;
        while (System.currentTimeMillis() < deadline) {
            String value = evaluate("window.__nativeExportResult || null");
            if (!"null".equals(value)) return new JSONObject(value);
            Thread.sleep(100);
        }
        throw new AssertionError("Native export did not finish");
    }
    private String evaluate(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script,
                value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView callback timeout", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }
}
