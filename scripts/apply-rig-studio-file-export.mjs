import { copyFile, mkdir, writeFile } from 'node:fs/promises'
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
console.log('Registered Android document export plugin')
