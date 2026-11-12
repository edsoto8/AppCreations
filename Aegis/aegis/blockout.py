"""Milestone 1: proportion blockout - one tapered volume per bone."""
from mathutils import Vector

from . import rig
from .geo import Part


def radius_for(name):
    for key, r in (("neck", 0.4), ("head", 0.42), ("jaw", 0.16), ("tail", None), ("arm_upper", 0.3), ("arm_lower", 0.24),
                   ("thigh", 0.36), ("shin", 0.25), ("meta", 0.18), ("hand", 0.2), ("foot", 0.2), ("toe", 0.08),
                   ("dew", 0.07), ("wing_arm", 0.17), ("wing_fore", 0.14), ("wing_f", 0.07), ("wing_strut", 0.06),
                   ("wing_thumb", 0.06), ("wing_base", 0.25)):
        if key in name:
            return r
    return None


def build(arm, coll, mats):
    out = []
    for name, head, tail, parent, zax in rig.bone_specs():
        if name.startswith(("ik_", "root", "brow", "cheek", "wing_panel", "body", "chest")):
            continue
        r = radius_for(name)
        if name.startswith("tail"):
            i = int(name[-2:]) - 1
            r = rig.tail_radius(i)
        if r is None:
            continue
        p = Part("BLK_" + name)
        p.sweep([head, head.lerp(tail, 0.15), head.lerp(tail, 0.85), tail], [r * 0.6, r, r * 0.85, r * 0.5],
                mats["AEGIS_Titanium_Light"], n=10, up=Vector(zax))
        out.append(rig.attach(p.finish(coll), arm, name))
    # torso hull
    import math
    p = Part("BLK_torso")
    ys = [-2.95 + i * 5.9 / 24 for i in range(25)]
    p.grid([[rig.torso_pt(y, 2 * math.pi * k / 24) for k in range(24)] for y in ys], mats["AEGIS_Titanium"], closed=True, cap=True)
    out.append(rig.attach(p.finish(coll), arm, "body"))
    # wing membranes (flat)
    for sx, s in ((1, "L"), (-1, "R")):
        p = Part("BLK_membrane." + s)
        w = lambda uv: rig.wing_pt(sx, uv[0], uv[1])
        fan = [rig.finger_pts(k)[2] for k in range(4)] + [Vector(rig.W_STRUT), Vector((0.1, 3.2))]
        for a, b in zip(fan, fan[1:]):
            p.grid([[w(rig.W_WRIST), w(rig.W_WRIST)], [w(a), w(b)]], mats["AEGIS_Energy_Membrane"])
        out.append(rig.attach(p.finish(coll, bevel=0), arm, "wing_fore." + s))
    return out
