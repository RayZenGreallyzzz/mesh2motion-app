package com.rayzen.riganimationstudio;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

/** Test APK only: exercises ContentResolver writes to a document content URI. */
public class ExportTestProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"/saved.glb".equals(uri.getPath())) throw new FileNotFoundException("Test provider denies write");
        return ParcelFileDescriptor.open(new File(getContext().getCacheDir(), "saved.glb"),
                ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_WRITE_ONLY);
    }
    @Override public String getType(Uri uri) { return "model/gltf-binary"; }
    @Override public Cursor query(Uri uri, String[] p, String s, String[] a, String o) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
