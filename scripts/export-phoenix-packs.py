"""Run inside Blender 3.6 to export private source packs without altering rigs."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--catalog', required=True)
parser.add_argument('--only', default='')
parser.add_argument('--references-only', action='store_true')
parser.add_argument('--reports')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
source = Path(args.input).resolve()
output = Path(args.output).resolve()
catalog = json.loads(Path(args.catalog).read_text())
selected = set(filter(None, args.only.split(',')))
reports = Path(args.reports).resolve() if args.reports else output.parent / 'checks' / 'phoenix-source'
reports.mkdir(parents=True, exist_ok=True)
atlas_files = list(source.rglob('Atlas_Monsters*.png'))


def reset_pose(armatures):
    for arm in armatures:
        if arm.animation_data:
            arm.animation_data.action = None
            for track in arm.animation_data.nla_tracks:
                track.mute = True
        for bone in arm.pose.bones:
            bone.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()


def bounds(meshes):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for mesh in meshes:
        evaluated = mesh.evaluated_get(depsgraph)
        geometry = evaluated.to_mesh()
        try:
            # Loose editing vertices are not exported or rendered as triangles.
            # Including them would compare invisible source points with the GLB.
            used = {index for polygon in geometry.polygons for index in polygon.vertices}
            for index in used:
                vertex = geometry.vertices[index]
                p = evaluated.matrix_world @ vertex.co
                point = (p.x, p.z, -p.y)  # The exporter's Y-up basis.
                for axis in range(3):
                    lo[axis] = min(lo[axis], point[axis])
                    hi[axis] = max(hi[axis], point[axis])
        finally:
            evaluated.to_mesh_clear()
    return [lo, hi]


def match_glb_influence_limit(meshes, armature):
    """Evaluate the same four influences that the existing GLB pipeline exports."""
    deforming = {bone.name for bone in armature.data.bones if bone.use_deform}
    clipped, maximum = 0, 0.0
    for mesh in meshes:
        group_names = {group.index: group.name for group in mesh.vertex_groups}
        remove = {}
        for vertex in mesh.data.vertices:
            weights = sorted((group for group in vertex.groups if group_names[group.group] in deforming and group.weight > 0), key=lambda group: group.weight, reverse=True)
            if len(weights) <= 4:
                continue
            clipped += 1
            total = sum(group.weight for group in weights)
            maximum = max(maximum, sum(group.weight for group in weights[4:]) / total)
            for group in weights[4:]:
                remove.setdefault(group.group, []).append(vertex.index)
        for group_index, vertices in remove.items():
            mesh.vertex_groups[group_index].remove(vertices)
    return {'verticesLimitedToFour': clipped, 'maximumDiscardedWeightFraction': maximum}


for pack in catalog:
    if '/monsters/' not in pack['path'] or (selected and pack['id'] not in selected):
        continue
    matches = [p for p in source.rglob('*.blend') if p.stem.lower() == pack['id']]
    if len(matches) != 1:
        raise RuntimeError('Ambiguous or missing Blender source: ' + pack['id'])
    path = matches[0]
    metadata = json.loads(path.with_name('meta.json').read_text())
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False, use_scripts=False)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    armatures = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if len(armatures) != 1:
        raise RuntimeError('Expected one source armature: ' + pack['id'])
    armature = armatures[0]
    if len(armature.data.bones) != pack['bones']:
        raise RuntimeError('Source bone count disagrees with catalog: ' + pack['id'])
    actions = list(bpy.data.actions)
    if {a.name for a in actions} != set(metadata['animations']):
        raise RuntimeError('Source action names disagree with metadata: ' + pack['id'])
    # The archives supply their common atlas alongside, rather than inside each .blend.
    for material in bpy.data.materials:
        for node in material.node_tree.nodes if material.node_tree else []:
            if node.type != 'TEX_IMAGE' or not node.image:
                continue
            image = node.image
            absolute = Path(bpy.path.abspath(image.filepath.replace('\\', '/')))
            if not absolute.is_file():
                candidates = [p for p in atlas_files if p.name == absolute.name]
                if not candidates and absolute.name.startswith('Atlas_Monsters'):
                    candidates = atlas_files[:1]
                if not candidates:
                    raise RuntimeError('Missing material image: ' + absolute.name)
                image.filepath = str(candidates[0])
            image.reload()
            if not image.size[0]:
                raise RuntimeError('Could not load atlas for ' + pack['id'])
    influence_report = match_glb_influence_limit(meshes, armature)
    reset_pose(armatures)
    reference = {'id': pack['id'], 'bones': len(armature.data.bones), 'influence_limit': influence_report, 'rest_bounds': bounds(meshes), 'clips': []}
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    for action in actions:
        reset_pose(armatures)
        armature.animation_data_create()
        armature.animation_data.action = action
        start, end = action.frame_range
        samples = []
        for fraction in [0, .25, .5, .75, 1]:
            # Compare at authored frame times. The GLB's LINEAR interpolation
            # between baked frames differs from Blender's original Bezier curves.
            frame = round(start + (end - start) * fraction)
            bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))
            bpy.context.view_layer.update()
            samples.append({'time': (frame - start) / fps, 'bounds': bounds(meshes)})
        reference['clips'].append({'name': action.name, 'duration': (end - start) / fps, 'samples': samples})
    reset_pose(armatures)
    destination = output / pack['path']
    if args.references_only:
        (reports / (pack['id'] + '.json')).write_text(json.dumps(reference))
        continue
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in [armature, *meshes]:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(destination), export_format='GLB', use_selection=True,
        export_yup=True, export_animations=True, export_animation_mode='ACTIONS',
        export_frame_range=False, export_force_sampling=True, export_anim_slide_to_zero=True,
        export_def_bones=False, export_skins=True, export_morph=True,
        export_optimize_animation_size=True, export_extras=False,
    )
    if result != {'FINISHED'}:
        raise RuntimeError('Export did not finish: ' + pack['id'])
    (reports / (pack['id'] + '.json')).write_text(json.dumps(reference))
    print('PACK_EXPORTED', json.dumps({'id':pack['id'], 'clips':len(actions), 'bones':len(armature.data.bones), 'bytes':destination.stat().st_size}), flush=True)
