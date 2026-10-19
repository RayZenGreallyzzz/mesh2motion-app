package com.rayzen.mixamobridge;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * No storage permissions or internet required for model conversion. Android's
 * Storage Access Framework allows the user to choose the destination file.
 * Blob chunks are written to a private temporary file before document creation.
 */
public class MainActivity extends BridgeActivity {
    private static final int REQUEST_SAVE = 9411;
    private volatile File pendingFile;
    private String pendingName = "converted.glb";
    private String pendingMime = "application/octet-stream";
    private FileOutputStream stagingStream;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new ChunkedSaveBridge(), "MixamoSaver");
    }

    private class ChunkedSaveBridge {
        @JavascriptInterface public synchronized String begin(String name, String mime) {
            try {
                if (stagingStream != null) stagingStream.close();
                if (pendingFile != null) pendingFile.delete();
                pendingFile = File.createTempFile("mixamo_", ".tmp", getCacheDir());
                pendingName = name == null ? "converted.glb" : name.replaceAll("[\\\\/\\n\\r]", "_");
                pendingMime = mime == null ? "application/octet-stream" : mime;
                stagingStream = new FileOutputStream(pendingFile);
                return "OK";
            } catch (Exception e) { return "Ошибка подготовки файла: " + e.getMessage(); }
        }
        @JavascriptInterface public synchronized String append(String base64) {
            try {
                if (stagingStream == null) return "Запись не начата";
                byte[] chunk = Base64.decode(base64, Base64.DEFAULT);
                stagingStream.write(chunk);
                return "OK";
            } catch (Exception e) { return "Ошибка записи: " + e.getMessage(); }
        }
        @JavascriptInterface public synchronized void finish() {
            try {
                if (stagingStream == null) throw new IllegalStateException("Файл не открыт");
                stagingStream.flush(); stagingStream.close(); stagingStream = null;
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(pendingMime);
                    intent.putExtra(Intent.EXTRA_TITLE, pendingName);
                    startActivityForResult(intent, REQUEST_SAVE);
                });
            } catch (Exception e) { notifyWeb(false); }
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_SAVE) return;
        Uri uri = data == null ? null : data.getData();
        final File source = pendingFile;
        if (resultCode != Activity.RESULT_OK || uri == null || source == null) {
            if (source != null) source.delete();
            notifyWeb(false);
            return;
        }
        new Thread(() -> {
            boolean ok = false;
            try (InputStream input = new FileInputStream(source);
                 OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("Недоступный файл");
                byte[] buffer = new byte[256 * 1024];
                int length;
                while ((length = input.read(buffer)) != -1) output.write(buffer,0,length);
                output.flush();ok = true;
            } catch (Exception e) { android.util.Log.e("MixamoBridge", "Save failed", e); }
            finally { source.delete();notifyWeb(ok); }
        }, "mixamo-document-save").start();
    }
    private void notifyWeb(boolean succeeded) {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript("window.mixamoNativeSaved && window.mixamoNativeSaved(" + (succeeded ? "true" : "false") + ")",null);
            }
        });
    }
}
