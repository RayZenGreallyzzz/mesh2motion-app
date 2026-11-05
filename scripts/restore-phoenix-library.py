"""Restore the full local library from its original archive; never upload assets."""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--archive', required=True)
parser.add_argument('--blender', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
archive = Path(args.archive).resolve()
if archive.stat().st_size > 128 * 1048576:
    raise ValueError('Archive exceeds 128 MiB')
catalog_path = root / 'src/library/phoenix-packs.json'
catalog = json.loads(catalog_path.read_text())
with tempfile.TemporaryDirectory(prefix='.phoenix-restore-', dir=root) as temporary:
    work = Path(temporary)
    source, stage, reports = work / 'source', work / 'web', work / 'reports'
    source.mkdir()
    with zipfile.ZipFile(archive) as z:
        files = z.infolist()
        if len(files) > 4096 or sum(f.file_size for f in files) > 512 * 1048576:
            raise ValueError('Archive expands beyond the library limit')
        for entry in files:
            p = Path(entry.filename.replace('\\', '/'))
            if p.is_absolute() or '..' in p.parts or ':' in str(p):
                raise ValueError('Unsafe archive path')
            if entry.is_dir():
                continue
            if p.suffix in ('.blend', '.png', '.json') or ('01_Основные' in str(p) and p.suffix == '.glb'):
                destination = source / p
                destination.parent.mkdir(parents=True, exist_ok=True)
                with z.open(entry) as src, destination.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
    for pack in catalog:
        if pack['id'] not in ('ual2-root-motion', 'ual2-standard'):
            continue
        tag = 'RootMotion' if pack['id'] == 'ual2-root-motion' else 'Standard'
        candidates = list(source.rglob('*43_анимации_' + tag + '.glb'))
        if len(candidates) != 1:
            raise ValueError('The full source archive must contain the UAL2 ' + tag + ' GLB')
        destination = stage / pack['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(candidates[0], destination)
    subprocess.run([
        str(Path(args.blender).resolve()), '--background', '--factory-startup', '--disable-autoexec',
        '--threads', '2', '--python-exit-code', '1', '--python', str(root / 'scripts/export-phoenix-packs.py'),
        '--', '--input', str(source), '--output', str(stage), '--catalog', str(catalog_path), '--reports', str(reports)
    ], cwd=root, check=True)
    subprocess.run(['node', str(root / 'scripts/verify-phoenix-catalog.mjs'), str(stage)], cwd=root, check=True)
    destination = root / 'static/packs/phoenix'
    backup = work / 'previous-library'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        os.replace(destination, backup)
    try:
        os.replace(stage / 'packs/phoenix', destination)
    except BaseException:
        if backup.exists():
            os.replace(backup, destination)
        raise
    checks = root / 'checks/phoenix-source'
    checks.mkdir(parents=True, exist_ok=True)
    for report in reports.glob('*.json'):
        shutil.copyfile(report, checks / report.name)
print('Restored all 63 packs. Run npm run test:library, then npm run build:library.')
