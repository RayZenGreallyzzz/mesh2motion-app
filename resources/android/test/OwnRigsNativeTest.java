package com.rayzen.riganimationstudio;

import static org.junit.Assert.*;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasAction;
import android.app.Activity;
import android.app.Instrumentation.ActivityResult;
import android.content.Intent;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.util.Base64;
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

/** Real offline WebView, IndexedDB, activity restart and Android document writer. */
@RunWith(AndroidJUnit4.class)
public class OwnRigsNativeTest {
    private ActivityScenario<MainActivity> scenario;
    private static final Uri OUTPUT = Uri.parse("content://com.rayzen.riganimationstudio.export.test/saved.glb");
    @Before public void launch() throws Exception {
        Intents.init();
        openActivity();
    }
    @After public void close() {
        if (scenario != null) scenario.close();
        Intents.release();
    }
    private void openActivity() throws Exception {
        scenario = ActivityScenario.launch(MainActivity.class);
        awaitTrue("location.pathname.endsWith('/create.html') && !!window.Capacitor?.nativePromise");
        evaluate("location.href='/my-rigs/index.html'");
        awaitTrue("document.getElementById('model-file') && document.querySelector('#viewport canvas') && !!window.Capacitor?.nativePromise");
    }
    @Test public void importsKeepsLibraryAfterRestartAndExportsOwnRigOffline() throws Exception {
        ConnectivityManager network = InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(ConnectivityManager.class);
        assertNull("Must run with airplane mode enabled", network.getActiveNetwork());
        assertEquals("false", evaluate("navigator.onLine"));
        byte[] fixture;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("own-rig-fixture.glb")) {
            fixture = input.readAllBytes();
        }
        String encoded = Base64.encodeToString(fixture, Base64.NO_WRAP);
        evaluate("const bytes=Uint8Array.from(atob('" + encoded + "'),c=>c.charCodeAt(0));" +
                "const transfer=new DataTransfer();transfer.items.add(new File([bytes],'OfflineCreature.glb',{type:'model/gltf-binary'}));" +
                "const input=document.getElementById('model-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));");
        awaitTrue("document.getElementById('clip-count').textContent==='2' && !document.getElementById('save-library').disabled");
        evaluate("document.querySelector('#clips button').click();document.getElementById('save-library').click()");
        awaitTrue("document.getElementById('status').textContent.startsWith('Копия сохранена')");
        scenario.close();
        scenario = null;
        openActivity();
        evaluate("document.getElementById('library-tab').click()");
        awaitTrue("document.querySelector('.library-card button')");
        evaluate("document.querySelector('.library-card button').click()");
        awaitTrue("document.getElementById('clip-count').textContent==='2' && !document.getElementById('export').disabled");
        evaluate("document.querySelector('#clips button').click()");
        awaitTrue("parseFloat(document.getElementById('time').textContent)>0.1");
        intending(hasAction(Intent.ACTION_CREATE_DOCUMENT)).respondWith(new ActivityResult(Activity.RESULT_OK, new Intent().setData(OUTPUT)));
        evaluate("document.getElementById('export').click()");
        awaitTrue("document.getElementById('status').textContent.startsWith('GLB сохранён')");
        byte[] bytes;
        android.content.ContentResolver resolver = InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
        try (InputStream input = resolver.openInputStream(OUTPUT)) {
            assertNotNull(input);
            bytes = input.readAllBytes();
        }
        ByteBuffer header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(0x46546c67, header.getInt(0));
        assertEquals(bytes.length, header.getInt(8));
        JSONObject gltf = new JSONObject(new String(bytes, 20, header.getInt(12), StandardCharsets.UTF_8));
        assertEquals(2, gltf.getJSONArray("skins").length());
        assertEquals(2, gltf.getJSONArray("animations").length());
        assertEquals(4, gltf.getJSONArray("animations").getJSONObject(0).getJSONArray("channels").length());
        assertEquals(1, gltf.getJSONArray("animations").getJSONObject(1).getJSONArray("channels").length());
        resolver.delete(OUTPUT, null, null);
    }
    private void awaitTrue(String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 120000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate("Boolean(" + expression + ")"))) return;
            Thread.sleep(150);
        }
        throw new AssertionError("Own rigs UI timeout: " + expression + "; status=" + evaluate("document.getElementById('status')?.textContent"));
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
