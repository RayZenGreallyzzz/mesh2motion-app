package org.mesh2motion.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** All editor assets are bundled. Files enter/leave only through Android's picker. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int OPEN_MODEL = 10;
    private static final int SAVE_MODEL = 11;
    private static final long MAX_EXPORT_BYTES = 256L * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    // Export state is owned by the serial IO executor.
    private File stagedFile;
    private OutputStream stagedStream;
    private String transferId;
    private String filename;
    private String mime;
    private long expectedBytes;
    private long writtenBytes;
    private JavaScriptReplyProxy saveReply;
    private String saveRequestId;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this);
            message.setPadding(32, 64, 32, 32);
            message.setText("Обнови Android System WebView и Chrome через Google Play, затем открой Mesh2Motion снова.");
            setContentView(message);
            return;
        }
        webView = new WebView(this);
        webView.setBackgroundColor(0xff1c3445);
        setContentView(webView);
        // Keep editor controls clear of status/navigation bars, including Android 15.
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // Needed for content:// URIs explicitly selected through the system picker.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = assets.shouldInterceptRequest(request.getUrl());
                if (local != null) return local;
                // No remote scripts, tracking, or network fallback in the native editor.
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isLocal(url)) return false;
                if (request.isForMainFrame() && ("https".equals(url.getScheme()) || "http".equals(url.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                    catch (ActivityNotFoundException ignored) { showError("Не найден браузер для этой ссылки"); }
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                // Android providers often don't register GLB/FBX MIME types.
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, OPEN_MODEL); }
                catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    showError("Не найден системный выбор файлов");
                }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "Mesh2MotionNative", Collections.singleton(ORIGIN),
                (view, message, origin, isMainFrame, reply) -> {
                    if (!isMainFrame || !isLocal(origin)) return;
                    String data = message.getData();
                    io.execute(() -> handleMessage(data, reply));
                });
        }
        webView.loadUrl(ORIGIN + "/create.html");
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void handleMessage(String data, JavaScriptReplyProxy reply) {
        String id = "";
        try {
            JSONObject message = new JSONObject(data);
            id = message.getString("id");
            String action = message.getString("action");
            String transfer = message.getString("transfer");
            if ("begin".equals(action)) {
                if (stagedFile != null) throw new IOException("Дождись завершения текущего сохранения");
                long size = message.getLong("size");
                if (size < 1 || size > MAX_EXPORT_BYTES) throw new IOException("Размер экспорта должен быть от 1 байта до 256 МБ");
                filename = message.getString("filename").replaceAll("[\\\\/\\p{Cntrl}]", "_");
                if (!(filename.endsWith(".glb") || filename.endsWith(".fbx"))) throw new IOException("Неподдерживаемый формат экспорта");
                mime = filename.endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream";
                transferId = transfer;
                expectedBytes = size;
                writtenBytes = 0;
                stagedFile = File.createTempFile("m2m-export-", ".tmp", getCacheDir());
                stagedStream = new FileOutputStream(stagedFile);
            } else if ("cancel".equals(action)) {
                if (transfer.equals(transferId)) clearExport();
            } else {
                if (!transfer.equals(transferId) || stagedFile == null) throw new IOException("Сохранение не начато");
                if ("chunk".equals(action)) {
                    String chunk = message.getString("data");
                    if (stagedStream == null || chunk.length() > 262144 || message.getLong("offset") != writtenBytes)
                        throw new IOException("Нарушен порядок данных экспорта");
                    byte[] bytes = Base64.decode(chunk, Base64.NO_WRAP);
                    if (writtenBytes + bytes.length > expectedBytes) throw new IOException("Неверный размер экспорта");
                    stagedStream.write(bytes);
                    writtenBytes += bytes.length;
                } else if ("finish".equals(action)) {
                    if (writtenBytes != expectedBytes || stagedStream == null) throw new IOException("Экспорт передан не полностью");
                    stagedStream.close();
                    stagedStream = null;
                    saveReply = reply;
                    saveRequestId = id;
                    runOnUiThread(() -> {
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType(mime);
                        intent.putExtra(Intent.EXTRA_TITLE, filename);
                        try { startActivityForResult(intent, SAVE_MODEL); }
                        catch (ActivityNotFoundException error) {
                            io.execute(() -> completeSave(null, "Не найден системный выбор файлов"));
                        }
                    });
                    return;
                } else throw new IOException("Неизвестное действие");
            }
            sendReply(reply, id, null, false);
        } catch (Exception error) {
            sendReply(reply, id, error.getMessage(), false);
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_MODEL && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        } else if (request == SAVE_MODEL) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            io.execute(() -> completeSave(uri, null));
        }
    }

    private void completeSave(Uri uri, String failure) {
        JavaScriptReplyProxy reply = saveReply;
        String id = saveRequestId;
        try {
            if (failure != null) throw new IOException(failure);
            if (uri != null) {
                try (FileInputStream input = new FileInputStream(stagedFile);
                     OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException("Не удалось открыть файл для записи");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
            }
            sendReply(reply, id, uri == null ? "Сохранение отменено" : null, uri == null);
        } catch (Exception error) {
            sendReply(reply, id, "Не удалось сохранить: " + error.getMessage(), false);
        } finally { clearExport(); }
    }

    private void clearExport() {
        try { if (stagedStream != null) stagedStream.close(); } catch (IOException ignored) { }
        if (stagedFile != null) stagedFile.delete();
        stagedStream = null;
        stagedFile = null;
        transferId = null;
        saveReply = null;
        saveRequestId = null;
    }

    private void sendReply(JavaScriptReplyProxy reply, String id, String error, boolean cancelled) {
        if (reply == null) return;
        JSONObject result = new JSONObject();
        try {
            result.put("id", id);
            result.put("ok", error == null);
            result.put("error", error);
            result.put("cancelled", cancelled);
        } catch (Exception ignored) { return; }
        runOnUiThread(() -> {
            if (!isDestroyed() && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                reply.postMessage(result.toString());
            }
        });
    }

    private void showError(String text) {
        new AlertDialog.Builder(this).setMessage(text).setPositiveButton("OK", null).show();
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else new AlertDialog.Builder(this).setMessage("Закрыть редактор? Несохранённая работа будет потеряна.")
                .setNegativeButton("Остаться", null).setPositiveButton("Закрыть", (dialog, which) -> finish()).show();
    }

    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (webView != null) webView.destroy();
        io.execute(this::clearExport);
        io.shutdown();
        super.onDestroy();
    }
}
