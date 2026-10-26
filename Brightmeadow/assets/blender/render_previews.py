"""Preview renders of the exported GLBs (so the renders also test the exports).

Run under a virtual display:
    xvfb-run -a python render_previews.py [--only explorer coin ...] [--skip-poses]
    xvfb-run -a blender -b --python render_previews.py -- [...]

Writes assets/blender/renders/<asset>.png, lineup.png, explorer_poses.png and terrain strips.
"""
import math
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import common  # noqa: E402
import render  # noqa: E402

V = Vector
MODELS = common.MODELS_DIR
OUT = common.RENDERS_DIR

# per-asset camera direction (from target toward camera) and whether to add a ground disc
VIEWS = {
    "explorer": dict(direction=(0.5, -1.0, 0.28)),
    "bramblebug": dict(direction=(0.75, -1.0, 0.45)),
    "buzzpuff": dict(direction=(0.6, -1.0, 0.25), ground=False),
    "coin": dict(direction=(0.45, -1.0, 0.25), ground=False),
    "checkpoint": dict(direction=(0.6, -1.0, 0.3)),
    "goal": dict(direction=(0.45, -1.0, 0.25)),
    "hill_a": dict(direction=(0.2, -1.0, 0.25)),
    "hill_b": dict(direction=(0.2, -1.0, 0.25)),
    "cloud_a": dict(direction=(0.2, -1.0, 0.3), ground=False),
    "cloud_b": dict(direction=(0.2, -1.0, 0.3), ground=False),
}
DEFAULT_VIEW = dict(direction=(0.6, -1.0, 0.45))


def fresh(res, engine="EEVEE", samples=16):
    common.reset_scene()
    bpy.context.scene.render.fps = 30
    render.setup_render(res, engine=engine, samples=samples)
    render.setup_lights()


def load(name, offset=(0, 0, 0), rot_z=0.0):
    objs = render.import_glb(os.path.join(MODELS, name + ".glb"))
    for o in objs:
        if o.name.startswith("Icosphere"):          # importer's bone display shape
            o.hide_render = True
    roots = [o for o in objs if o.parent is None and not o.name.startswith("Icosphere")]
    from mathutils import Matrix
    M = Matrix.Translation(V(offset)) @ Matrix.Rotation(math.radians(rot_z), 4, "Z")
    for o in roots:
        o.matrix_world = M @ o.matrix_world
    bpy.context.view_layer.update()
    return [o for o in objs if not o.name.startswith("Icosphere")]


def set_action(objs, anim, frame):
    for o in objs:
        if o.type != "ARMATURE":
            continue
        act = bpy.data.actions.get(anim) if anim else None
        ad = o.animation_data or o.animation_data_create()
        for tr in ad.nla_tracks:
            tr.mute = True
        ad.action = act
        if hasattr(ad, "action_slot") and act is not None and len(act.slots):
            ad.action_slot = act.slots[0]
    bpy.context.scene.frame_set(frame)


def render_asset(name, res=(512, 512)):
    fresh(res)
    view = dict(DEFAULT_VIEW)
    view.update(VIEWS.get(name, {}))
    objs = load(name)
    set_action(objs, None, 0)
    mn, mx = render.world_bounds(objs)
    if view.get("ground", True) and mn.z > -0.05:
        render.add_ground()
    elif mn.z < -0.5:                                   # terrain: show a backdrop ground far below
        pass
    render.add_camera(mn, mx, direction=view["direction"], aspect=res[0] / res[1])
    return render.render_to(os.path.join(OUT, name + ".png"))


def render_strip(names, out_name, spacing, res=(900, 420), direction=(0.3, -1.0, 0.22)):
    """Tile pieces side by side (terrain seam check)."""
    fresh(res)
    objs = []
    x = 0.0
    for nm, width, origin_offset in names:
        objs += load(nm, offset=(x + origin_offset, 0, 0))
        x += width
    mn, mx = render.world_bounds(objs)
    focus_mn = V((mn.x, mn.y, max(mn.z, -2.5)))
    render.add_camera(focus_mn, mx, direction=direction, aspect=res[0] / res[1], margin=1.05)
    return render.render_to(os.path.join(OUT, out_name + ".png"))


def render_lineup(res=(1400, 640)):
    fresh(res, samples=24)
    objs = []
    objs += load("explorer", offset=(-1.1, 0, 0))
    objs += load("bramblebug", offset=(0.15, 0.1, 0), rot_z=-25)
    objs += load("buzzpuff", offset=(1.35, 0.1, 1.0), rot_z=-20)
    objs += load("coin", offset=(2.35, -0.1, 0.55))
    set_action(objs, None, 0)
    render.add_ground()
    mn, mx = render.world_bounds(objs)
    render.add_camera(mn, mx, direction=(0.12, -1.0, 0.22), aspect=res[0] / res[1], lens=60,
                      margin=1.08)
    return render.render_to(os.path.join(OUT, "lineup.png"))


def _load_png(path):
    im = bpy.data.images.load(path)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(im)
    return a[::-1]  # top row first


def _save_png(arr, path):
    h, w, _ = arr.shape
    im = bpy.data.images.new("composite", w, h, alpha=True)
    im.pixels = arr[::-1].ravel()
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def render_poses(cell=(260, 330), cols=5):
    import gen_character as gc
    anims = [(n, fr) for n, fr, _l, _f in gc.ANIMATIONS]
    tmp = os.path.join(OUT, "_cells")
    os.makedirs(tmp, exist_ok=True)
    fresh(cell, samples=12)
    objs = load("explorer", rot_z=90)       # face +X like in game (camera sees the profile)
    render.add_ground()
    cam = render.add_camera(V((-0.55, -0.5, -0.05)), V((0.55, 0.5, 1.75)),
                            direction=(0.35, -1.0, 0.12), aspect=cell[0] / cell[1], ortho=True,
                            margin=1.0)
    lab = bpy.data.curves.new("lab", "FONT")
    lab.size = 0.09
    lab.align_x = "CENTER"
    lab_ob = bpy.data.objects.new("lab", lab)
    bpy.context.scene.collection.objects.link(lab_ob)
    lab_ob.parent = cam
    lab_ob.location = (0, -0.5 * cam.data.ortho_scale + 0.06, -1.0)
    mat = bpy.data.materials.new("labmat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    lab.materials.append(mat)
    rows = []
    for name, frames in anims:
        picks = [round(frames * k / (cols - 1)) for k in range(cols)]
        if name in ("idle", "walk", "run", "fall", "celebrate"):
            picks = [round(frames * k / cols) for k in range(cols)]
        imgs = []
        for fr in picks:
            set_action(objs, name, fr)
            lab.body = f"{name}  f{fr}"
            path = os.path.join(tmp, f"{name}_{fr:03d}.png")
            render.render_to(path)
            imgs.append(_load_png(path))
        rows.append(np.concatenate(imgs, axis=1))
    grid = np.concatenate(rows, axis=0)
    _save_png(grid, os.path.join(OUT, "explorer_poses.png"))
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)


TERRAIN_STRIPS = [
    ("terrain_ground_strip", [("ground_cap_left", 0.5, 0.5), ("ground_mid_a", 1.0, 0.5),
                              ("ground_mid_b", 1.0, 0.5), ("ground_mid_c", 1.0, 0.5),
                              ("ground_mid_a", 1.0, 0.5), ("ground_cap_right", 0.5, 0.0)]),
    ("terrain_float_strip", [("float_cap_left", 0.5, 0.5), ("float_mid_a", 1.0, 0.5),
                             ("float_mid_b", 1.0, 0.5), ("float_mid_a", 1.0, 0.5),
                             ("float_cap_right", 0.5, 0.0)]),
]


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", nargs="*")
    p.add_argument("--skip-poses", action="store_true")
    p.add_argument("--skip-assets", action="store_true")
    args = p.parse_args(common.script_args())
    os.makedirs(OUT, exist_ok=True)
    names = sorted(f[:-4] for f in os.listdir(MODELS) if f.endswith(".glb"))
    t0 = time.time()
    if not args.skip_assets:
        for n in names:
            if args.only and n not in args.only:
                continue
            render_asset(n)
            print("rendered", n, f"{time.time() - t0:.0f}s", flush=True)
    sel = set(args.only or [])
    if not args.only or "terrain" in sel:
        for out_name, pieces in TERRAIN_STRIPS:
            if all(os.path.exists(os.path.join(MODELS, pc[0] + ".glb")) for pc in pieces):
                render_strip(pieces, out_name, 1.0)
    if (not args.only or "lineup" in sel) and all(
            os.path.exists(os.path.join(MODELS, n + ".glb")) for n in
            ("explorer", "bramblebug", "buzzpuff", "coin")):
        render_lineup()
    if not args.skip_poses and (not args.only or "poses" in sel):
        render_poses()
    print(f"renders done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
