package org.mesh2motion.android;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Offline Android shell for the Vite/Three.js application. Loading resources
 * from the HTTPS-like appassets origin gives JS modules and GLB files a valid
 * same-origin URL. Imported models use Android's Storage Access Framework.
 */
public final class MainActivity extends Activity {
    private static final int IMPORT_REQUEST = 1001;
    private static final int EXPORT_REQUEST = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> importCallback;
    private final Object saveLock = new Object();
    private File pendingSave;
    private OutputStream pendingStream;
    private String pendingName;
    private String pendingMime;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);

        webView = new WebView(this);
        webView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        setContentView(webView);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        final WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("appassets.androidplatform.net".equals(url.getHost())) return false;
                // Avoid exposing the Android JS bridge to untrusted websites.
                if ("https".equals(url.getScheme()) || "http".equals(url.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, url));
                    } catch (Exception ignored) {}
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                    ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (importCallback != null) importCallback.onReceiveValue(null);
                importCallback = callback;

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                String[] types = params.getAcceptTypes();
                if (types != null && types.length > 0 && types[0].contains("/")) {
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
                }
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                        params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(intent, IMPORT_REQUEST);
                } catch (Exception ex) {
                    importCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Cannot open a model", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });

        // The JS interface exposes only explicit save methods; it has no
        // arbitrary file-system read or code-execution operation.
        webView.addJavascriptInterface(new AndroidFileBridge(), "Mesh2MotionAndroid");
        webView.loadUrl("https://appassets.androidplatform.net/index.html");
    }

    private final class AndroidFileBridge {
        @JavascriptInterface
        public boolean beginSave(String name, String mimeType) {
            synchronized (saveLock) {
                if (pendingSave != null) return false;
                try {
                    pendingSave = File.createTempFile("mesh2motion-", ".tmp", getCacheDir());
                    pendingStream = new FileOutputStream(pendingSave);
                    pendingName = sanitizeFilename(name);
                    pendingMime = mimeType != null && !mimeType.isEmpty()
                            ? mimeType : "application/octet-stream";
                    return true;
                } catch (Exception ex) {
                    clearPendingSave();
                    return false;
                }
            }
        }

        @JavascriptInterface
        public boolean appendChunk(String base64) {
            synchronized (saveLock) {
                if (pendingStream == null) return false;
                try {
                    pendingStream.write(Base64.decode(base64, Base64.DEFAULT));
                    return true;
                } catch (Exception ex) {
                    clearPendingSave();
                    return false;
                }
            }
        }

        @JavascriptInterface
        public void finishSave() {
            synchronized (saveLock) {
                if (pendingStream == null) return;
                try {
                    pendingStream.close();
                    pendingStream = null;
                } catch (Exception ex) {
                    clearPendingSave();
                    return;
                }
            }
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(pendingMime);
                intent.putExtra(Intent.EXTRA_TITLE, pendingName);
                try {
                    startActivityForResult(intent, EXPORT_REQUEST);
                } catch (Exception ex) {
                    synchronized (saveLock) { clearPendingSave(); }
                    Toast.makeText(MainActivity.this, "Cannot save exported file", Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void cancelSave() {
            synchronized (saveLock) { clearPendingSave(); }
        }
    }

    private String sanitizeFilename(String input) {
        String result = input == null ? "" : input.replaceAll("[\\\\/\\r\\n]", "_");
        return result.isEmpty() ? "mesh2motion.glb" : result;
    }

    private void clearPendingSave() {
        // Called while holding saveLock (reentrant for Java synchronized).
        if (pendingStream != null) {
            try { pendingStream.close(); } catch (Exception ignored) {}
        }
        pendingStream = null;
        if (pendingSave != null) pendingSave.delete();
        pendingSave = null;
        pendingName = null;
        pendingMime = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == IMPORT_REQUEST) {
            if (importCallback == null) return;
            Uri[] selected = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    selected = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        selected[i] = clip.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    selected = new Uri[]{data.getData()};
                }
            }
            importCallback.onReceiveValue(selected);
            importCallback = null;
        } else if (requestCode == EXPORT_REQUEST) {
            final Uri target = resultCode == RESULT_OK && data != null ? data.getData() : null;
            final File local;
            synchronized (saveLock) {
                local = pendingSave;
                // Keep the file on disk until the asynchronous copy finishes.
                pendingSave = null;
                pendingName = null;
                pendingMime = null;
            }
            if (local == null) return;
            if (target == null) {
                local.delete();
                return;
            }
            new Thread(() -> {
                boolean ok = false;
                try (InputStream in = new FileInputStream(local);
                     OutputStream out = getContentResolver().openOutputStream(target)) {
                    if (out == null) throw new IllegalStateException("No output stream");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = in.read(buffer)) != -1) {
                        out.write(buffer, 0, count);
                    }
                    ok = true;
                } catch (Exception ignored) {
                    // The user still has their original model in the WebView.
                } finally {
                    local.delete();
                }
                final boolean success = ok;
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        success ? "Model saved" : "Unable to save model", Toast.LENGTH_LONG).show());
            }).start();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        synchronized (saveLock) { clearPendingSave(); }
        if (importCallback != null) {
            importCallback.onReceiveValue(null);
            importCallback = null;
        }
        webView.destroy();
        super.onDestroy();
    }
}
