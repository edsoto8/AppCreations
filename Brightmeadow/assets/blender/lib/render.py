"""Preview rendering: one consistent "palette lighting" setup used for every preview PNG.

Warm key sun from the upper front-left, cool sky fill, Standard view transform (so palette
colours render as authored), soft ground disc for ground-standing objects.
"""
import math
import os

import bpy
from mathutils import Vector

V = Vector


def setup_render(res=(512, 512), engine="EEVEE", samples=16, transparent=False):
    scn = bpy.context.scene
    if engine == "EEVEE":
        scn.render.engine = "BLENDER_EEVEE_NEXT"
        scn.eevee.taa_render_samples = samples
        try:
            scn.eevee.use_shadows = True
            scn.eevee.use_raytracing = False
        except AttributeError:
            pass
    elif engine == "CYCLES":
        scn.render.engine = "CYCLES"
        scn.cycles.device = "CPU"
        scn.cycles.samples = samples
    else:
        scn.render.engine = "BLENDER_WORKBENCH"
        scn.display.shading.light = "STUDIO"
        scn.display.shading.color_type = "MATERIAL"
        scn.display.shading.show_shadows = True
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = transparent
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"
    scn.view_settings.exposure = 0.0
    return scn


def setup_lights(sky=(0.62, 0.80, 0.95), sky_strength=0.9, sun_strength=3.2):
    scn = bpy.context.scene
    world = bpy.data.worlds.get("PreviewWorld") or bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*sky, 1.0)
    bg.inputs["Strength"].default_value = sky_strength
    scn.world = world
    objs = []
    # key: warm sun, upper front-left
    key = bpy.data.lights.new("Key", "SUN")
    key.energy = sun_strength
    key.color = (1.0, 0.95, 0.86)
    key.angle = math.radians(8)
    ko = bpy.data.objects.new("Key", key)
    ko.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scn.collection.objects.link(ko)
    objs.append(ko)
    # rim: cool sun from behind-right, gives the silhouette an edge
    rim = bpy.data.lights.new("Rim", "SUN")
    rim.energy = 1.4
    rim.color = (0.8, 0.9, 1.0)
    rim.use_shadow = False
    ro = bpy.data.objects.new("Rim", rim)
    ro.rotation_euler = (math.radians(-55), 0, math.radians(-150))
    scn.collection.objects.link(ro)
    objs.append(ro)
    return objs


def add_ground(radius=50.0, z=0.0, color=(0.36, 0.42, 0.30)):
    me = bpy.data.meshes.new("PreviewGround")
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=radius, segments=48)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("PreviewGround", me)
    ob.location.z = z
    mat = bpy.data.materials.get("PreviewGroundMat") or bpy.data.materials.new("PreviewGroundMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = 1.0
    me.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def world_bounds(objects):
    dg = bpy.context.evaluated_depsgraph_get()
    mn = V((1e9, 1e9, 1e9))
    mx = V((-1e9, -1e9, -1e9))
    for ob in objects:
        if ob.type != "MESH":
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            w = ev.matrix_world @ v.co
            mn = V((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
            mx = V((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
        ev.to_mesh_clear()
    return mn, mx


def add_camera(bmin, bmax, direction=(0.55, -1.0, 0.35), lens=50.0, margin=1.12, aspect=1.0,
               ortho=False):
    """Camera looking at the bounds centre from `direction`, distance fitted to the bounds."""
    scn = bpy.context.scene
    cam = bpy.data.cameras.new("PreviewCam")
    cam.lens = lens
    cam.clip_start = 0.05
    cam.clip_end = 500
    co = bpy.data.objects.new("PreviewCam", cam)
    scn.collection.objects.link(co)
    center = (bmin + bmax) * 0.5
    d = V(direction).normalized()
    # fit: project the 8 corners on the camera plane
    rot = (-d).to_track_quat("-Z", "Y")
    right = rot @ V((1, 0, 0))
    up = rot @ V((0, 1, 0))
    corners = [V((x, y, z)) for x in (bmin.x, bmax.x) for y in (bmin.y, bmax.y)
               for z in (bmin.z, bmax.z)]
    half_w = max(abs((c - center).dot(right)) for c in corners) * margin
    half_h = max(abs((c - center).dot(up)) for c in corners) * margin
    depth = max(abs((c - center).dot(d)) for c in corners)
    sensor = 36.0
    cam.sensor_fit = "HORIZONTAL" if aspect >= 1 else "VERTICAL"
    cam.sensor_width = sensor
    cam.sensor_height = sensor
    if ortho:
        cam.type = "ORTHO"
        cam.ortho_scale = 2 * max(half_w, half_h * aspect) if aspect >= 1 else 2 * max(
            half_h, half_w / aspect)
        dist = depth + 10
    else:
        fov_h = 2 * math.atan(sensor / (2 * lens))
        if aspect >= 1:
            fov_w, fov_v = fov_h, 2 * math.atan(math.tan(fov_h / 2) / aspect)
        else:
            fov_v, fov_w = fov_h, 2 * math.atan(math.tan(fov_h / 2) * aspect)
        dist = max(half_w / math.tan(fov_w / 2), half_h / math.tan(fov_v / 2)) + depth
    co.location = center + d * dist
    co.rotation_euler = rot.to_euler()
    scn.camera = co
    return co


def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def add_label(text, location, size=0.12, color=(0.1, 0.1, 0.15)):
    cu = bpy.data.curves.new("Label", "FONT")
    cu.body = text
    cu.size = size
    cu.align_x = "CENTER"
    ob = bpy.data.objects.new("Label", cu)
    ob.location = location
    ob.rotation_euler = (math.radians(90), 0, 0)
    mat = bpy.data.materials.get("LabelMat") or bpy.data.materials.new("LabelMat")
    mat.use_nodes = True
    mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*color, 1)
    cu.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    return ob
