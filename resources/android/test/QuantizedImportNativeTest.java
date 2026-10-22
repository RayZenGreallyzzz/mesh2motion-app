package com.rayzen.riganimationstudio;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** A collapsed integer mesh must fail even if the import UI reports success. */
@RunWith(AndroidJUnit4.class)
public class QuantizedImportNativeTest {
    private ActivityScenario<MainActivity> scenario;
    @After public void close() {
        if (scenario != null) scenario.close();
    }
    @Test public void visiblyRendersQuantizedGlbInOfflineAndroidWebView() throws Exception {
        ConnectivityManager network = InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(ConnectivityManager.class);
        assertNull("Must run with airplane mode enabled", network.getActiveNetwork());
        scenario = ActivityScenario.launch(MainActivity.class);
        awaitTrue("location.pathname.endsWith('/create.html') && !!document.getElementById('model-upload') && !!document.querySelector('canvas')");
        assertEquals("false", evaluate("navigator.onLine"));
        int before = greenPixels();
        byte[] fixture;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("quantized-import-fixture.glb")) {
            fixture = input.readAllBytes();
        }
        String encoded = Base64.encodeToString(fixture, Base64.NO_WRAP);
        evaluate("const bytes=Uint8Array.from(atob('" + encoded + "'),c=>c.charCodeAt(0));" +
                "const transfer=new DataTransfer();transfer.items.add(new File([bytes],'Quantized.glb',{type:'model/gltf-binary'}));" +
                "const input=document.getElementById('model-upload');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));");
        awaitTrue("document.getElementById('load-skeleton-tools').getBoundingClientRect().height > 100 && document.getElementById('load-model-tools').getBoundingClientRect().height === 0");
        // Count the fixture's green surface in actual composited screen pixels.
        // UI completion alone also succeeds with the original collapsed mesh.
        long deadline = System.currentTimeMillis() + 30000;
        int after = before;
        while (System.currentTimeMillis() < deadline) {
            after = greenPixels();
            if (after > before + 2000) return;
            Thread.sleep(300);
        }
        fail("Quantized model is invisible: green pixels before=" + before + ", after=" + after);
    }
    private int greenPixels() {
        Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull("Android screenshot unavailable", bitmap);
        int[] pixels = new int[bitmap.getWidth() * bitmap.getHeight()];
        bitmap.getPixels(pixels, 0, bitmap.getWidth(), 0, 0, bitmap.getWidth(), bitmap.getHeight());
        bitmap.recycle();
        int count = 0;
        for (int pixel : pixels) {
            int green = Color.green(pixel);
            if (green > 120 && green > Color.red(pixel) * 1.2 && green > Color.blue(pixel) * 1.2) count++;
        }
        return count;
    }
    private void awaitTrue(String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 120000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate("Boolean(" + expression + ")"))) return;
            Thread.sleep(150);
        }
        throw new AssertionError("Quantized import UI timeout: " + expression);
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
