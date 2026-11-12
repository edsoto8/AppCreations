"""Cycles setup, cameras and still/animation rendering."""
import math
import os

import bpy
from mathutils import Vector


def setup_cycles(scene, res=(1920, 1080), samples=128, pct=100):
    r = scene.render
    r.engine = 'CYCLES'
    c = scene.cycles
    c.device = 'CPU'
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.03
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 6
    c.glossy_bounces = 4
    c.transmission_bounces = 6
    c.transparent_max_bounces = 10
    c.volume_bounces = 0
    c.sample_clamp_indirect = 8.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = pct
    r.use_persistent_data = True
    r.image_settings.file_format = 'PNG'
    vs = scene.view_settings
    try:
        vs.view_transform = 'AgX'
        for look in ('AgX - Medium High Contrast', 'Medium High Contrast'):
            try:
                vs.look = look
                break
            except TypeError:
                pass
    except TypeError:
        pass


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(scene, name, loc, target, lens=35, coll=None, dof=None):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_end = 500
    cam = bpy.data.objects.new(name, cd)
    (coll or scene.collection).objects.link(cam)
    cam.location = loc
    look_at(cam, target)
    if dof:
        cd.dof.use_dof = True
        cd.dof.focus_distance = (Vector(target) - Vector(loc)).length
        cd.dof.aperture_fstop = dof
    return cam


def studio(scene, coll):
    """Neutral preview lighting used for milestone checks (not the final hangar lighting)."""
    w = bpy.data.worlds.new("PreviewWorld")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.09, 0.1, 0.12, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = w
    for name, loc, energy, size, col in (("Key", (-12, -14, 16), 9000, 10, (1, 0.96, 0.9)),
                                         ("Fill", (14, -8, 6), 2500, 12, (0.7, 0.85, 1)),
                                         ("Rim", (6, 16, 12), 7000, 8, (0.6, 0.9, 1)),
                                         ("Top", (0, 0, 20), 4000, 16, (1, 1, 1))):
        ld = bpy.data.lights.new("Preview" + name, 'AREA')
        ld.energy = energy
        ld.size = size
        ld.color = col
        lo = bpy.data.objects.new("Preview" + name, ld)
        coll.objects.link(lo)
        lo.location = loc
        look_at(lo, (0, 0, 3))
    bpy.ops.mesh.primitive_plane_add(size=120)
    fl = bpy.context.active_object
    fl.name = "PreviewFloor"
    for c in fl.users_collection:
        c.objects.unlink(fl)
    coll.objects.link(fl)
    m = bpy.data.materials.new("PreviewFloor")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs['Base Color'].default_value = (0.05, 0.05, 0.055, 1)
    b.inputs['Roughness'].default_value = 0.35
    fl.data.materials.append(m)


def still(scene, cam, path, frame=None):
    if frame is not None:
        scene.frame_set(frame)
    scene.camera = cam
    scene.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
