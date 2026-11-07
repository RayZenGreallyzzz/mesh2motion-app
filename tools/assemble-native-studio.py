"""Privately add the owner's engine to a compiled Studio APK; align/sign afterwards."""
import argparse,hashlib,pathlib,zipfile

p=argparse.ArgumentParser();p.add_argument('--shell',required=True);p.add_argument('--engine-apk',required=True);p.add_argument('--out',required=True);a=p.parse_args()
engine_path='lib/arm64-v8a/libriggerdroid_rigger.so'
with zipfile.ZipFile(a.shell) as shell,zipfile.ZipFile(a.engine_apk) as supplied,zipfile.ZipFile(a.out,'w') as out:
    engine=supplied.read(engine_path)
    if hashlib.sha256(engine).hexdigest()!='de2c3c4f795441784a3a908a5988c583b85d008253514dc9c01d4831b4041963':raise ValueError('Engine version does not match this integration')
    for info in shell.infolist():
        name=info.filename
        if name==engine_path:continue
        if name.startswith('META-INF/') and (name.upper().endswith(('.SF','.RSA','.DSA','.EC')) or name.upper()=='META-INF/MANIFEST.MF'):continue
        out.writestr(info,shell.read(info))
    out.writestr(engine_path,engine,compress_type=zipfile.ZIP_STORED)
    for name in ['NOTICE.txt','DEPENDENCIES.txt','APACHE-2.0.txt']:
        out.writestr('assets/native-engine/licenses/'+name,supplied.read('assets/probe/licenses/'+name),compress_type=zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(a.shell) as before,zipfile.ZipFile(a.out) as after:
    for info in before.infolist():
        if info.filename.startswith('assets/public/'):
            assert before.read(info)==after.read(info.filename),'Studio asset changed during native assembly: '+info.filename
print('Private native module added; all existing Studio web assets preserved. APK still requires alignment and signing.')
