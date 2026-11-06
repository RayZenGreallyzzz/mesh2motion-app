"""Add a validated private web build to an existing native shell; sign separately."""
import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--base-apk', required=True)
parser.add_argument('--web', required=True)
parser.add_argument('--catalog', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
web = Path(args.web).resolve()
catalog = json.loads(Path(args.catalog).read_text())
for pack in catalog:
    p = web / pack['path']
    b = p.read_bytes()
    d = json.loads(b[20:20 + struct.unpack_from('<I', b, 12)[0]])
    assert len(d.get('animations', [])) == pack['clips'], pack['id']
    assert len(set(j for s in d['skins'] for j in s['joints'])) == pack['bones'], pack['id']


def replace_strings(data):
    for old, new in [
        ('com.rayzen.riganimationstudio.v814test', 'com.rayzen.riganimationstudio.v815test'),
        ('Rig Studio v8.1.4 Test', 'Rig Studio v8.1.6 Test'),
        ('8.1.4', '8.1.6'),
    ]:
        for encoding in ('utf-8', 'utf-16le'):
            a, b = old.encode(encoding), new.encode(encoding)
            assert len(a) == len(b)
            data = data.replace(a, b)
    return data


def patch_version_code(data):
    data = bytearray(data)
    cursor, strings, resources = 8, [], []
    while cursor + 8 <= len(data):
        kind, header, size = struct.unpack_from('<HHI', data, cursor)
        if kind == 0x0180:
            resources = list(struct.unpack_from('<' + 'I' * ((size - header) // 4), data, cursor + header))
        if kind == 0x0102:
            start, attr_size, count = struct.unpack_from('<HHH', data, cursor + 24)
            for i in range(count):
                pos = cursor + 16 + start + i * attr_size
                name = struct.unpack_from('<I', data, pos + 4)[0]
                if name < len(resources) and resources[name] == 0x0101021b:
                    assert struct.unpack_from('<I', data, pos + 16)[0] == 814
                    struct.pack_into('<I', data, pos + 16, 816)
        if size < 8:
            raise ValueError('Invalid manifest chunk')
        cursor += size
    return bytes(data)


out = Path(args.output)
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.base_apk) as base, zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
    for item in base.infolist():
        if item.filename.startswith('META-INF/'):
            continue
        if item.filename.startswith('assets/public/'):
            # Capacitor sync injects these native compatibility shims after
            # Vite builds dist. They are not public source/static files.
            relative = item.filename[len('assets/public/'):]
            if relative in ('cordova.js', 'cordova_plugins.js') and not (web / relative).is_file():
                target.writestr(item, base.read(item))
            continue
        content = base.read(item)
        if item.filename == 'AndroidManifest.xml':
            content = patch_version_code(replace_strings(content))
        elif item.filename == 'resources.arsc':
            content = replace_strings(content)
        target.writestr(item, content)
    for path in sorted(web.rglob('*')):
        if not path.is_file() or path.name.endswith('.map'):
            continue
        target.write(path, 'assets/public/' + path.relative_to(web).as_posix())

with zipfile.ZipFile(out) as check:
    for pack in catalog:
        name = 'assets/public/' + pack['path']
        assert check.read(name) == (web / pack['path']).read_bytes(), name
print(json.dumps({'unsigned_apk': str(out), 'bytes': out.stat().st_size, 'pack_files': len(catalog), 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}))
