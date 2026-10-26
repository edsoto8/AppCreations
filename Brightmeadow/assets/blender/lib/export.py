"""GLB export with the pipeline's fixed settings, plus manifest.json writing."""
import json
import os

import bpy

import glb


def select_only(objects):
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def export_glb(objects, path, animations=False):
    """Export exactly `objects` (and nothing else) to a GLB.

    Y-up, modifiers applied (except the armature, which stays a skin), materials embedded, no
    cameras / lights / textures. Animations: one glTF animation per Blender action, taken from
    the armature's NLA tracks (see rig.store_action), with the pose reset between actions.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in objects:
        if ob.type == "ARMATURE":
            ad = ob.animation_data
            if ad is not None:
                ad.action = None
            for pb in ob.pose.bones:
                pb.location = (0, 0, 0)
                pb.rotation_quaternion = (1, 0, 0, 0)
                pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    select_only(objects)
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=False,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_vertex_color="NONE",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_skins=True,
        export_animations=animations,
    )
    if animations:
        kw.update(
            export_animation_mode="ACTIONS",
            export_anim_single_armature=False,   # only this armature's NLA-stashed actions
            export_nla_strips=True,
            export_merge_animation="ACTION",
            export_force_sampling=True,
            export_frame_range=False,
            export_anim_slide_to_zero=False,
            export_reset_pose_bones=True,
            export_rest_position_armature=True,
            export_optimize_animation_size=True,
            export_optimize_animation_keep_anim_armature=True,
            export_def_bones=False,
        )
    bpy.ops.export_scene.gltf(**kw)
    return path


def manifest_entry(name, path):
    s = glb.summary(path)
    entry = {"file": os.path.basename(path)}
    entry.update(s)
    return entry


def write_manifest(models_dir, names=None):
    """Rebuild manifest.json from every .glb in models_dir (sorted, deterministic)."""
    files = sorted(f for f in os.listdir(models_dir) if f.endswith(".glb"))
    data = {}
    for f in files:
        name = f[:-4]
        if names is not None and name not in names:
            continue
        data[name] = manifest_entry(name, os.path.join(models_dir, f))
    path = os.path.join(models_dir, "manifest.json")
    with open(path, "w") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")
    return path, data
