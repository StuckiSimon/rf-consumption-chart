"""Run with Blender --background --factory-startup --python scripts/export-animation.py."""

from pathlib import Path
import re

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "models"
OUTPUT.mkdir(parents=True, exist_ok=True)


def import_fbx(filename):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(ROOT / filename))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError(f"{filename}: expected one armature, found {len(rigs)}")
    return rigs[0]


def rest_matrices(rig):
    return {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}


def bake_to_character_rest(rig, scene, source, character_rest, character_lengths):
    samples = []
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        samples.append((frame, {bone.name: bone.matrix.copy() for bone in rig.pose.bones}))
    old_action = rig.animation_data.action
    rig.animation_data_clear()
    if old_action.users == 0:
        bpy.data.actions.remove(old_action)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for bone in rig.data.edit_bones:
        bone.matrix = character_rest[bone.name]
        bone.length = character_lengths[bone.name]
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions.new(source.stem)
    for frame, matrices in samples:
        scene.frame_set(frame)
        for bone in rig.pose.bones:
            parent = bone.parent
            parent_options = {
                "parent_matrix": matrices[parent.name],
                "parent_matrix_local": parent.bone.matrix_local,
            } if parent else {}
            bone.rotation_mode = "QUATERNION"
            bone.matrix_basis = bone.bone.convert_local_to_pose(
                matrices[bone.name], bone.bone.matrix_local, invert=True, **parent_options,
            )
            for data_path in ("location", "rotation_quaternion", "scale"):
                bone.keyframe_insert(data_path=data_path, frame=frame, group=bone.name)
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        for bone in rig.pose.bones:
            if max(abs(a - b) for row_a, row_b in zip(matrices[bone.name], bone.matrix)
                   for a, b in zip(row_a, row_b)) > 0.001:
                raise RuntimeError(f"{source.name}: retargeting changed the pose of {bone.name} at frame {frame}")


sources = sorted((ROOT / "raw-animations").glob("*.fbx"))
if not sources:
    raise RuntimeError("raw-animations contains no FBX files")
output_names = [re.sub(r"[^a-z0-9]+", "-", source.stem.lower()).strip("-") for source in sources]
if len(set(output_names)) != len(output_names):
    raise RuntimeError("Animation filenames produce duplicate output names")

rig = import_fbx("raw-model/micky.fbx")
character_rest = rest_matrices(rig)
character_lengths = {bone.name: bone.length for bone in rig.data.bones}
character_parents = {bone.name: bone.parent.name if bone.parent else None for bone in rig.data.bones}
character_transform = rig.matrix_world.copy()
for obj in bpy.context.scene.objects:
    obj.animation_data_clear()
for bone in rig.pose.bones:
    bone.matrix_basis.identity()
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT / "micky.glb"),
    export_format="GLB",
    export_animations=False,
    export_image_format="AUTO",
    export_yup=True,
)

print(f"Exported {OUTPUT / 'micky.glb'}")

for source, output_name in zip(sources, output_names):
    rig = import_fbx(source.relative_to(ROOT))
    animation_rest = rest_matrices(rig)
    if character_rest.keys() != animation_rest.keys():
        raise RuntimeError(f"{source.name}: bone names differ; retargeting is required")
    needs_baking = False
    for name, matrix in character_rest.items():
        bone = rig.data.bones[name]
        if (bone.parent.name if bone.parent else None) != character_parents[name]:
            raise RuntimeError(f"{source.name}: bone hierarchy differs for {name}")
        if max(abs(a - b) for row_a, row_b in zip(matrix, animation_rest[name])
               for a, b in zip(row_a, row_b)) > 0.0001:
            if abs(bone.length / character_lengths[name] - 1) > 0.001:
                raise RuntimeError(f"{source.name}: bone proportions differ for {name}; rescaling is required")
            needs_baking = True
    if max(abs(a - b) for row_a, row_b in zip(character_transform, rig.matrix_world)
           for a, b in zip(row_a, row_b)) > 0.0001:
        raise RuntimeError(f"{source.name}: armature transforms differ; retargeting is required")
    if not rig.animation_data or not rig.animation_data.action:
        raise RuntimeError(f"{source.name}: contains no active armature animation")
    action = rig.animation_data.action
    action.name = source.stem
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = map(int, action.frame_range)
    if scene.frame_end <= scene.frame_start:
        raise RuntimeError(f"{source.name}: animation has no playable duration")
    if needs_baking:
        bake_to_character_rest(rig, scene, source, character_rest, character_lengths)
        print(f"Baked animation to character rest pose: {source.name}")
    scene.frame_set(scene.frame_start)
    for obj in list(scene.objects):
        if obj != rig:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT / f"{output_name}.glb"),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_nla_strips_merged_animation_name=source.stem,
        export_frame_range=True,
        export_force_sampling=True,
        export_anim_slide_to_zero=True,
        export_yup=True,
    )
    print(f"Exported {OUTPUT / f'{output_name}.glb'}: "
          f"frames {scene.frame_start}-{scene.frame_end}, "
          f"{scene.render.fps / scene.render.fps_base:g} fps")

print(f"Exported {len(sources)} animations")
