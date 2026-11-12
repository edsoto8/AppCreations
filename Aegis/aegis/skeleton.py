"""Milestone 2: the mechanical skeleton - spine, ribs, frames, limb structure, joints and hydraulics."""
import math
from math import cos, pi, radians, sin

from mathutils import Matrix, Vector

from . import rig
from .geo import Part, V, X, Y, Z, catmull, frame, frame4, get_coll, lerp, table
from .rig import TORSO, attach, piston, to_world, torso_pt


def vertebra(p, L, r, m, conduit=True):
    """One spinal module in the current Part frame: +Y along the spine, +Z dorsal."""
    G, CH, AU, TL, CF = m["AEGIS_Gunmetal"], m["AEGIS_Chrome"], m["AEGIS_Gold"], m["AEGIS_Titanium_Light"], m["AEGIS_Carbon"]
    p.lathe((0, L * 0.14, 0), Y, [(0, 0), (0, r * 0.42), (L * 0.06, r * 0.52), (L * 0.12, r * 0.52), (L * 0.16, r * 0.4),
                                  (L * 0.54, r * 0.4), (L * 0.58, r * 0.52), (L * 0.64, r * 0.52), (L * 0.7, r * 0.42),
                                  (L * 0.7, 0)], G, 20)
    p.lathe((0, L * 0.4, 0), Y, [(0, r * 0.4), (0, r * 0.45), (L * 0.1, r * 0.45), (L * 0.1, r * 0.4)], AU, 20)
    p.ball((0, 0, 0), r * 0.36, CH, 18, Y)                      # articulation ball
    p.ring((0, L * 0.1, 0), Y, r * 0.36, r * 0.06, TL, 20, 6)   # socket collar
    # dorsal + lateral processes with actuator eyes
    p.beam((0, L * 0.3, r * 0.3), (0, L * 0.62, r * 0.92), r * 0.2, r * 0.34, CF, up=Y, taper=0.55)
    for s in (-1, 1):
        p.beam((s * r * 0.3, L * 0.45, 0.02), (s * r * 0.78, L * 0.36, 0.05), r * 0.3, r * 0.16, TL, up=Z, taper=0.7)
        p.cyl((s * r * 0.74, L * 0.36, -r * 0.06), (s * r * 0.74, L * 0.36, r * 0.16), r * 0.1, CH, 12)
        # hydraulic hoses
        p.sweep(catmull([(s * r * 0.3, L * 0.02, -r * 0.42), (s * r * 0.36, L * 0.5, -r * 0.5),
                         (s * r * 0.3, L * 0.98, -r * 0.42)], 5), r * 0.06, m["AEGIS_Rubber"], 8)
    if conduit:
        E = m["AEGIS_Energy_Conduit"]
        p.cyl((0, L * 0.12, -r * 0.6), (0, L * 0.9, -r * 0.6), r * 0.1, E, 12)
        for t in (0.1, 0.5, 0.88):
            p.lathe((0, L * t, -r * 0.6), Y, [(0, 0), (0, r * 0.15), (L * 0.06, r * 0.15), (L * 0.06, 0)], AU, 12)
        p.beam((0, L * 0.5, -r * 0.4), (0, L * 0.5, -r * 0.58), r * 0.12, L * 0.08, G, up=Y)


def chain(ctx, prefix, n, radius_fn, name, pistons_upto):
    arm, m = ctx["arm"], ctx["mats"]
    for i in range(n):
        bone = "%s_%02d" % (prefix, i + 1)
        L = arm.data.bones[bone].length
        r = radius_fn(i)
        p = Part("SK_%s_%02d_vertebra" % (name, i + 1))
        vertebra(p, L, r, m)
        attach(p.finish(ctx["c_sk"], bevel=0.006), arm, bone, local=True)
        if 0 < i <= pistons_upto:
            prev = "%s_%02d" % (prefix, i)
            rp, Lp = radius_fn(i - 1), arm.data.bones[prev].length
            for s, tag in ((1, "a"), (-1, "b")):
                piston("HY_%s_%02d%s" % (name, i, tag), arm, prev, to_world(arm, prev, (s * rp * 0.74, Lp * 0.36, rp * 0.05)),
                       bone, to_world(arm, bone, (s * r * 0.74, L * 0.36, r * 0.05)), r * 0.085, ctx["c_hy"],
                       ctx["c_help"], m)


def torso(ctx):
    arm, m = ctx["arm"], ctx["mats"]
    G, CH, AU, TL, CF = m["AEGIS_Gunmetal"], m["AEGIS_Chrome"], m["AEGIS_Gold"], m["AEGIS_Titanium_Light"], m["AEGIS_Carbon"]
    p = Part("SK_spine")
    for i in range(9):
        y = -2.5 + i * 0.6
        cz, w, h = table(TORSO, y + 0.3)
        p.at(Matrix.Translation((0, y, cz + h * 0.5)))
        vertebra(p, 0.6, 0.44, m)
    attach(p.at(Matrix.Identity(4)).finish(ctx["c_sk"], bevel=0.006), arm, "body")

    # rib cage
    p = Part("SK_ribcage")
    for i in range(9):
        y0 = -2.42 + i * 0.4
        a_end = radians(104) if y0 < -1.45 else radians(170)      # leave the reactor bay open
        for s in (-1, 1):
            pts = []
            for k in range(15):
                a = lerp(radians(13), a_end, k / 14)
                pts.append(torso_pt(y0 + 0.22 * sin(a) ** 2, a * s, scale=0.84))
            p.sweep(pts, [(lerp(0.085, 0.06, k / 14), 0.04) for k in range(15)], TL, n=8, up=Y, exp=3.0)
            p.ball(pts[0], 0.075, CH, 12)
            cz, w, h = table(TORSO, y0 + 0.3)
            p.cyl(pts[0], (s * 0.14, y0 + 0.3, cz + h * 0.5), 0.035, G, 8)
            p.lathe(pts[7], pts[8] - pts[6], [(-0.04, 0.0), (-0.04, 0.075), (0.04, 0.075), (0.04, 0.0)], AU, 10)
            if a_end < 2:
                p.ball(pts[-1], 0.07, CH, 12)
    # sternum keel + longerons
    keel = [torso_pt(y, pi, scale=0.84) for y in [-1.45 + k * 0.2 for k in range(12)]]
    p.sweep(keel, (0.07, 0.17), G, n=10, exp=4.0)
    for s in (-1, 1):
        for a, rr in ((radians(104), 0.06), (radians(60), 0.045)):
            p.sweep([torso_pt(y, a * s, scale=0.855) for y in [-2.6 + k * 0.25 for k in range(22)]], rr, CF, n=10)
    attach(p.finish(ctx["c_sk"], bevel=0.005), arm, "body")

    # pelvis / waist frames
    p = Part("SK_pelvis_frames")
    for y in (1.15, 1.7, 2.25, 2.75):
        p.sweep([torso_pt(y, 2 * pi * k / 28, scale=0.84) for k in range(29)], (0.05, 0.08), TL, n=8, up=Y, exp=3.0,
                cap=False)
    for s in (-1, 1):
        for a in (radians(35), radians(140)):
            ys = [0.9 + k * 0.31 for k in range(7)]
            for i in range(len(ys) - 1):   # X bracing of the exposed waist truss
                a2 = radians(100)
                p.cyl(torso_pt(ys[i], a * s, scale=0.84), torso_pt(ys[i + 1], a2 * s, scale=0.84), 0.022, CH, 8)
    # shoulder + hip axles
    for y, z, x, r in ((-1.75, 2.85, 1.32, 0.17), (2.2, 2.75, 1.27, 0.19)):
        p.lathe((-x + 0.2, y, z), X, [(0, 0), (0, r), (0.2, r), (0.24, r * 0.75), (2 * x - 0.64, r * 0.75),
                                      (2 * x - 0.6, r), (2 * x - 0.4, r), (2 * x - 0.4, 0)], G, 20)
        for s in (-1, 1):
            p.beam((s * x * 0.5, y, z + 0.1), (s * 0.2, y + 0.1, z + 0.75), 0.12, 0.2, TL, up=Y)
            p.ring((s * x * 0.55, y, z), X, r * 0.8, 0.035, AU, 20, 6)
    attach(p.finish(ctx["c_sk"], bevel=0.006), arm, "body")


def limb_segment(p, a, b, r, m, side, hose=True):
    """Structural limb member from a to b: twin rails, core tube, spacers, collars, hose."""
    G, CH, AU, TL = m["AEGIS_Gunmetal"], m["AEGIS_Chrome"], m["AEGIS_Gold"], m["AEGIS_Titanium_Light"]
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    fr = frame(d, V(0, -1, 0))        # local z = limb front
    lat = fr @ X
    front = fr @ Z
    L = (b - a).length
    p.cyl(a + d * r * 0.5, b - d * r * 0.5, r * 0.3, G, 14)
    for s in (-1, 1):
        o = lat * s * r * 0.6
        p.beam(a + o + d * r * 0.2, b + o - d * r * 0.2, r * 0.2, r * 0.62, TL, up=front, taper=0.8)
    for t in (0.28, 0.5, 0.72):
        c = a.lerp(b, t)
        p.cyl(c - lat * r * 0.72, c + lat * r * 0.72, r * 0.1, CH, 10)
        p.lathe(c - d * r * 0.1, d, [(0, r * 0.3), (0, r * 0.38), (r * 0.2, r * 0.38), (r * 0.2, r * 0.3)], AU, 14)
    if hose:
        pts = [a + d * L * t - front * r * (0.45 + 0.12 * sin(t * pi)) + lat * side * r * 0.2 for t in (0.1, 0.3, 0.5, 0.7, 0.9)]
        p.sweep(catmull(pts, 4), r * 0.085, m["AEGIS_Rubber"], 8)
        p.sweep(catmull([q + lat * side * r * 0.2 for q in pts], 4), r * 0.05, m["AEGIS_Copper"], 6)


def toe(ctx, stem, a, mid, tip, scale=1.0):
    """Two articulated phalanges and a hooked claw. a/mid/tip in world space."""
    arm, m = ctx["arm"], ctx["mats"]
    CH, AU, TL, G = m["AEGIS_Chrome"], m["AEGIS_Gold"], m["AEGIS_Titanium_Light"], m["AEGIS_Gunmetal"]
    d1 = (mid - a).normalized()
    lat = d1.cross(Z).normalized()
    p = Part("SK_%s_phalanx" % stem.replace("_@", ""))
    p.joint(a, lat, 0.085 * scale, 0.22 * scale, CH, AU)
    p.sweep([a + d1 * 0.05, mid - d1 * 0.05], [(0.065 * scale, 0.085 * scale), (0.05 * scale, 0.065 * scale)], TL, n=10, exp=3.5)
    p.cyl(a + Z * 0.07 * scale + d1 * 0.08, mid + Z * 0.05 * scale - d1 * 0.08, 0.018 * scale, CH, 8)   # extensor rod
    attach(p.finish(ctx["c_sk"], bevel=0.004), arm, stem.replace("@", "a"))
    d2 = (tip - mid)
    p = Part("SK_%s_claw" % stem.replace("_@", ""))
    p.joint(mid, lat, 0.07 * scale, 0.19 * scale, CH, AU)
    ctrl = mid + d1 * d2.length * 0.62 + Z * 0.04
    pts, rad = [], []
    for k in range(11):
        t = k / 10
        q = (1 - t) ** 2 * mid + 2 * t * (1 - t) * ctrl + t * t * tip
        pts.append(q)
        w = lerp(0.072, 0.004, t ** 0.8) * scale
        rad.append((w * 1.25, w * 0.72))
    p.sweep(pts, rad, m["AEGIS_Tooth"], n=10, exp=1.7)
    p.lathe(pts[1], pts[2] - pts[0], [(-0.03, 0.06 * scale), (-0.03, 0.095 * scale), (0.03, 0.09 * scale), (0.03, 0.06 * scale)], AU, 12)
    attach(p.finish(ctx["c_sk"], bevel=0.003), arm, stem.replace("@", "b"))


def legs(ctx):
    arm, m = ctx["arm"], ctx["mats"]
    G, CH, AU, TL = m["AEGIS_Gunmetal"], m["AEGIS_Chrome"], m["AEGIS_Gold"], m["AEGIS_Titanium_Light"]
    hy, hp = ctx["c_hy"], ctx["c_help"]
    for sx, s in ((1, "L"), (-1, "R")):
        f = rig.front_leg(sx)
        r_ = rig.rear_leg(sx)
        segs = [("arm_upper", f["S"], f["E"], 0.3, 0.33, 0.56), ("arm_lower", f["E"], f["W"], 0.24, 0.25, 0.46),
                ("thigh", r_["H"], r_["K"], 0.34, 0.37, 0.6), ("shin", r_["K"], r_["Hk"], 0.25, 0.27, 0.5),
                ("meta", r_["Hk"], r_["A"], 0.19, 0.22, 0.42)]
        for bone, a, b, r, rj, wj in segs:
            p = Part("SK_%s.%s" % (bone, s))
            p.joint(a, X, rj, wj, CH, AU, TL)
            limb_segment(p, a, b, r, m, sx)
            attach(p.finish(ctx["c_sk"], bevel=0.006), arm, "%s.%s" % (bone, s))
        for bone, a, b, rj in (("hand", f["W"], f["P"], 0.19), ("foot", r_["A"], r_["P"], 0.18)):
            p = Part("SK_%s.%s" % (bone, s))
            p.joint(a, X, rj, 0.4, CH, AU, TL)
            d = (b - a).normalized()
            p.sweep([a + d * 0.1, a.lerp(b, 0.6), b + d * 0.06], [(0.1, 0.2), (0.105, 0.36), (0.09, 0.43)], G, n=14, exp=4.0)
            for off in (-0.27, 0, 0.27):   # knuckle yokes
                p.box(b + V(off, -0.0, 0.0), (0.15, 0.16, 0.2), TL)
            p.box(b + V(0, 0.42, 0.17) - V(0, 0.06, 0), (0.16, 0.22, 0.16), TL)
            p.beam(a + V(0, 0.05, -0.1), b + V(0, 0.4, 0.14), 0.12, 0.1, G)
            attach(p.finish(ctx["c_sk"], bevel=0.006), arm, "%s.%s" % (bone, s))
        for pre, P in (("f", f["P"]), ("r", r_["P"])):
            for stem, a, mid, tip in rig.toe_specs(P, sx):
                toe(ctx, "%s%s_@.%s" % (pre, stem, s), a, mid, tip, 1.0 if stem != "dew" else 0.8)

        # hydraulics (world rest anchors)
        fwd = V(0, -1, 0)
        x = f["S"].x

        def off(a, b, t, front, lat=0.0):
            d = (b - a).normalized()
            fr = frame(d, fwd)
            return a.lerp(b, t) + (fr @ Z) * front + X * lat * sx

        piston("HY_shoulder." + s, arm, "chest", V(x - 0.12 * sx, -1.0, 3.3), "arm_upper." + s,
               off(f["S"], f["E"], 0.62, -0.3, -0.12), 0.075, hy, hp, m, short=0.72)
        piston("HY_elbow." + s, arm, "arm_upper." + s, off(f["S"], f["E"], 0.15, 0.3), "arm_lower." + s,
               off(f["E"], f["W"], 0.75, 0.26), 0.06, hy, hp, m, short=0.62)
        piston("HY_wrist." + s, arm, "arm_lower." + s, off(f["E"], f["W"], 0.45, -0.24), "hand." + s,
               f["W"] + V(0, 0.34, -0.12), 0.045, hy, hp, m, short=0.72)
        x = r_["H"].x
        piston("HY_hip." + s, arm, "body", V(x - 0.1 * sx, 1.35, 3.25), "thigh." + s,
               off(r_["H"], r_["K"], 0.6, 0.34, -0.1), 0.085, hy, hp, m)
        piston("HY_knee." + s, arm, "thigh." + s, off(r_["H"], r_["K"], 0.35, -0.34), "shin." + s,
               off(r_["K"], r_["Hk"], 0.5, -0.27), 0.065, hy, hp, m, short=0.54)
        piston("HY_hock." + s, arm, "shin." + s, off(r_["K"], r_["Hk"], 0.4, 0.26), "meta." + s,
               off(r_["Hk"], r_["A"], 0.6, 0.2), 0.05, hy, hp, m)
        # piston mounting lugs on the frame
        p = Part("SK_actuator_mounts." + s)
        for c in (V(f["S"].x - 0.12 * sx, -1.0, 3.3), V(x - 0.1 * sx, 1.35, 3.25)):
            p.box(c + V(-0.14 * sx, 0, 0.02), (0.14, 0.2, 0.26), TL)
            p.beam(c + V(-0.2 * sx, 0, 0), V(c.x * 0.55, c.y, c.z + 0.12), 0.14, 0.14, G)
        attach(p.finish(ctx["c_sk"], bevel=0.006), arm, "body")


def build(ctx):
    root = ctx["root"]
    ctx["c_sk"] = get_coll("AEGIS_Skeleton", root)
    ctx["c_hy"] = get_coll("AEGIS_Hydraulics", root)
    ctx["c_help"] = get_coll("AEGIS_Rig_Helpers", root)
    torso(ctx)
    chain(ctx, "neck", rig.N_NECK, rig.neck_radius, "neck", 6)
    chain(ctx, "tail", rig.N_TAIL, rig.tail_radius, "tail", 9)
    legs(ctx)
    from . import head, wings
    head.build_core(ctx)
    wings.build_structure(ctx)
