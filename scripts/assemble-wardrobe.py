"""Repackage the Studio Capacitor host with the separate Wardrobe application."""
from argparse import ArgumentParser
from copy import copy
from io import BytesIO
import json
from pathlib import Path
import struct
from zipfile import ZIP_DEFLATED, ZipFile

from PIL import Image, ImageDraw

OLD = 'com.rayzen.riganimationstudio.humanoid65test'
APP = 'com.rayzen.riganimationstudio.wardrobestudio'
OLD_VERSION = '8.2.10-rig-motion-test'
VERSION = '0.3.0-wardrobe-preview'
LABEL = 'Wardrobe Studio 01'
PUBLIC = 'assets/public/'
ROOT = Path(__file__).resolve().parent.parent


def versioned_manifest(data):
    old, new = (value.encode('utf-16le') for value in (OLD, APP))
    before, after = (value.encode('utf-16le') for value in (OLD_VERSION, VERSION))
    assert len(old) == len(new) and data.count(old) == 4
    assert len(before) == len(after) and data.count(before) == 1
    out = bytearray(data.replace(old, new).replace(before, after))
    offset = struct.unpack_from('<H', out, 2)[0]
    attributes, changed = [], 0
    while offset < len(out):
        kind, header, size = struct.unpack_from('<HHI', out, offset)
        assert 8 <= header <= size <= len(out) - offset
        if kind == 0x0180:
            attributes = [i for (i,) in struct.iter_unpack('<I', out[offset + header:offset + size])]
        if kind == 0x0102:
            start, width, count = struct.unpack_from('<HHH', out, offset + 24)
            for i in range(count):
                at = offset + 16 + start + width * i
                name = struct.unpack_from('<I', out, at + 4)[0]
                if name < len(attributes) and attributes[name] == 0x0101021b:
                    assert out[at + 15] == 0x10 and struct.unpack_from('<I', out, at + 16)[0] == 830
                    struct.pack_into('<I', out, at + 16, 3)
                    changed += 1
        offset += size
    assert changed == 1
    return out


def resource_table(data):
    from_resources, to_resources = (value.encode('utf-16le') for value in (OLD, APP))
    old_label, label = b'Rig Studio 65 Test', LABEL.encode()
    assert data.count(from_resources) == data.count(old_label) == 1 and len(old_label) == len(label)
    return data.replace(from_resources, to_resources).replace(old_label, label)


def icon(name, data):
    width, height = Image.open(BytesIO(data)).size
    canvas = Image.new('RGBA', (288, 288))
    draw = ImageDraw.Draw(canvas)
    foreground = '_foreground' in name
    if not foreground:
        if '_round' in name:
            draw.ellipse((0, 0, 287, 287), fill='#101b2d')
        else:
            draw.rounded_rectangle((0, 0, 287, 287), radius=48, fill='#101b2d')
        draw.rounded_rectangle((34, 34, 254, 254), radius=45, outline='#3f756c', width=5)
    draw.polygon([(78,103),(116,84),(130,101),(158,101),(172,84),(210,103),(232,143),(192,166),
                  (187,151),(187,208),(101,208),(101,151),(96,166),(56,143)], fill='#a1e9d2')
    draw.line([(122,84),(134,92),(154,92),(166,84)], fill='#467d70', width=6)
    result = BytesIO()
    canvas.resize((width,height), Image.Resampling.LANCZOS).save(result, format='PNG', optimize=True)
    return result.getvalue()


def build(base, target):
    dist = ROOT / 'wardrobe-dist'
    entry = (dist / 'wardrobe/index.html').read_bytes().replace(b'../assets/', b'./assets/')
    assert b'<title>' in entry and b'./assets/' in entry
    with ZipFile(base) as original, ZipFile(target, 'w', ZIP_DEFLATED) as out:
        for entry_info in original.infolist():
            name = entry_info.filename
            if name.startswith('META-INF/') and (
                name.upper().endswith(('.SF', '.RSA', '.DSA', '.EC')) or name.upper() == 'META-INF/MANIFEST.MF'
            ):
                continue
            if name.startswith(PUBLIC) and name not in {PUBLIC + 'cordova.js', PUBLIC + 'cordova_plugins.js'}:
                continue
            data = original.read(entry_info)
            if name == 'AndroidManifest.xml':
                data = versioned_manifest(data)
            elif name == 'resources.arsc':
                data = resource_table(data)
            elif name == 'assets/capacitor.config.json':
                config = json.loads(data)
                config.update(appId=APP,appName=LABEL)
                data = json.dumps(config).encode()
            elif name.startswith('res/mipmap-') and 'ic_launcher' in name and name.endswith('.png'):
                data = icon(name,data)
            out.writestr(copy(entry_info), data)
        out.writestr(PUBLIC + 'index.html', entry)
        for path in (dist/'assets').iterdir():
            out.write(path,PUBLIC + 'assets/' + path.name)
        for directory in ('basis','draco'):
            for path in (dist/directory).iterdir():
                if path.is_file():
                    out.write(path,PUBLIC + directory + '/' + path.name)
        out.write(dist/'demo.glb',PUBLIC + 'demo.glb')
        out.write(ROOT/'LICENSE-CC0.MD',PUBLIC + 'DEMO-LICENSE.txt')


if __name__ == '__main__':
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('base', type=Path)
    parser.add_argument('target', type=Path)
    args = parser.parse_args()
    build(args.base,args.target)
