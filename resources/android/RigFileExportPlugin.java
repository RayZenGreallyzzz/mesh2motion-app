package com.rayzen.riganimationstudio;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Streams a prepared export to a user-selected Android document. No storage permissions. */
@CapacitorPlugin(name = "RigFileExport")
public class RigFileExportPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private File pendingFile;
    private String pendingId;
    private String pendingName;
    private long expectedSize;
    private boolean picking;

    @Override public void load() {
        File[] stale = getContext().getCacheDir().listFiles((dir, name) -> name.startsWith("rig-export-"));
        if (stale != null) for (File file : stale) {
            if (System.currentTimeMillis() - file.lastModified() > 86400000L) file.delete();
        }
    }

    @PluginMethod public void begin(PluginCall call) {
        io.execute(() -> {
            if (pendingFile != null) { call.reject("Дождитесь завершения текущего сохранения"); return; }
            String name = call.getString("filename", "exported-model.glb").replaceAll("[\\\\/\\p{Cntrl}]", "_");
            long size = call.getData().optLong("size", -1);
            if (size <= 0 || !(name.endsWith(".glb") || name.endsWith(".fbx"))) {
                call.reject("Неверное имя или размер файла"); return;
            }
            try {
                pendingFile = File.createTempFile("rig-export-", ".tmp", getContext().getCacheDir());
                pendingId = UUID.randomUUID().toString();
                pendingName = name;
                expectedSize = size;
                JSObject result = new JSObject(); result.put("id", pendingId); call.resolve(result);
            } catch (Exception error) { clear(); call.reject("Не удалось подготовить файл: " + error.getMessage()); }
        });
    }

    @PluginMethod public void append(PluginCall call) {
        io.execute(() -> {
            if (!matches(call) || picking) { call.reject("Сохранение не активно"); return; }
            long offset = call.getData().optLong("offset", -1);
            String data = call.getString("data", "");
            if (offset != pendingFile.length() || data.length() > 360000) {
                call.reject("Нарушен порядок передачи файла"); return;
            }
            try {
                byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
                if (bytes.length == 0 || offset + bytes.length > expectedSize) throw new IllegalArgumentException("Неверный размер блока");
                try (FileOutputStream output = new FileOutputStream(pendingFile, true)) { output.write(bytes); }
                call.resolve();
            } catch (Exception error) { call.reject("Не удалось подготовить файл: " + error.getMessage()); }
        });
    }

    @PluginMethod public void finish(PluginCall call) {
        io.execute(() -> {
            if (!matches(call) || picking || pendingFile.length() != expectedSize) {
                call.reject("Файл ещё не подготовлен целиком"); return;
            }
            picking = true;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(pendingName.endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream");
            intent.putExtra(Intent.EXTRA_TITLE, pendingName);
            getActivity().runOnUiThread(() -> {
                try { startActivityForResult(call, intent, "documentResult"); }
                catch (Exception error) { io.execute(() -> { clear(); call.reject("Не удалось открыть окно сохранения: " + error.getMessage()); }); }
            });
        });
    }

    @ActivityCallback private void documentResult(PluginCall call, ActivityResult activityResult) {
        io.execute(() -> {
            if (call == null) { clear(); return; }
            if (!matches(call)) { call.reject("Сеанс сохранения завершён"); return; }
            if (activityResult.getResultCode() != Activity.RESULT_OK) {
                clear(); JSObject result = new JSObject(); result.put("status", "cancelled"); call.resolve(result); return;
            }
            Uri uri = activityResult.getData() == null ? null : activityResult.getData().getData();
            if (uri == null) { clear(); call.reject("Android не вернул место сохранения"); return; }
            try {
                long copied = 0;
                try (FileInputStream input = new FileInputStream(pendingFile);
                     OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new java.io.IOException("Нет доступа к выбранной папке");
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) { output.write(buffer, 0, count); copied += count; }
                    output.flush();
                }
                if (copied != expectedSize) throw new java.io.IOException("Записан неполный файл");
                JSObject result = new JSObject(); result.put("status", "saved"); result.put("bytes", copied);
                call.resolve(result);
            } catch (Exception error) { call.reject("Не удалось записать файл: " + error.getMessage()); }
            finally { clear(); }
        });
    }

    @PluginMethod public void abort(PluginCall call) {
        io.execute(() -> { if (matches(call)) clear(); call.resolve(); });
    }

    private boolean matches(PluginCall call) {
        return pendingFile != null && pendingId != null && pendingId.equals(call.getString("id"));
    }
    private void clear() {
        if (pendingFile != null) pendingFile.delete();
        pendingFile = null; pendingId = null; pendingName = null; expectedSize = 0; picking = false;
    }
    @Override protected void handleOnDestroy() {
        io.execute(this::clear);
        io.shutdown();
        super.handleOnDestroy();
    }
}
