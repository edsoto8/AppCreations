"""Quality-control passes: validation report, intersections, contact sheets."""

import math
import os

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import utils as U

QC_VIEWS = [
    # name, location, target, lens (0 = ortho with given scale)
    ("front", (0, -14, 2.1), (0, 0, 2.1), 0, 7.2),
    ("side", (14, 0, 2.1), (0, 0, 2.1), 0, 7.2),
    ("back", (0, 8.6, 2.1), (0, 0, 2.1), 0, 7.2),        # inside the hangar's back wall
    ("three_quarter", (-5.2, -6.4, 3.0), (0, 0, 2.0), 40, 0),
    ("top", (0.01, -0.3, 12), (0, -0.3, 2.0), 0, 4.0),
    ("close_torso", (1.6, -3.0, 3.55), (0.1, 0.0, 3.1), 45, 0),
    ("close_legs", (2.3, -2.6, 1.1), (0.45, 0.0, 1.0), 40, 0),
    ("close_arm", (-2.9, -1.9, 2.3), (-1.12, 0.0, 2.0), 40, 0),
]


def qc_cameras():
    coll = U.sub_coll("QC")
    cams = {}
    for name, loc, tgt, lens, scale in QC_VIEWS:
        cd = bpy.data.cameras.new(f"QC_{name}")
        if lens == 0:
            cd.type = "ORTHO"
            cd.ortho_scale = scale
        else:
            cd.lens = lens
        cd.clip_end = 200
        ob = bpy.data.objects.new(f"QC_{name}", cd)
        up = Vector((0, 1, 0)) if name == "top" else Vector((0, 0, 1))
        ob.matrix_world = U.look_matrix(loc, tgt, up)
        coll.objects.link(ob)
        cams[name] = ob
    return cams


def preview_lights():
    """Neutral 3-point rig used only when the presentation scene is not built."""
    coll = U.sub_coll("QC")
    out = []
    for name, loc, energy, size in (("QC_Key", (-6, -8, 9), 2500, 4), ("QC_Fill", (8, -6, 4), 900, 6),
                                    ("QC_Rim", (2, 9, 7), 1800, 3)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        ob.matrix_world = U.look_matrix(loc, (0, 0, 2))
        coll.objects.link(ob)
        out.append(ob)
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.18, 0.19, 0.2, 1)
    bg.inputs[1].default_value = 0.6
    return out


def render_settings(samples=32, res=(640, 360), denoise=True):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = denoise
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 4
    sc.cycles.volume_bounces = 0
    sc.cycles.transparent_max_bounces = 4
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.threads_mode = "AUTO"
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass


def render_view(cam, path, res=None):
    sc = bpy.context.scene
    if res:
        sc.render.resolution_x, sc.render.resolution_y = res
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def contact_sheet(out_path, views=None, tile=(480, 300), samples=24, cams=None):
    """Render every QC view and tile them into one labelled PNG."""
    from PIL import Image, ImageDraw

    cams = cams or qc_cameras()
    views = views or [v[0] for v in QC_VIEWS]
    render_settings(samples=samples, res=tile)
    tmp = os.path.join(os.path.dirname(out_path), "_tiles")
    os.makedirs(tmp, exist_ok=True)
    tiles = []
    haze = bpy.data.objects.get("Scene_Haze")
    for v in views:
        if haze is not None:
            haze.hide_render = cams[v].data.type == "ORTHO"
        p = render_view(cams[v], os.path.join(tmp, f"{v}.png"))
        tiles.append((v, p))
    if haze is not None:
        haze.hide_render = False
    cols = 4
    rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGB", (cols * tile[0], rows * tile[1]), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, (v, p) in enumerate(tiles):
        im = Image.open(p).convert("RGB")
        x, y = (i % cols) * tile[0], (i // cols) * tile[1]
        sheet.paste(im, (x, y))
        d.text((x + 6, y + 4), v, fill=(255, 255, 0))
    sheet.save(out_path)
    return out_path


# --------------------------------------------------------------------------- checks

def _bvh(ob, dg):
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ob.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys) if polys else None


def group_intersections(groups, pairs=None):
    """Detect unintended contact between large subsystems (e.g. left leg vs right leg).

    ``groups`` maps a label to a list of objects. Returns {(a, b): overlapping triangle pairs}.
    Fasteners and cables are excluded by the caller; joints that legitimately meet are not
    paired.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    trees = {}
    for label, objs in groups.items():
        trees[label] = [t for t in (_bvh(o, dg) for o in objs if o.type == "MESH") if t]
    labels = list(groups)
    pairs = pairs or [(labels[i], labels[j]) for i in range(len(labels)) for j in range(i + 1, len(labels))]
    out = {}
    for a, b in pairs:
        n = 0
        for ta in trees.get(a, []):
            for tb in trees.get(b, []):
                n += len(ta.overlap(tb))
        out[(a, b)] = n
    return out


def count_report():
    """Object counts grouped by subsystem collection; fasteners counted separately."""
    root = bpy.data.collections.get(U.ROOT_COLL)
    rep = {}
    if not root:
        return rep
    for c in root.children:
        objs = [o for o in c.all_objects if o.type in {"MESH", "CURVE", "FONT"} and not o.hide_render]
        fast = sum(1 for o in objs if o.get("fastener"))
        rep[c.name.replace(U.ROOT_COLL + "_", "")] = {"parts": len(objs) - fast, "fasteners": fast,
                                                       "total": len(objs)}
    return rep


CATEGORIES = [
    ("Cables & hoses", ("Cable_",)),
    ("Hydraulics", ("_Cylinder", "_Rod", "_Spring", "Actuator", "Shock", "Manifold", "HydraulicPump", "_Mount",
                    "Outrigger", "_Lever", "QuickConnect", "CouplerPins")),
    ("Joints, bearings & gears", ("Drum", "RingGear", "EndCaps", "GreaseRing", "Hinge", "Lugs", "Bearing", "Knuckle",
                                  "Pinion", "GearTrain", "Yoke", "Flange", "Collar_", "Wrist_Collar", "Socket",
                                  "NeckMount", "MotorHousing", "DriveMotor")),
    ("Sensors & lights", ("Lens", "CamPod", "Lidar", "Antenna", "LED", "LightBar", "Optic", "SensorBay", "Core_")),
    ("Cooling & exhaust", ("Fan_", "Vent", "Radiator", "CoolingFins", "Exhaust", "HeatSink", "SlotCutter")),
    ("Labels & surface detail", ("Label", "Weld", "AccessPanel", "Gauge", "HazardStrip")),
    ("Armor plating", ("Armor", "Pauldron", "Tasset", "Collar", "Guard", "TopDeck", "Abdomen", "Cap")),
]


def category_of(ob):
    if ob.get("fastener"):
        return "Fasteners (linked duplicates)"
    for cat, keys in CATEGORIES:
        if any(k in ob.name for k in keys):
            return cat
    return "Structure & tools"


def category_report():
    """{subsystem: {category: count}} for visible robot objects, plus GN-instanced rivets."""
    root = bpy.data.collections.get(U.ROOT_COLL)
    rep = {}
    rivets = 0
    for c in root.children:
        sub = c.name.replace(U.ROOT_COLL + "_", "")
        if sub in ("Scene", "QC", "Rig"):
            continue
        d = {}
        for o in c.all_objects:
            if o.type not in {"MESH", "CURVE", "FONT"} or o.hide_render:
                continue
            k = category_of(o)
            d[k] = d.get(k, 0) + 1
            rivets += int(o.get("gn_rivets", 0))
        rep[sub] = d
    return rep, rivets
