package com.rayzen.riganimationstudio;

import static org.junit.Assert.*;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.intent.Intents.intended;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasAction;
import android.app.Activity;
import android.app.Instrumentation.ActivityResult;
import android.content.Intent;
import android.net.Uri;
import androidx.test.core.app.ActivityScenario;
import androidx.test.espresso.intent.Intents;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.InputStream;
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
        while (!"true".equals(evaluate("location.pathname.endsWith('/create.html') && !!window.Capacitor?.nativePromise"))) {
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
