"""Presentation scene: concrete display platform with floor markings, hangar backdrop, studio
key/fill, strong rim lights, light shafts through a thin volumetric haze, and the six
presentation cameras with depth of field. ``render_all`` drives preview and final renders."""

import math
import os
import time

import bpy
from mathutils import Vector

from . import details as D
from . import primitives as P
from . import qc
from . import utils as U

PLAT_R, PLAT_H = 3.1, 0.25
FLOOR_Z = -PLAT_H

# name: (location, target, lens or ortho scale, f-stop (0 = no DOF), pose, output file)
CAMERAS = {
    "cam_hero":            ((2.9, -7.3, 0.55), (0.1, -0.2, 2.0), 30, 5.6, "Demo", "hero.png"),
    "cam_three_quarter":   ((-6.4, -6.6, 3.3), (0.0, 0.0, 1.95), 42, 6.3, "Neutral", "three_quarter.png"),
    "cam_torso_head":      ((1.55, -3.3, 3.85), (0.05, -0.1, 3.3), 55, 2.8, "Neutral", "torso_head.png"),
    "cam_leg_hydraulics":  ((2.55, -2.45, 0.95), (0.55, -0.1, 0.95), 42, 3.5, "Demo", "leg_hydraulics.png"),
    "cam_front":           ((0.0, -25.0, 2.2), (0.0, 0.0, 2.2), -8.6, 0, "Neutral", "front.png"),
    "cam_side":            ((25.0, 0.0, 2.2), (0.0, 0.0, 2.2), -8.6, 0, "Neutral", "side.png"),
}


def build(ctx):
    coll = U.sub_coll("Scene")
    M = ctx["mats"]
    kit = P.Kit(M, coll)
    out = []
    out += _platform(kit)
    out += _hangar(kit)
    _lights(coll)
    _haze(coll, M)
    _world()
    ctx["cameras"] = _cameras(coll)
    return out


# --------------------------------------------------------------------------- environment

def _octagon(r, n=8, rot=math.pi / 8):
    return [(r * math.cos(rot + math.tau * i / n), r * math.sin(rot + math.tau * i / n)) for i in range(n)]


def _platform(kit):
    out = []
    out.append(P.make("Scene_Platform", kit.coll, kit.m("concrete"),
                      lambda bm: P.bm_prism(bm, _octagon(PLAT_R), PLAT_H, U.T(z=-PLAT_H / 2), bevel=0.02), None,
                      wn=True))
    # hazard band on the platform's vertical faces + steel nosing on the top edge
    out.append(P.make("Scene_Platform_HazardBand", kit.coll, kit.m("hazard"),
                      lambda bm: P.bm_prism(bm, _octagon(PLAT_R + 0.006), 0.12, U.T(z=-0.11)), None, wn=False))
    def nosing(bm):
        pts = _octagon(PLAT_R + 0.012)
        for a, b in zip(pts, pts[1:] + pts[:1]):
            P.bm_beam(bm, (*a, -0.012), (*b, -0.012), 0.03, 0.03, bevel=0.004, x_hint=Vector((0, 0, 1)))
    out.append(P.make("Scene_Platform_SteelNosing", kit.coll, kit.m("steel_dark"), nosing, None, wn=False))
    # painted rings and stencils on the platform top
    out.append(P.make("Scene_Platform_MarkRing", kit.coll, kit.m("floor_paint"),
                      lambda bm: P.bm_prism(bm, P.annular_sector(2.55, 2.66, 0.0, math.tau * 0.999, 64), 0.003,
                                            U.T(z=0.0015)), None, wn=False))
    out.append(P.make("Scene_Platform_InnerRing", kit.coll, kit.m("floor_white"),
                      lambda bm: P.bm_prism(bm, P.annular_sector(1.55, 1.59, 0.0, math.tau * 0.999, 64), 0.003,
                                            U.T(z=0.0015)), None, wn=False))
    for i in range(6):           # chevrons leading to the front
        x = -0.75 + 0.3 * i
        out.append(P.make(f"Scene_Platform_Chevron_{i}", kit.coll, kit.m("floor_paint"),
                          lambda bm: P.bm_prism(bm, [(-0.09, 0.0), (0.0, 0.08), (0.09, 0.0), (0.09, 0.05), (0.0, 0.13),
                                                     (-0.09, 0.05)], 0.003, U.T(z=0.0015)),
                          U.T(x, -2.25, 0) @ U.R(180, "Z"), wn=False))
    out.append(D.label(kit, "Scene_Platform_Stencil_Bay", "BAY 09", U.T(0, -1.98, 0.0), 0.40,
                       mat="floor_white", depth=0.002))
    out.append(D.label(kit, "Scene_Platform_Stencil_Load", "MAX LOAD 42 t", U.T(0, -2.95 + 0.62, 0.0), 0.09,
                       mat="floor_white"))
    # tie-down anchors around the feet
    for x, y in ((0.95, 0.55), (-0.95, 0.55), (0.95, -0.85), (-0.95, -0.85)):
        out.append(P.make(f"Scene_TieDown_{'L' if x > 0 else 'R'}{'B' if y > 0 else 'F'}", kit.coll,
                          kit.m("steel_dark", "chrome"),
                          lambda bm: (P.bm_cyl(bm, 0.07, 0.02, U.T(z=0.01), segs=24, bevel=0.004),
                                      P.bm_torus(bm, 0.045, 0.012, U.T(z=0.05) @ U.R(90, "X"), segs=20, rsegs=8, mat=1)),
                          U.T(x, y, 0), wn=False))
    # bollards on four corners of the platform
    for i, a in enumerate((45, 135, 225, 315)):
        p = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0)) * (PLAT_R + 0.7)
        out.append(P.make(f"Scene_Bollard_{i}", kit.coll, kit.m("hazard", "steel_dark"),
                          lambda bm: (P.bm_cyl(bm, 0.09, 1.0, U.T(z=0.5), segs=24, bevel=0.02, mat=0),
                                      P.bm_cyl(bm, 0.14, 0.03, U.T(z=0.015), segs=24, bevel=0.006, mat=1)),
                          U.T(p.x, p.y, FLOOR_Z)))
    return out


def _hangar(kit):
    out = []
    out.append(P.make("Scene_Floor", kit.coll, kit.m("concrete"),
                      lambda bm: P.bm_box(bm, 60, 60, 0.1, U.T(z=-0.05)), U.T(0, 0, FLOOR_Z), wn=False))
    # floor markings: walkway lines and a hazard zone in front of the platform
    for x in (-5.2, 5.2):
        out.append(P.make(f"Scene_Floor_Line_{'L' if x > 0 else 'R'}", kit.coll, kit.m("floor_paint"),
                          lambda bm: P.bm_box(bm, 0.14, 30, 0.003), U.T(x, 0, FLOOR_Z + 0.0015), wn=False))
    out.append(P.make("Scene_Floor_HazardZone", kit.coll, kit.m("hazard"),
                      lambda bm: P.bm_box(bm, 6.0, 0.35, 0.003), U.T(0, -4.6, FLOOR_Z + 0.0015), wn=False))
    out.append(P.make("Scene_Floor_Grate", kit.coll, kit.m("steel_dark"),
                      lambda bm: [P.bm_box(bm, 0.025, 0.6, 0.012, U.T(x=-0.6 + 0.05 * i)) for i in range(25)],
                      U.T(-4.0, -2.0, FLOOR_Z + 0.006), wn=False))
    # back wall: ribbed panels, columns, girder, wall lights
    yb = 9.0
    out.append(P.make("Scene_BackWall", kit.coll, kit.m("steel_dark"),
                      lambda bm: P.bm_box(bm, 40, 0.3, 14), U.T(0, yb + 0.15, FLOOR_Z + 7), wn=False))
    out.append(P.make("Scene_BackWall_Ribs", kit.coll, kit.m("armor_dark"),
                      lambda bm: [P.bm_box(bm, 0.12, 0.12, 14, U.T(x=-19 + 0.8 * i)) for i in range(48)],
                      U.T(0, yb - 0.06, FLOOR_Z + 7), wn=False))
    for i, x in enumerate((-9, -4.5, 0, 4.5, 9)):
        out.append(P.make(f"Scene_Column_{i}", kit.coll, kit.m("hazard" if i % 2 else "steel_dark"),
                          lambda bm: (P.bm_box(bm, 0.45, 0.05, 12, U.T(y=-0.2)), P.bm_box(bm, 0.45, 0.05, 12, U.T(y=0.2)),
                                      P.bm_box(bm, 0.05, 0.4, 12)),
                          U.T(x, yb - 0.6, FLOOR_Z + 6), wn=False))
        out.append(P.make(f"Scene_WallLight_{i}", kit.coll, kit.m("steel_dark", "emit_amber"),
                          lambda bm: (P.bm_box(bm, 0.5, 0.12, 0.16, mat=0), P.bm_box(bm, 0.42, 0.02, 0.08, U.T(y=-0.06), mat=1)),
                          U.T(x + 2.25, yb - 0.15, FLOOR_Z + 4.2), wn=False))
    out.append(P.make("Scene_SideWall", kit.coll, kit.m("steel_dark"),
                      lambda bm: (P.bm_box(bm, 0.3, 30, 14),
                                  [P.bm_box(bm, 0.12, 0.12, 14, U.T(x=0.2, y=-14 + 1.2 * i)) for i in range(24)]),
                      U.T(-13.0, 0, FLOOR_Z + 7), wn=False))
    out.append(P.make("Scene_Girder", kit.coll, kit.m("steel_dark"),
                      lambda bm: (P.bm_box(bm, 40, 0.5, 0.06, U.T(z=0.6)), P.bm_box(bm, 40, 0.5, 0.06, U.T(z=-0.6)),
                                  [P.bm_beam(bm, (-19 + 1.2 * i, 0, -0.6), (-18.4 + 1.2 * i, 0, 0.6), 0.08, 0.08)
                                   for i in range(32)]),
                      U.T(0, yb - 1.2, FLOOR_Z + 8.5), wn=False))
    # side containers / crates for depth
    for i, (x, y, rz) in enumerate(((-7.5, 4.5, 10), (7.8, 5.5, -6), (-9.5, 0.5, 80))):
        out.append(P.make(f"Scene_Crate_{i}", kit.coll, kit.m("armor_dark", "hazard"),
                          lambda bm: (P.bm_box(bm, 2.4, 1.2, 1.3, U.T(z=0.65), bevel=0.03, mat=0),
                                      [P.bm_box(bm, 2.42, 0.04, 1.32, U.T(y=-0.6 + 0.3 * k, z=0.65), mat=0)
                                       for k in range(5)]),
                          U.T(x, y, FLOOR_Z) @ U.R(rz, "Z"), wn=False))
    return out


def _light(coll, name, kind, loc, target, energy, color=(1, 1, 1), size=1.0, spot=None, blend=0.3):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == "AREA":
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = size if isinstance(size, tuple) else (size, size)
    elif kind == "SPOT":
        ld.spot_size = math.radians(spot or 35)
        ld.spot_blend = blend
        ld.shadow_soft_size = size
    else:
        ld.shadow_soft_size = size
    ob = bpy.data.objects.new(name, ld)
    ob.matrix_world = U.look_matrix(loc, target)
    coll.objects.link(ob)
    return ob


def _lights(coll):
    _light(coll, "Light_Key", "AREA", (-4.8, -6.2, 6.8), (0, 0, 2.2), 1300, (1.0, 0.95, 0.88), (3.0, 2.0))
    _light(coll, "Light_Fill", "AREA", (6.5, -5.0, 2.2), (0, 0, 1.8), 140, (0.85, 0.9, 1.0), (4.0, 3.0))
    _light(coll, "Light_Rim_L", "AREA", (-4.2, 5.2, 5.0), (0, 0, 2.6), 3200, (0.55, 0.75, 1.0), (1.0, 3.0))
    _light(coll, "Light_Rim_R", "AREA", (4.6, 4.6, 3.6), (0, 0, 1.8), 2800, (1.0, 0.75, 0.45), (1.0, 3.0))
    _light(coll, "Light_Top", "AREA", (0.0, -0.5, 8.5), (0, 0, 0), 120, (1.0, 1.0, 1.0), (2.0, 2.0))
    _light(coll, "Light_Shaft_L", "SPOT", (-3.5, 7.5, 9.0), (0.3, 0.0, 0.0), 5000, (0.75, 0.85, 1.0), 0.15, 20, 0.25)
    _light(coll, "Light_Shaft_R", "SPOT", (4.5, 8.0, 8.5), (0.0, -0.5, 0.0), 3500, (1.0, 0.85, 0.65), 0.15, 16, 0.25)
    _light(coll, "Light_Kicker", "SPOT", (0.0, -3.5, -0.1), (0.0, 0.0, 1.0), 300, (1.0, 0.9, 0.8), 0.3, 40, 0.6)


def _haze(coll, M):
    """Thin volumetric haze in a box around the stage (cheap: low density, no volume bounces)."""
    mat = bpy.data.materials.new("M_haze")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.0025
    vol.inputs["Anisotropy"].default_value = 0.35
    vol.inputs["Color"].default_value = (0.8, 0.85, 0.9, 1)
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    me = bpy.data.meshes.new("Scene_Haze")
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(28, 24, 11), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, FLOOR_Z + 5.5), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new("Scene_Haze", me)
    ob.visible_shadow = False
    coll.objects.link(ob)
    return ob


def _world():
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.004, 0.005, 0.007, 1)
    bg.inputs[1].default_value = 1.0


def _cameras(coll):
    cams = {}
    for name, (loc, tgt, lens, fstop, pose, fn) in CAMERAS.items():
        cd = bpy.data.cameras.new(name)
        if lens < 0:
            cd.type = "ORTHO"
            cd.ortho_scale = -lens
        else:
            cd.lens = lens
            cd.sensor_width = 36
        cd.clip_start = 0.05
        cd.clip_end = 300
        if fstop:
            cd.dof.use_dof = True
            cd.dof.aperture_fstop = fstop
            cd.dof.focus_distance = (Vector(tgt) - Vector(loc)).length
        ob = bpy.data.objects.new(name, cd)
        ob.matrix_world = U.look_matrix(loc, tgt)
        ob["pose"] = pose
        ob["output"] = fn
        coll.objects.link(ob)
        cams[name] = ob
    bpy.context.scene.camera = cams["cam_hero"]
    return cams


# --------------------------------------------------------------------------- rendering

def final_settings(samples=128):
    qc.render_settings(samples=samples, res=(1920, 1080))
    sc = bpy.context.scene
    sc.cycles.adaptive_threshold = 0.015
    sc.cycles.max_bounces = 8
    sc.cycles.glossy_bounces = 4
    sc.cycles.volume_bounces = 0
    sc.cycles.volume_step_rate = 4.0
    sc.cycles.blur_glossy = 1.0
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.sample_clamp_indirect = 8.0
    sc.render.film_transparent = False


def render_all(root_dir, mode, samples=0, only=(), ctx=None):
    from . import rig
    cams = (ctx or {}).get("cameras") or {o.name: o for o in bpy.data.objects if o.name in CAMERAS}
    rg = (ctx or {}).get("rig")
    outdir = os.path.join(root_dir, "renders" if mode == "final" else os.path.join("renders", "preview"))
    os.makedirs(outdir, exist_ok=True)
    timings = {}
    for name, cam in cams.items():
        if only and name not in only:
            continue
        if mode == "final":
            final_settings(samples or 128)
        else:
            qc.render_settings(samples=samples or 32, res=(640, 360))
        rig.set_pose(rg, cam["pose"])
        haze = bpy.data.objects.get("Scene_Haze")
        if haze is not None:
            haze.hide_render = cam.data.type == "ORTHO"       # reference views stay crisp
        t0 = time.time()
        path = qc.render_view(cam, os.path.join(outdir, cam["output"]))
        timings[name] = round(time.time() - t0, 1)
        print(f"RENDERED {name} -> {path} in {timings[name]} s (pose {cam['pose']})", flush=True)
    rig.set_pose(rg, "Neutral")
    with open(os.path.join(outdir, "timings.txt"), "a") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} mode={mode} samples={samples} {timings}\n")
    return timings
