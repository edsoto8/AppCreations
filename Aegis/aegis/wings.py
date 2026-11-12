"""Wings: truss booms, folding-fan wrist hub, articulated finger spars, hydraulics,
energy membranes (armature-deformed) and retractable armor panels."""
import math
from math import cos, pi, radians, sin

import bpy
from mathutils import Matrix, Vector

from . import rig
from .geo import Part, V, X, Y, Z, add_bevel, catmull, frame, get_coll, lerp, plate
from .rig import (N_FING, W_ELBOW, W_STRUT, W_THUMB, W_WRIST, attach, finger_k, finger_pts, piston, wing_axes, wing_pt)


def boom(p, a, b, N, r, off, m, webs=9):
    """Truss boom: two chords stacked along the wing normal, a carbon spar and a zig-zag web."""
    TL, CH, CF, AU = m["AEGIS_Titanium_Light"], m["AEGIS_Chrome"], m["AEGIS_Carbon"], m["AEGIS_Gold"]
    d = (b - a).normalized()
    a2, b2 = a + d * 0.22, b - d * 0.2
    for s in (-1, 1):
        p.cyl(a2 + N * off * s, b2 + N * off * s, r, TL, 12)
    p.sweep([a2, b2], [(off * 0.75, r * 2.3), (off * 0.6, r * 2.0)], CF, n=10, up=N, exp=3.0)
    for i in range(webs):
        q0, q1 = a2.lerp(b2, i / webs), a2.lerp(b2, (i + 1) / webs)
        s = 1 if i % 2 == 0 else -1
        lat = d.cross(N).normalized()
        for side in (-1, 1):
            p.cyl(q0 + N * off * s + lat * side * r * 2.2, q1 - N * off * s + lat * side * r * 2.2, r * 0.3, CH, 6)
    for t in (0.0, 0.5, 1.0):
        q = a2.lerp(b2, t)
        p.lathe(q - d * 0.04, d, [(0, off + r * 0.6), (0, off + r * 1.6), (0.08, off + r * 1.6), (0.08, off + r * 0.6)], AU, 16)


def spar(p, a, b, N, r0, r1, m, rod=True):
    """Flattened finger spar with a stand-off tension rod and membrane emitter nodes."""
    TL, CH = m["AEGIS_Titanium_Light"], m["AEGIS_Chrome"]
    d = (b - a).normalized()
    lat = N.cross(d).normalized()
    p.sweep([a.lerp(b, t) for t in (0.0, 0.33, 0.66, 1.0)],
            [(lerp(r0, r1, t) * 0.55, lerp(r0, r1, t)) for t in (0.0, 0.33, 0.66, 1.0)], TL, n=10, up=N, exp=2.6)
    L = (b - a).length
    if rod:
        h = r0 * 1.9
        p.cyl(a + d * L * 0.06 + N * h, b - d * L * 0.06 + N * h * 0.7, r0 * 0.16, CH, 6)
        for t in (0.06, 0.35, 0.65, 0.94):
            q = a.lerp(b, t)
            p.cyl(q, q + N * h * lerp(1, 0.7, t), r0 * 0.2, CH, 6)
    n = max(2, int(L / 0.55))
    for i in range(n):
        q = a.lerp(b, (i + 0.5) / n)
        rr = lerp(r0, r1, (i + 0.5) / n)
        p.lathe(q - N * rr * 0.75, -N, [(0, rr * 0.5), (rr * 0.35, rr * 0.42), (rr * 0.5, 0)], m["AEGIS_Energy_Conduit"], 10)


def hook(p, a, d, N, L, r, m, curl):
    """Hooked wing claw from a along d, curling toward `curl`."""
    pts, rad = [], []
    for k in range(9):
        t = k / 8
        pts.append(a + d * L * t + curl * (L * 0.45 * t * t))
        w = lerp(r, 0.004, t ** 0.8)
        rad.append((w * 0.7, w * 1.2))
    p.sweep(pts, rad, m["AEGIS_Tooth"], n=10, up=N, exp=1.7)
    p.lathe(pts[0], d, [(0, r * 0.8), (0, r * 1.5), (0.05, r * 1.4), (0.05, r * 0.8)], m["AEGIS_Gold"], 12)


def build_structure(ctx):
    arm, m = ctx["arm"], ctx["mats"]
    G, CH, AU, TL, T = (m[k] for k in ("AEGIS_Gunmetal", "AEGIS_Chrome", "AEGIS_Gold", "AEGIS_Titanium_Light", "AEGIS_Titanium"))
    hy, hp = ctx["c_hy"], ctx["c_help"]
    for sx, s in ((1, "L"), (-1, "R")):
        c = get_coll("AEGIS_Wing_" + s, ctx["root"])
        U, Vv, N = wing_axes(sx)
        w = lambda uv, k=0.0: wing_pt(sx, uv[0], uv[1], k)
        root, elbow, wrist = w((0, 0)), w(W_ELBOW), w(W_WRIST)
        pivot = w((-0.45, 0))

        # chest mount: flap trunnion (axis = body axis) bolted to the dorsal frame
        p = Part("WG_mount." + s)
        p.joint(pivot, Vv, 0.3, 0.7, G, AU, TL, nb=8)
        for dy in (-0.42, 0.42):
            p.beam(pivot + Vv * dy, V(sx * 0.12, pivot.y + dy, 3.55), 0.14, 0.24, TL, up=Y)
            p.box(pivot + Vv * dy, (0.3, 0.07, 0.5), TL, rot=frame(Vv, N))
        p.box(V(sx * 1.02, -1.3, 3.22), (0.2, 0.24, 0.24), TL)
        attach(p.finish(c, bevel=0.006), arm, "chest")

        # shoulder block (wing_base): flap arm + sweep bearing
        p = Part("WG_shoulder." + s)
        p.sweep([pivot, root], [(0.16, 0.26), (0.14, 0.22)], G, n=12, up=N, exp=3.5)
        p.joint(root, N, 0.25, 0.42, CH, AU, TL, nb=8)
        p.box(w((-0.3, 0.42), 0.12), (0.14, 0.14, 0.14), TL, rot=frame(U, N))
        attach(p.finish(c, bevel=0.006), arm, "wing_base." + s)

        for bone, a, b, r, off in (("wing_arm", root, elbow, 0.05, 0.1), ("wing_fore", elbow, wrist, 0.043, 0.085)):
            p = Part("WG_%s.%s" % (bone[5:] + "_boom", s))
            boom(p, a, b, N, r, off, m)
            if bone == "wing_fore":
                p.joint(a, N, 0.2, 0.36, CH, AU, TL, nb=6)
                # folding-fan wrist hub: stacked rotary actuators, one per finger
                p.cyl(b - N * 0.3, b + N * 0.3, 0.085, CH, 16)
                for s2 in (-1, 1):
                    p.lathe(b + N * 0.24 * s2, N * s2, [(0, 0.0), (0, 0.19), (0.05, 0.19), (0.07, 0.14), (0.1, 0.14), (0.1, 0)], AU, 20)
                for k in range(N_FING - 1):
                    kk = (finger_k(k) + finger_k(k + 1)) / 2
                    p.lathe(b + N * (kk - 0.012), N, [(0, 0.085), (0, 0.15), (0.024, 0.15), (0.024, 0.085)], G, 20)
                d = (b - a).normalized()
                p.sweep([b - d * 0.5, b - d * 0.16], [(0.1, 0.1), (0.3, 0.12)], G, n=10, up=N, exp=3.5)
            attach(p.finish(c, bevel=0.005), arm, "%s.%s" % (bone, s))

        # fingers
        for k in range(N_FING):
            a2, m2, t2 = finger_pts(k)
            kk = finger_k(k)
            a, mid, tip = w(a2, kk), w(m2, kk), w(t2, kk)
            d = (mid - a).normalized()
            p = Part("WG_finger%d_base.%s" % (k + 1, s))
            p.lathe(a - N * 0.032, N, [(0, 0.085), (0, 0.185), (0.064, 0.185), (0.064, 0.085)], TL, 22)
            p.sweep([a + d * 0.12, a + d * 0.42], [(0.03, 0.15), (0.035, 0.085)], TL, n=8, up=N, exp=3.0)
            spar(p, a + d * 0.4, mid, N, 0.115 - 0.008 * k, 0.085, m)
            attach(p.finish(c, bevel=0.004), arm, "wing_f%da.%s" % (k + 1, s))
            p = Part("WG_finger%d_tip.%s" % (k + 1, s))
            p.joint(mid, N, 0.085, 0.13, CH, AU)
            d2 = (tip - mid).normalized()
            spar(p, mid + d2 * 0.06, tip - d2 * 0.25, N, 0.082, 0.04, m)
            hook(p, tip - d2 * 0.27, d2, N, 0.55, 0.045, m, N.cross(d2) * sx)
            attach(p.finish(c, bevel=0.004), arm, "wing_f%db.%s" % (k + 1, s))
            # small knuckle actuator across the mid joint
            lat = N.cross(d) * sx
            piston("HY_wing_f%d.%s" % (k + 1, s), arm, "wing_f%da.%s" % (k + 1, s), a.lerp(mid, 0.72) + N * 0.06 - lat * 0.1,
                   "wing_f%db.%s" % (k + 1, s), mid.lerp(tip, 0.12) + N * 0.06 - lat * 0.08, 0.022, hy, hp, m, up=N)

        # inner strut + thumb claw
        sa, sb = w(W_ELBOW, -0.2), w(W_STRUT, -0.2)
        p = Part("WG_strut." + s)
        p.lathe(sa - N * 0.03, N, [(0, 0.1), (0, 0.24), (0.06, 0.24), (0.06, 0.1)], TL, 20)
        ds = (sb - sa).normalized()
        spar(p, sa + ds * 0.2, sb - ds * 0.3, N, 0.09, 0.04, m)
        hook(p, sb - ds * 0.32, ds, N, 0.45, 0.032, m, N.cross(ds) * sx)
        attach(p.finish(c, bevel=0.004), arm, "wing_strut." + s)
        ta, tb = w(W_WRIST, 0.2), w(W_THUMB, 0.2)
        p = Part("WG_thumb." + s)
        p.lathe(ta + N * 0.055, N, [(0, 0.085), (0, 0.16), (0.05, 0.16), (0.05, 0.085)], TL, 20)
        dt = (tb - ta).normalized()
        p.sweep([ta + dt * 0.1, ta + dt * 0.45], [(0.04, 0.1), (0.05, 0.07)], TL, n=8, up=N, exp=3.0)
        hook(p, ta + dt * 0.42, dt, N, 0.8, 0.07, m, -N.cross(dt) * sx)
        attach(p.finish(c, bevel=0.004), arm, "wing_thumb." + s)

        # hydraulics
        piston("HY_wing_flap." + s, arm, "chest", V(sx * 1.02, -1.3, 3.36), "wing_arm." + s, w((1.15, 0.0), -0.16),
               0.07, hy, hp, m, up=Y)
        piston("HY_wing_sweep." + s, arm, "wing_base." + s, w((-0.3, 0.42), 0.2), "wing_arm." + s,
               root.lerp(elbow, 0.5) + N * 0.2, 0.05, hy, hp, m, up=N, short=0.6)
        da, df = (elbow - root).normalized(), (wrist - elbow).normalized()
        piston("HY_wing_elbow." + s, arm, "wing_arm." + s, elbow - da * 1.3 + N.cross(da) * sx * 0.25 + N * 0.19,
               "wing_fore." + s, elbow + df * 0.4 + N.cross(df) * sx * 0.25 + N * 0.19, 0.045, hy, hp, m, up=N)


def build(ctx):
    """Milestone 3: membranes, retractable panels and boom armor."""
    arm, m = ctx["arm"], ctx["mats"]
    T, TL, AU = m["AEGIS_Titanium"], m["AEGIS_Titanium_Light"], m["AEGIS_Gold"]
    for sx, s in ((1, "L"), (-1, "R")):
        c = get_coll("AEGIS_Wing_" + s, ctx["root"])
        U, Vv, N = wing_axes(sx)
        w = lambda uv, k=0.0: wing_pt(sx, uv[0], uv[1], k)

        # edges: (polyline of (uv, k), bones per segment)
        edges = []
        for k in range(N_FING):
            a2, m2, t2 = finger_pts(k)
            kk = finger_k(k) - 0.02
            edges.append(([w(a2, kk), w(m2, kk), w(t2, kk)], ["wing_f%da.%s" % (k + 1, s), "wing_f%db.%s" % (k + 1, s)]))
        edges.append(([w(W_ELBOW, -0.2), w(W_STRUT, -0.2)], ["wing_strut." + s]))
        edges.append(([w((0.12, 0.45), -0.1), w((0.02, 3.3), -0.25)], ["chest"]))

        def edge_pt(e, t):
            pts, bones = e
            if len(pts) == 2:
                return pts[0].lerp(pts[1], t), bones[0]
            if t < 0.48:
                return pts[0].lerp(pts[1], t / 0.48), bones[0]
            return pts[1].lerp(pts[2], (t - 0.48) / 0.52), bones[1]

        verts, faces, weights = [], [], []
        ns, nt = 9, 15
        for ea, eb in zip(edges, edges[1:]):
            base = len(verts)
            for j in range(nt):
                for i in range(ns):
                    sfrac = i / (ns - 1)
                    t = lerp(0.07, 1.0, j / (nt - 1)) * (1 - 0.17 * sin(pi * sfrac) * (j / (nt - 1)) ** 2)
                    pa, ba = edge_pt(ea, t)
                    pb, bb = edge_pt(eb, t)
                    q = pa.lerp(pb, sfrac) - N * 0.22 * sin(pi * sfrac) * t
                    verts.append(q)
                    weights.append(((ba, 1 - sfrac), (bb, sfrac)))
            for j in range(nt - 1):
                for i in range(ns - 1):
                    v = base + j * ns + i
                    faces.append((v, v + 1, v + ns + 1, v + ns))
        me = bpy.data.meshes.new("WG_membrane." + s)
        me.from_pydata(verts, [], faces)
        me.materials.append(m["AEGIS_Energy_Membrane"])
        for poly in me.polygons:
            poly.use_smooth = True
        ob = bpy.data.objects.new("WG_membrane." + s, me)
        c.objects.link(ob)
        for i, ws in enumerate(weights):
            for bone, wt in ws:
                if wt > 0:
                    vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
                    vg.add([i], wt, 'ADD')
        ob.parent = arm
        mod = ob.modifiers.new("Armature", 'ARMATURE')
        mod.object = arm
        ob.visible_shadow = False
        ctx.setdefault("membranes", []).append(ob)

        # retractable armor panels: blades that slide along each finger base
        for k in range(N_FING):
            a2, m2, t2 = finger_pts(k)
            kk = finger_k(k) + 0.045
            a, mid = w(a2, kk), w(m2, kk)
            d = (mid - a).normalized()
            lat = N.cross(d).normalized() * sx
            L = (mid - a).length

            def fn(sf, t, a=a, d=d, lat=lat, L=L):
                x = (sf - 0.5) * 2
                half = 0.2 * (1 - 0.75 * t ** 2.2) * (0.55 + 0.45 * min(1.0, t * 6))
                return a + d * (L * (0.14 + 0.5 * t)) + lat * x * half + N * (0.035 * (1 - x * x) + 0.02)
            ob = plate("WG_panel%d.%s" % (k + 1, s), fn, 7, 12, T if k % 2 == 0 else TL, c, thick=0.025)
            attach(ob, arm, "wing_panel%d.%s" % (k + 1, s))
            p = Part("WG_panel%d_rail.%s" % (k + 1, s))
            for t in (0.2, 0.5):
                q = a + d * L * t
                p.bolt(q + N * 0.06, N, 0.022, m["AEGIS_Chrome"])
            p.beam(a + d * L * 0.16 + N * 0.03, a + d * L * 0.6 + N * 0.03, 0.05, 0.02, AU, up=N)
            attach(p.finish(c, bevel=0.003), arm, "wing_panel%d.%s" % (k + 1, s))

        # leading edge armor on the booms + shoulder pauldron
        for bone, a, b, hw in (("wing_arm", w((0, 0)), w(W_ELBOW), 0.26), ("wing_fore", w(W_ELBOW), w(W_WRIST), 0.22)):
            d = (b - a).normalized()
            lead = N.cross(d).normalized()
            if lead.dot(Vv) > 0:
                lead = -lead
            L = (b - a).length
            for part, (t0, t1) in enumerate(((0.1, 0.52), (0.48, 0.9))):
                def fn(sf, t, a=a, d=d, lead=lead, L=L, t0=t0, t1=t1, hw=hw, part=part):
                    ph = radians(lerp(-112, 112, sf))
                    c2 = 1 - abs(2 * sf - 1) ** 2
                    tt = lerp(t0, t1 + 0.06 * c2, t)
                    return a + d * L * tt + lead * (cos(ph) * hw * 0.9 + 0.02 * part) + N * (sin(ph) * (hw * 0.75 + 0.02 * part))
                ob = plate("WG_%s_armor%d.%s" % (bone[5:], part + 1, s), fn, 11, 8, T, c, thick=0.03)
                attach(ob, arm, "%s.%s" % (bone, s))
