import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
const root = 'android/app/src/androidTest'
const dir = `${root}/java/com/rayzen/riganimationstudio`
await mkdir(dir, { recursive: true })
for (const file of ['NativeExportTest.java', 'ExportTestProvider.java']) {
  await copyFile(`resources/android/test/${file}`, `${dir}/${file}`)
}
await writeFile(`${root}/AndroidManifest.xml`, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
 <application><provider android:name="com.rayzen.riganimationstudio.ExportTestProvider"
   android:authorities="com.rayzen.riganimationstudio.export.test" android:exported="true" /></application>
</manifest>
`)
const gradle = 'android/app/build.gradle'
const original = await readFile(gradle, 'utf8')
await writeFile(gradle, original + `
android { defaultConfig { testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner" } }
dependencies {
    androidTestImplementation 'androidx.test:runner:1.7.0'
    androidTestImplementation 'androidx.test.ext:junit:1.3.0'
    androidTestImplementation 'androidx.test.espresso:espresso-intents:3.7.0'
}
`)
