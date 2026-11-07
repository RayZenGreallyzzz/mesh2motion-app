import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
const root = 'android/app/src/main', java = `${root}/java`
for (const [source, target] of [
  ['resources/android/nativeengine', `${java}/com/rayzen/riganimationstudio/nativeengine`],
  ['resources/android/nativeengine-jni', `${java}/dev/unicorn/rigger/android`]
]) {
  await mkdir(target, { recursive: true })
  for (const name of await readdir(source)) if (name.endsWith('.java')) await copyFile(`${source}/${name}`, `${target}/${name}`)
}
const activity = `${java}/com/rayzen/riganimationstudio/MainActivity.java`
let text = await readFile(activity, 'utf8')
if (!text.includes('registerPlugin(NativeRigPlugin.class)')) {
  if (!text.includes('registerPlugin(RigFileExportPlugin.class);')) throw new Error('Register the document export plugin first')
  text = text.replace('import android.os.Bundle;', 'import android.os.Bundle;\nimport com.rayzen.riganimationstudio.nativeengine.NativeRigPlugin;')
  text = text.replace('registerPlugin(RigFileExportPlugin.class);', 'registerPlugin(RigFileExportPlugin.class);\n        registerPlugin(NativeRigPlugin.class);')
  await writeFile(activity, text)
}
const manifestPath = `${root}/AndroidManifest.xml`
let manifest = await readFile(manifestPath, 'utf8')
if (!manifest.includes('nativeengine.NativeRigWorker')) manifest = manifest.replace('</application>', '    <service android:name="com.rayzen.riganimationstudio.nativeengine.NativeRigWorker" android:exported="false" android:process=":nativeRig" />\n    </application>')
if (!manifest.includes('android:largeHeap=')) manifest = manifest.replace('<application', '<application android:largeHeap="true"')
if (!manifest.includes('android:extractNativeLibs=')) manifest = manifest.replace('<application', '<application android:extractNativeLibs="true"')
await writeFile(manifestPath, manifest)
console.log('Registered isolated native rig engine plugin; vendor binary must be supplied privately before final APK signing.')
