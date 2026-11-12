"""Milestone 4: the chest reactor - energy sphere, three gimballed rings, glass housing,
support frame, conduits and the lights the energy systems cast."""
from math import cos, pi, radians, sin

import bpy
from mathutils import Matrix, Vector

from . import materials, rig
from .geo import Part, V, X, Y, Z, catmull, frame, get_coll, table
from .rig import TORSO, attach, torso_pt

C = Vector((0, -2.05, 2.42))
R = 0.62


def ring_part(name, Rr, r, body, m, pins_axis, n_notch):
    p = Part(name)
    p.ring((0, 0, 0), Z, Rr, r, body, 48, 8, exp=4.0)
    for k in range(n_notch):
        a = 2 * pi * k / n_notch
        d = V(cos(a), sin(a), 0)
        if k % 2 == 0:
            p.box(d * (Rr + r * 0.75), (r * 1.3, r * 2.6, r * 2.4), m["AEGIS_Gunmetal"], rot=frame(d.cross(Z), Z))
        else:
            for s in (-1, 1):
                p.box(d * Rr + Z * s * r * 1.02, (r * 2.6, r * 0.9, r * 0.2), m["AEGIS_Energy_Ring"], rot=frame(d, Z))
    ax = Vector(pins_axis)
    for s in (-1, 1):   # gimbal trunnion pins to the next ring out
        p.cyl(ax * s * (Rr + r), ax * s * (Rr + 0.1 - r * 0.6), r * 0.55, m["AEGIS_Chrome"], 12)
        p.lathe(ax * s * (Rr + r * 0.8), ax * s, [(0, r * 0.5), (0, r * 1.1), (r * 0.8, r * 1.1), (r * 0.8, r * 0.5)],
                m["AEGIS_Gold"], 12)
    return p


def build(ctx):
    arm, m = ctx["arm"], ctx["mats"]
    G, CH, AU, TL, T = (m[k] for k in ("AEGIS_Gunmetal", "AEGIS_Chrome", "AEGIS_Gold", "AEGIS_Titanium_Light", "AEGIS_Titanium"))
    c = get_coll("AEGIS_Reactor", ctx["root"])
    pivot = bpy.data.objects.new("RX_pivot", None)
    pivot.empty_display_size = 0.2
    c.objects.link(pivot)
    attach(pivot, arm, "body", basis=Matrix.Translation(C))

    # energy sphere + containment cage
    p = Part("RX_core")
    p.ball((0, 0, 0), 0.19, m["AEGIS_Energy_Core"], 32)
    core = p.finish(c, bevel=0)
    core.parent = pivot
    core.visible_shadow = False
    p = Part("RX_core_cage")
    for ax in (X, Y, Z):
        p.ring((0, 0, 0), ax, 0.215, 0.007, CH, 40, 6)
    for s in (-1, 1):
        p.lathe(Z * s * 0.2, Z * s, [(0, 0.05), (0.03, 0.045), (0.06, 0.02), (0.11, 0.02)], AU, 14)
    cage = p.finish(c, bevel=0)
    cage.parent = pivot

    # gimballed rings (outer -> inner), each pinned across a diameter of its parent
    rings = []
    parent = pivot
    for name, Rr, r, mat, axis, notch in (("RX_ring_outer", 0.5, 0.03, TL, X, 16), ("RX_ring_mid", 0.4, 0.027, AU, Y, 12),
                                          ("RX_ring_inner", 0.305, 0.024, CH, X, 10)):
        ob = ring_part(name, Rr, r, mat, m, axis, notch).finish(c, bevel=0.003)
        ob.parent = parent
        ob["spin_axis"] = 0 if axis is X else 1
        rings.append(ob)
        parent = ob
    ctx["rings"] = rings

    # transparent protective housing
    p = Part("RX_housing_glass")
    p.ball((0, 0, 0), R, m["AEGIS_Glass"], 48)
    glass = p.finish(c, bevel=0)
    glass.parent = pivot
    glass.visible_shadow = False

    # support framework (world space, bolted to the torso frame)
    p = Part("RX_support_frame")
    view = V(0, -0.78, -0.62).normalized()                     # viewing port faces forward/down
    p.ring(C + view * 0.415, view, 0.47, 0.035, AU, 48, 8, exp=3.0)
    fm = frame(view)
    for k in range(12):
        a = 2 * pi * k / 12
        d = fm @ V(cos(a), 0, sin(a))
        p.bolt(C + view * 0.45 + d * 0.47, view, 0.018, CH)
    back = -view
    p.lathe(C + back * 0.5, back, [(0, 0.38), (0.06, 0.37), (0.13, 0.3), (0.17, 0.16), (0.24, 0.14), (0.24, 0)], G, 32)
    p.ring(C + back * 0.52, back, 0.375, 0.03, TL, 40, 8, exp=3.0)
    for k in range(6):                                           # meridian ribs between rear cap and port ring
        a = 2 * pi * k / 6 + 0.3
        d = fm @ V(cos(a), 0, sin(a))
        pts = [C + (back * cos(t) + d * sin(t)) * (R + 0.02) for t in [radians(38 + 14 * j) for j in range(8)]]
        p.sweep(pts, (0.022, 0.045), TL, n=8, up=back, exp=3.0)
        p.bolt(pts[3] + (pts[3] - C).normalized() * 0.02, pts[3] - C, 0.016, CH)
    # trunnion bosses where the outer ring pins meet the housing
    for s in (-1, 1):
        p.lathe(C + X * s * (R - 0.02), X * s, [(0, 0.09), (0.05, 0.09), (0.07, 0.06), (0.26, 0.06), (0.26, 0.11),
                                               (0.32, 0.11), (0.32, 0)], G, 20)
        p.ring(C + X * s * (R + 0.03), X, 0.09, 0.014, AU, 20, 6)
        # cradle arms to the shoulder axle and the sternum keel
        p.beam(C + X * s * (R + 0.26), V(s * 0.95, -1.75, 2.85), 0.09, 0.12, TL, up=Y)
        p.beam(C + back * 0.7 + X * s * 0.12, torso_pt(-1.4, pi, scale=0.84) + V(s * 0.1, 0, 0.04), 0.07, 0.1, TL, up=X)
    p.beam(C + back * 0.72, V(0, -1.95, 3.42), 0.12, 0.12, G, up=X)
    attach(p.finish(c, bevel=0.004), arm, "body")

    # energy conduits radiating from the reactor
    p = Part("RX_conduits")
    E = m["AEGIS_Energy_Conduit"]

    def conduit(pts, r=0.034):
        sp = catmull(pts, 6)
        p.sweep(sp, r, E, 10)
        for q, d in ((sp[0], sp[1] - sp[0]), (sp[-1], sp[-1] - sp[-2]), (sp[len(sp) // 2], sp[len(sp) // 2 + 1] - sp[len(sp) // 2])):
            p.lathe(q - d.normalized() * 0.04, d, [(0, 0), (0, r * 1.7), (0.08, r * 1.7), (0.08, 0)], AU, 12)

    for s in (-1, 1):
        top = C + (back * 0.55 + V(s * 0.3, 0, 0.5)).normalized() * (R + 0.03)
        conduit([top, V(s * 0.42, -1.9, 3.25), V(s * 0.5, -1.55, 3.55), V(s * 0.56, -1.32, 3.72)])                 # wings
        conduit([C + V(s * 0.3, -0.25, 0.5).normalized() * (R + 0.03), V(s * 0.3, -2.5, 3.2), V(s * 0.22, -2.75, 3.3)])  # neck
        conduit([C + V(s * 0.62, 0.25, 0.25).normalized() * (R + 0.03), V(s * 0.85, -1.85, 2.72), V(s * 1.02, -1.78, 2.82)],
                0.03)                                                                                            # shoulders
    cz, w, h = table(TORSO, -1.6)
    conduit([C + back * (R + 0.26), V(0, -1.7, 3.1), V(0, -1.55, cz + h * 0.5 - 0.3)], 0.045)                        # spine trunk
    attach(p.finish(c, bevel=0.003), arm, "body")

    # lights cast by the energy systems (driven by the same rig properties as the materials)
    lc = get_coll("AEGIS_Energy_Lights", ctx["root"])

    def light(name, bone, loc, watts, prop, expr, size=0.25):
        ld = bpy.data.lights.new(name, 'POINT')
        ld.color = (0.25, 0.85, 1.0)
        ld.energy = watts
        ld.shadow_soft_size = size
        lo = bpy.data.objects.new(name, ld)
        lc.objects.link(lo)
        attach(lo, arm, bone, basis=Matrix.Translation(loc))
        materials._drive(ld, "energy", arm, prop, expr % watts)
        return lo

    light("RX_core_light", "body", C, 480.0, "energy", "e*%g*(1+0.22*sin(frame/3.5))", size=0.28)
    light("HD_throat_light", "head", rig.head_pt(0.75, 0, -0.2), 260.0, "throat_power", "e*%g", size=0.1)
    for sx, s in ((1, "L"), (-1, "R")):
        light("HD_eye_light." + s, "head", rig.head_pt(1.12, 0.66 * sx, 0.02), 55.0, "eye_power", "e*%g", size=0.05)
