import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
const path = 'android/app/src/main/java/com/rayzen/riganimationstudio'
await mkdir(path, { recursive: true })
await copyFile('resources/android/RigFileExportPlugin.java', `${path}/RigFileExportPlugin.java`)
await writeFile(`${path}/MainActivity.java`, `package com.rayzen.riganimationstudio;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RigFileExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`)
// Without this normal permission WebView can report navigator.onLine=true in
// airplane mode. It only reads connectivity; it does not enable the network.
const manifest_path = 'android/app/src/main/AndroidManifest.xml'
const manifest = await readFile(manifest_path, 'utf8')
if (!manifest.includes('android.permission.ACCESS_NETWORK_STATE')) {
  if (!manifest.includes('</manifest>')) throw new Error('Invalid Android manifest')
  await writeFile(manifest_path, manifest.replace('</manifest>',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n</manifest>'))
}
console.log('Registered Android document export plugin')
