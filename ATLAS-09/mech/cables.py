"""Curve-based cable and hose routing.

Each run is a NURBS curve with bevel geometry, routed through a sagging, outward-bowed path
between two attachment points, with crimped end fittings. When a run crosses a joint, the
curve stores its two bones; ``rig.py`` then adds Hook modifiers, so the first half of the
control points follows bone A and the second half follows bone B, and the hose flexes with
the joint instead of tearing.
"""

import bpy
from mathutils import Vector

from . import primitives as P
from . import skeleton as SK
from . import utils as U


def run(kit, name, p0, p1, bone_a, bone_b, r=0.012, mat="hose", bow=None, sag=0.06, n=7, fittings=True,
        n0=None, n1=None):
    """One hose from p0 to p1. ``bow`` pushes the middle sideways, ``sag`` pulls it down.
    ``n0``/``n1`` are the exit directions at the ends (default: straight toward each other)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    n0 = Vector(n0).normalized() if n0 else d.normalized()
    n1 = Vector(n1).normalized() if n1 else -d.normalized()
    bow = Vector(bow) if bow is not None else Vector((0, 0, 0))
    L = d.length
    pts = []
    for i in range(n):
        t = i / (n - 1)
        base = p0.lerp(p1, t)
        # Hermite-like lead-out along the end normals, plus sag/bow peaking mid-span
        lead = n0 * (0.18 * L) * (1 - t) ** 2 * t * 3 + n1 * (0.18 * L) * t ** 2 * (1 - t) * 3
        mid = 4 * t * (1 - t)
        pts.append(base + lead + bow * mid + Vector((0, 0, -sag)) * mid)
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    cu.resolution_u = 10
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (*q, 1.0)
    sp.order_u = 4
    sp.use_endpoint_u = True
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(kit.M[mat])
    kit.coll.objects.link(ob)
    ob["bone"] = bone_a
    if bone_b and bone_b != bone_a:
        ob["hook_a"] = bone_a
        ob["hook_b"] = bone_b
        ob["hook_split"] = n // 2
    out = [ob]
    if fittings:
        for tag, p, nn, b in (("A", p0, n0, bone_a), ("B", p1, n1, bone_b or bone_a)):
            def fit(bm, r=r):
                P.bm_cyl(bm, r * 1.5, r * 2.5, U.T(z=r * 1.25), segs=6, mat=0)
                P.bm_cyl(bm, r * 1.25, r * 3.0, U.T(z=r * 3.9), segs=16, bevel=r * 0.2, mat=1)
            out.append(P.make(f"{name}_Fitting_{tag}", kit.coll, kit.m("titanium", "steel_dark"), fit,
                              U.frame(p, nn), b, wn=False))
    return out


def bundle(kit, name, p0, p1, bone_a, bone_b, count=3, spacing=0.03, mats=("hose", "cable_orange", "hose"),
           radii=None, side=Vector((1, 0, 0)), **kw):
    out = []
    side = Vector(side).normalized()
    for i in range(count):
        off = side * spacing * (i - (count - 1) / 2)
        r = radii[i] if radii else 0.011
        out += run(kit, f"{name}_{i}", Vector(p0) + off, Vector(p1) + off, bone_a, bone_b, r=r,
                   mat=mats[i % len(mats)], **kw)
    return out


def build(ctx):
    M = ctx["mats"]
    out = []
    # ----------------------------------------------------------------- torso + head
    kt = P.Kit(M, U.sub_coll("Torso"))
    kh = P.Kit(M, U.sub_coll("Head"))
    # pump (pelvis) -> manifolds (chest): crosses the waist
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        out += run(kt, f"Cable_Torso_PumpFeed_{sd}", (s * 0.15, 0.37, 2.27), (s * 0.55, 0.20, 2.76), "pelvis", "chest",
                   r=0.016, bow=(s * 0.10, 0.10, 0.0), sag=0.02, n0=(0, 0, 1), n1=(0, 0, 1))
        out += run(kt, f"Cable_Torso_PumpReturn_{sd}", (s * 0.10, 0.37, 2.27), (s * 0.55, 0.12, 2.76), "pelvis", "chest",
                   r=0.012, mat="hose", bow=(s * 0.06, 0.05, 0.0), sag=0.02, n0=(0, 0, 1), n1=(0, 0, 1))
        # manifold -> shoulder housing (chest -> shoulder bone), two hoses
        for i, dy in enumerate((-0.04, 0.04)):
            mx = s * (0.584 + 0.105)
            out += run(kt, f"Cable_Torso_ShoulderFeed_{sd}_{i}", (mx, 0.16 + dy, 2.86), (s * 0.86, 0.06 + dy * 2, 3.06),
                       "chest", f"shoulder.{sd}", r=0.011, bow=(s * 0.10, -0.02, 0), sag=0.0,
                       n0=(s, 0, 0), n1=(0, 0, -1))
    # core power conduits (orange) running down to the waist
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        out += run(kt, f"Cable_Torso_CorePower_{sd}", (s * 0.30, -0.20, 2.70), (s * 0.17, -0.04, 2.40),
                   "chest", "spine", r=0.014, mat="cable_orange", bow=(s * 0.10, -0.02, 0), sag=0.0,
                   n0=(0, 0, -1), n1=(0, 0, -1))
    # neck: data + power bundle chest -> head back, plus a hydraulic line to the tilt actuator
    out += bundle(kh, "Cable_Neck", (0.0, 0.16, 3.47), (0.0, 0.17, 3.70), "chest", "head", count=3, spacing=0.035,
                  mats=("hose", "cable_orange", "cable_red"), radii=(0.012, 0.01, 0.008), bow=(0, 0.10, 0), sag=0.0,
                  n0=(0, 0.3, 1), n1=(0, 0.3, -1))
    for s in (1, -1):
        out += run(kh, f"Cable_Neck_Side_{'L' if s > 0 else 'R'}", (s * 0.16, -0.02, 3.47), (s * 0.20, 0.04, 3.68),
                   "chest", "head", r=0.009, mat="hose", bow=(s * 0.08, 0, 0), sag=0.0, n0=(0, 0, 1), n1=(0, 0, -1))
    # ----------------------------------------------------------------- legs
    for side in ("L", "R"):
        s = SK.side_sign(side)
        kl = P.Kit(M, U.sub_coll(f"Leg_{side}"))
        Mt, Lt = SK.seg(f"thigh.{side}")
        Ms, Ls = SK.seg(f"shin.{side}")
        A = SK.head(f"foot.{side}")
        # pump -> knee actuator top port (crosses the hip)
        out += run(kl, f"Cable_Leg_{side}_HipFeed", (s * 0.22, 0.30, 2.10), Mt @ Vector((s * 0.07, -0.20, -0.30)),
                   "pelvis", f"thigh.{side}", r=0.013, bow=(s * 0.18, -0.10, 0), sag=0.05, n0=(s, 0, -0.3),
                   n1=(0, 0, 1))
        # rear knee hoses: thigh -> shin across the knee
        out += run(kl, f"Cable_Leg_{side}_KneeRear", Mt @ Vector((s * 0.0, 0.13, -0.55)),
                   Ms @ Vector((s * 0.0, 0.13, -0.35)), f"thigh.{side}", f"shin.{side}", r=0.012,
                   bow=Mt.to_3x3() @ Vector((0, 0.10, 0)), sag=0.0, n0=Mt.to_3x3() @ Vector((0, 0, -1)),
                   n1=Ms.to_3x3() @ Vector((0, 0, 1)))
        out += run(kl, f"Cable_Leg_{side}_KneeSensor", Mt @ Vector((s * 0.12, 0.10, -0.62)),
                   Ms @ Vector((s * 0.14, 0.11, -0.28)), f"thigh.{side}", f"shin.{side}", r=0.007, mat="cable_orange",
                   bow=Mt.to_3x3() @ Vector((s * 0.12, 0.06, 0)), sag=0.0)
        # ankle hose: shin -> heel
        out += run(kl, f"Cable_Leg_{side}_Ankle", Ms @ Vector((0.0, 0.12, -0.62)), A + Vector((0.0, 0.20, -0.08)),
                   f"shin.{side}", f"foot.{side}", r=0.011, bow=(0, 0.10, 0), sag=0.0, n0=Ms.to_3x3() @ Vector((0, 0, -1)),
                   n1=(0, 0, 1))
    # ----------------------------------------------------------------- arms
    for side in ("L", "R"):
        s = SK.side_sign(side)
        ka = P.Kit(M, U.sub_coll(f"Arm_{side}"))
        Mu, Lu = SK.seg(f"upperarm.{side}")
        Mf, Lf = SK.seg(f"forearm.{side}")
        Mw, Lw = SK.seg(f"wrist.{side}")
        J = SK.head(f"upperarm.{side}")
        # shoulder housing -> upper arm
        out += run(ka, f"Cable_Arm_{side}_Shoulder", (s * 0.90, 0.24, 3.12), Mu @ Vector((s * 0.08, 0.14, -0.30)),
                   f"shoulder.{side}", f"upperarm.{side}", r=0.012, bow=(s * 0.10, 0.08, 0), sag=0.0,
                   n0=(0, 0, -1), n1=Mu.to_3x3() @ Vector((0, 0, 1)))
        # elbow crossing (outer side)
        out += run(ka, f"Cable_Arm_{side}_Elbow", Mu @ Vector((s * 0.12, 0.10, -0.44)),
                   Mf @ Vector((s * 0.13, 0.10, -0.22)), f"upperarm.{side}", f"forearm.{side}", r=0.012,
                   bow=Mu.to_3x3() @ Vector((s * 0.14, 0.06, 0)), sag=0.0)
        # forearm -> wrist quick connects (two hoses looping round the rotating collar)
        for i, x in enumerate((-0.05, 0.05)):
            out += run(ka, f"Cable_Arm_{side}_Wrist_{i}", Mf @ Vector((x, 0.17, -0.50)), Mw @ Vector((x, 0.11, -0.03)),
                       f"forearm.{side}", f"wrist.{side}", r=0.009, bow=Mf.to_3x3() @ Vector((0, 0.09, 0)), sag=0.0,
                       n0=Mf.to_3x3() @ Vector((0, 0.3, -1)), n1=Mw.to_3x3() @ Vector((0, 0, 1)))
        if side == "R":
            # drill motor feed (forearm -> drill motor on the wrist)
            out += run(ka, "Cable_Arm_R_DrillFeed", Mf @ Vector((-0.10, -0.12, -0.50)),
                       Mw @ Vector((0.0, -0.12, -0.20)), "forearm.R", "wrist.R", r=0.013, mat="hose",
                       bow=Mf.to_3x3() @ Vector((0.05, -0.12, 0)), sag=0.0, n1=Mw.to_3x3() @ Vector((0, -1, 0)))
    return out
