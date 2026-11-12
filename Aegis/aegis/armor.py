"""Milestone 3: layered armor - individually modelled overlapping plates for torso, neck, tail and limbs,
plus fins, spurs, fasteners and the tail blade."""
import math
from math import cos, pi, radians, sin

from mathutils import Matrix, Vector

from . import rig
from .geo import Part, V, X, Y, Z, frame, get_coll, lerp, plate, se, shell_fn, table
from .head import horn
from .rig import TORSO, attach, torso_pt


def fin(p, base, d, L, w, m, thick=0.035):
    """Blade-like dorsal fin: thin laterally, swept along d with a curved tip."""
    base, d = Vector(base), Vector(d).normalized()
    pts, rad = [], []
    for k in range(8):
        t = k / 7
        pts.append(base + d * L * t + V(0, 1, 0) * (0.25 * L * t * t) * (1 if d.y >= 0 else -1))
        ww = w * (1 - t ** 1.5) + 0.004
        rad.append((ww, thick * (1 - 0.7 * t)))
    p.sweep(pts, rad, m["AEGIS_Titanium"], n=8, up=Y, exp=1.5)
    p.sweep([base - d * 0.02, base + d * 0.06], [(w * 1.15, thick * 1.7), (w * 1.05, thick * 1.5)], m["AEGIS_Gold"], n=8, up=Y, exp=2.5)


def plate_bolts(p, fn, center, r, mat, pts=((0.12, 0.1), (0.88, 0.1), (0.14, 0.8), (0.86, 0.8))):
    for s, t in pts:
        q = fn(s, t)
        n = (fn(min(s + 0.03, 1), t) - fn(max(s - 0.03, 0), t)).cross(fn(s, min(t + 0.03, 1)) - fn(s, max(t - 0.03, 0)))
        if n.length < 1e-9:
            continue
        n.normalize()
        if n.dot(q - center(q)) < 0:
            n = -n
        p.bolt(q + n * 0.012, n, r, mat)


def tube_field(r0, r1, L):
    def pt(y, a, off):
        r = lerp(r0, r1, max(0.0, min(1.0, y / L)))
        return Vector(((r * 1.04 + off) * se(sin(a), 2.5), y, (r * 1.1 + off) * se(cos(a), 2.5)))
    return pt


def chain_armor(ctx, prefix, n, radius_fn, name, fin_scale, vents):
    arm, m, c = ctx["arm"], ctx["mats"], ctx["c_armor"]
    T, TL, CF, CH = m["AEGIS_Titanium"], m["AEGIS_Titanium_Light"], m["AEGIS_Carbon"], m["AEGIS_Chrome"]
    for i in range(n):
        bone = "%s_%02d" % (prefix, i + 1)
        L = arm.data.bones[bone].length
        r0, r1 = radius_fn(i), radius_fn(min(i + 1, n - 1))
        pt = tube_field(r0, r1, L)
        tag = "AR_%s_%02d" % (name, i + 1)
        ctr = lambda q: Vector((0, q.y, 0))
        det = Part(tag + "_detail")
        fn = shell_fn(pt, -0.06 * L, 0.92 * L, radians(-50), radians(50), lift=0.07 * r0 / 0.4, base=0.035,
                      point=0.24 * L, pexp=1.7)
        attach(plate(tag + "_dorsal", fn, 9, 8, T, c, thick=0.03), arm, bone, local=True)
        plate_bolts(det, fn, ctr, 0.014 + r0 * 0.012, CH)
        for s, sn in ((1, "a"), (-1, "b")):
            fn = shell_fn(pt, 0.02 * L, 0.9 * L, s * radians(56), s * radians(122), lift=0.05 * r0 / 0.4, base=0.03,
                          point=0.16 * L)
            attach(plate("%s_side_%s" % (tag, sn), fn, 8, 7, TL if i % 2 else T, c, thick=0.028), arm, bone, local=True)
            plate_bolts(det, fn, ctr, 0.012 + r0 * 0.01, CH)
            fn = shell_fn(pt, 0.06 * L, 0.86 * L, s * radians(129), s * radians(166), lift=0.03, base=0.02, point=0.1 * L)
            attach(plate("%s_ventral_%s" % (tag, sn), fn, 5, 6, CF, c, thick=0.024), arm, bone, local=True)
            if vents:   # ventilation louvres with a glow behind them
                for k in range(3):
                    y = L * (0.3 + 0.17 * k)
                    o = 0.034 + 0.05 * ((y / L) ** 2) * r0 / 0.4 + 0.012
                    det.sweep([pt(y, s * radians(a), o) for a in (72, 81, 90, 99, 108)], (0.012, 0.03), m["AEGIS_Energy_Vent"], n=6, up=Y)
                    det.sweep([pt(y + 0.035, s * radians(a), o + 0.012) for a in (70, 80, 90, 100, 110)], (0.008, 0.028), TL, n=6, up=Y, exp=3.0)
        fl = fin_scale(i)
        if fl > 0.04:
            fin(det, (0, L * 0.42, r0 * 1.1 + 0.05), V(0, 0.55, 1), fl, fl * 0.34, m, thick=0.02 + fl * 0.03)
        attach(det.finish(c, bevel=0.003), arm, bone, local=True)


def limb_field(a, b, r, sx, bulge=0.28, fr_scale=1.2):
    d = (b - a).normalized()
    fm = frame(d, V(0, -1, 0))
    front = fm @ Z
    out = X * sx
    L = (b - a).length

    def pt(t, phi, off):
        rr = r * (1.0 + bulge * sin(pi * max(0.0, min(1.0, t)))) + off
        return a + d * L * t + out * cos(phi) * rr + front * sin(phi) * rr * fr_scale
    return pt


def dome_fn(c, sx, R, th0, th1, ps0, ps1, squash=1.0):
    def fn(s, t):
        th = radians(lerp(th0, th1, t))
        ps = radians(lerp(ps0, ps1, s))
        return c + X * sx * R * cos(th) * squash + (Z * cos(ps) + Y * -sin(ps)) * R * sin(th)
    return fn


def torso_armor(ctx):
    arm, m, c = ctx["arm"], ctx["mats"], ctx["c_armor"]
    T, TL, CF, CH, AU = m["AEGIS_Titanium"], m["AEGIS_Titanium_Light"], m["AEGIS_Carbon"], m["AEGIS_Chrome"], m["AEGIS_Gold"]
    det = Part("AR_torso_fasteners_fins")
    ctr = lambda q: Vector((0, q.y, table(TORSO, q.y)[0]))
    n = [0]

    def P(name, y0, y1, a0, a1, mat=T, lift=0.09, point=0.28, base=0.035, ns=9, nt=9, thick=0.035, notch=0.0, bolts=True):
        fn = shell_fn(torso_pt, y0, y1, a0, a1, lift=lift, base=base, point=point, notch=notch, pexp=1.8)
        attach(plate("AR_torso_" + name, fn, ns, nt, mat, c, thick=thick), arm, "body")
        if bolts:
            plate_bolts(det, fn, ctr, 0.024, CH)
        n[0] += 1

    # dorsal row with fins
    for i in range(7):
        y0 = -2.72 + i * 0.8
        P("dorsal_%d" % (i + 1), y0, y0 + 0.92, radians(-36), radians(36), lift=0.11, point=0.3, notch=0.1)
        top = torso_pt(y0 + 0.55, 0, 0.06)
        fin(det, top, V(0, 0.6, 1), lerp(0.75, 0.5, abs(i - 2) / 4), 0.24, m, thick=0.04)
    for s, sn in ((1, "L"), (-1, "R")):
        # upper flank
        for i in range(7):
            y0 = -2.55 + i * 0.78
            P("flank_upper_%d.%s" % (i + 1, sn), y0, y0 + 0.9, s * radians(40), s * radians(84),
              mat=TL if i in (1, 4) else T, lift=0.1, point=0.24)
        # lower flank: narrow over the reactor bay, open truss at the waist
        P("flank_bay_1.%s" % sn, -2.5, -1.9, s * radians(87), s * radians(101), lift=0.05, point=0.1, ns=5, nt=6)
        P("flank_bay_2.%s" % sn, -1.95, -1.3, s * radians(87), s * radians(103), lift=0.05, point=0.1, ns=5, nt=6)
        for i in range(3):
            y0 = -1.32 + i * 0.68
            P("flank_lower_%d.%s" % (i + 1, sn), y0, y0 + 0.8, s * radians(87), s * radians(134), lift=0.09, point=0.2)
        for i in range(2):
            y0 = 1.5 + i * 0.68
            P("flank_hip_%d.%s" % (i + 1, sn), y0, y0 + 0.8, s * radians(87), s * radians(138), lift=0.09, point=0.2,
              mat=TL if i == 0 else T)
        # collar plates around the neck root (pointing forward)
        P("collar_upper.%s" % sn, -2.3, -3.02, s * radians(12), s * radians(70), lift=0.14, point=-0.16, base=0.05)
        P("collar_lower.%s" % sn, -2.35, -3.0, s * radians(74), s * radians(128), lift=0.12, point=-0.14, base=0.05, mat=TL)
        # energy seam between upper and lower flank rows
        det.sweep([torso_pt(y, s * radians(85.5), 0.02) for y in [-2.4 + k * 0.3 for k in range(18)]], 0.022,
                  m["AEGIS_Energy_Conduit"], 8)
    # belly (carbon), behind the reactor bay and under the pelvis
    for i in range(3):
        y0 = -1.3 + i * 0.68
        P("belly_%d" % (i + 1), y0, y0 + 0.8, radians(139), radians(221), mat=CF, lift=0.06, point=0.15, thick=0.03)
    for i in range(2):
        y0 = 1.5 + i * 0.68
        P("belly_hip_%d" % (i + 1), y0, y0 + 0.8, radians(142), radians(218), mat=CF, lift=0.06, point=0.15, thick=0.03)
    attach(det.finish(c, bevel=0.004), arm, "body")


def limb_armor(ctx):
    arm, m, c = ctx["arm"], ctx["mats"], ctx["c_armor"]
    T, TL, CF, CH, AU = m["AEGIS_Titanium"], m["AEGIS_Titanium_Light"], m["AEGIS_Carbon"], m["AEGIS_Chrome"], m["AEGIS_Gold"]
    for sx, s in ((1, "L"), (-1, "R")):
        f, r_ = rig.front_leg(sx), rig.rear_leg(sx)
        segs = [("arm_upper", f["S"], f["E"], 0.36, T, 0.16), ("arm_lower", f["E"], f["W"], 0.29, TL, 0.12),
                ("thigh", r_["H"], r_["K"], 0.44, T, 0.2), ("shin", r_["K"], r_["Hk"], 0.31, TL, 0.12),
                ("meta", r_["Hk"], r_["A"], 0.22, T, 0.1)]
        for bone, a, b, r, mat, bulge in segs:
            det = Part("AR_%s_detail.%s" % (bone, s))
            pt = limb_field(a, b, r, sx, bulge)
            ctr = lambda q, a=a, b=b: a.lerp(b, max(0, min(1, (q - a).dot(b - a) / (b - a).length_squared)))
            fn = shell_fn(pt, 0.16, 0.86, radians(-74), radians(74), lift=0.05, base=0.06, point=0.1, notch=0.06, pexp=1.8)
            attach(plate("AR_%s_outer.%s" % (bone, s), fn, 11, 10, mat, c, thick=0.04), arm, "%s.%s" % (bone, s))
            plate_bolts(det, fn, ctr, 0.022, CH)
            # second, raised layer: a ridged cap plate over the upper half
            fn3 = shell_fn(pt, 0.1, 0.5, radians(-52), radians(52), lift=0.07, base=0.105, point=0.16, pexp=1.3)
            attach(plate("AR_%s_cap.%s" % (bone, s), fn3, 9, 7, TL if mat is T else T, c, thick=0.035), arm, "%s.%s" % (bone, s))
            plate_bolts(det, fn3, ctr, 0.018, AU, pts=((0.2, 0.15), (0.8, 0.15)))
            # inner guard (thin carbon) on the body side
            fn2 = shell_fn(pt, 0.24, 0.8, radians(118), radians(242), lift=0.02, base=0.03, point=0.06)
            attach(plate("AR_%s_inner.%s" % (bone, s), fn2, 8, 7, CF, c, thick=0.025), arm, "%s.%s" % (bone, s))
            # energy strip down the outer plate
            det.sweep([pt(t, 0.0, 0.085 + 0.05 * ((t - 0.16) / 0.7) ** 2) for t in (0.6, 0.66, 0.72, 0.78)], (0.028, 0.014),
                      m["AEGIS_Energy_Conduit"], n=8, up=X)
            if bone in ("arm_lower", "shin"):       # elbow / hock spurs
                d = (a - b).normalized()
                horn(det, a + V(0, 0.16, 0.05), lambda t, d=d: (d * 0.25 + V(0, 0.85, 0.3)) * (0.75 * t), 0.085, m, 4)
            attach(det.finish(c, bevel=0.004), arm, "%s.%s" % (bone, s))
        # shoulder + hip pauldrons (a hole at the pole shows the bearing cap)
        for bone, cpt, R in (("arm_upper", f["S"], 0.52), ("thigh", r_["H"], 0.6)):
            attach(plate("AR_pauldron_%s.%s" % (bone, s), dome_fn(cpt + X * sx * 0.03, sx, R, 24, 88, -125, 125, 0.62), 15, 7,
                         T, c, thick=0.045), arm, "%s.%s" % (bone, s))
            attach(plate("AR_pauldron_rim_%s.%s" % (bone, s), dome_fn(cpt + X * sx * 0.035, sx, R + 0.035, 84, 97, -128, 128, 0.62),
                         15, 3, AU, c, thick=0.03), arm, "%s.%s" % (bone, s))
        # knee guard
        k = r_["K"]
        attach(plate("AR_knee_guard." + s, lambda u, t, k=k: k + V((u - 0.5) * 0.62, -0.42 * cos((u - 0.5) * 2.2) * cos((t - 0.5) * 2.0),
                                                                    (t - 0.5) * 0.9 + 0.05), 7, 7, TL, c, thick=0.04), arm, "shin." + s)
        # foot + toe plates
        for bone, a, b, pre in (("hand", f["W"], f["P"], "f"), ("foot", r_["A"], r_["P"], "r")):
            d = (b - a)

            def fn(u, t, a=a, d=d):
                x = (u - 0.5) * 2
                wdt = lerp(0.24, 0.47, t)
                return a + d * lerp(0.12, 1.02, t) + X * x * wdt + Z * (0.14 + 0.06 * (1 - x * x) - 0.02 * abs(x) ** 3 * 4)
            attach(plate("AR_%s_top.%s" % (bone, s), fn, 9, 7, T, c, thick=0.035), arm, "%s.%s" % (bone, s))
            for stem, ta, tm, tt in rig.toe_specs(b, sx):
                dd = (tm - ta)
                lat = dd.normalized().cross(Z)

                def fn(u, t, ta=ta, dd=dd, lat=lat):
                    x = (u - 0.5) * 2
                    return ta + dd * lerp(0.2, 0.9, t) + lat * x * lerp(0.105, 0.075, t) + Z * (0.075 + 0.045 * (1 - x * x))
                attach(plate("AR_%s%s_plate.%s" % (pre, stem, s), fn, 5, 5, TL, c, thick=0.022), arm,
                       "%s%s_a.%s" % (pre, stem, s))


def tail_blade(ctx):
    arm, m, c = ctx["arm"], ctx["mats"], ctx["c_armor"]
    bone = "tail_%02d" % rig.N_TAIL
    L = arm.data.bones[bone].length
    p = Part("AR_tail_blade")
    p.lathe((0, L * 0.7, 0), Y, [(0, 0.06), (0, 0.16), (0.14, 0.18), (0.2, 0.1), (0.2, 0)], m["AEGIS_Gold"], 16)
    for a, Lb, w in ((0, 1.25, 0.2), (radians(42), 0.8, 0.14), (radians(-42), 0.8, 0.14)):
        d = V(sin(a), cos(a), 0)
        pts, rad = [], []
        for k in range(9):
            t = k / 8
            pts.append(V(0, L * 0.85, 0) + d * Lb * t)
            ww = w * (sin(pi * min(1, t * 1.6 + 0.12)) ** 0.7 if t < 0.55 else (1 - t) / 0.45 * 0.98 + 0.02)
            rad.append((0.035 * (1 - 0.8 * t), ww))
        up = Z
        p.sweep(pts, rad, m["AEGIS_Tooth"], n=8, up=up, exp=1.4)
    attach(p.finish(c, bevel=0.003), arm, bone, local=True)


def build(ctx):
    ctx["c_armor"] = get_coll("AEGIS_Armor", ctx["root"])
    torso_armor(ctx)
    chain_armor(ctx, "neck", rig.N_NECK, rig.neck_radius, "neck", lambda i: 0.42 - 0.03 * i, True)
    chain_armor(ctx, "tail", rig.N_TAIL, rig.tail_radius, "tail", lambda i: 0.5 - 0.034 * i, False)
    limb_armor(ctx)
    tail_blade(ctx)
