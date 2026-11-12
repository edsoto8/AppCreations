"""The head: skull core, jaw, teeth, optics, horns, facial plates, vents and wiring.

Everything is modelled in head design units (bone space, +Y = snout, +Z = up) and scaled by rig.HS.
"""
import math
from math import cos, pi, radians, sin

from mathutils import Matrix, Vector

from . import rig
from .geo import Part, V, X, Y, Z, catmull, frame, get_coll, lerp, plate, se, shell_fn, table
from .rig import HS, attach, bone_m, piston, side_sign, to_world

# upper skull hull: (f, half width, top z, lip z)
HULL = [(-0.25, 0.36, 0.26, -0.10), (0.3, 0.50, 0.37, -0.16), (0.8, 0.47, 0.37, -0.16), (1.1, 0.38, 0.27, -0.15),
        (1.6, 0.29, 0.19, -0.13), (2.1, 0.21, 0.14, -0.12), (2.32, 0.13, 0.07, -0.10), (2.46, 0.035, -0.05, -0.10)]
# jaw hull in jaw space: (y, half width, depth)
JAW = [(-0.05, 0.47, 0.17), (0.5, 0.42, 0.24), (1.0, 0.33, 0.21), (1.5, 0.24, 0.16), (1.82, 0.12, 0.09)]


def head_surf(f, a, off=0.0, e=1.9):
    """Upper skull surface. a = angle from the crown; beyond 90 deg it becomes a vertical skirt."""
    w, zt, zl = table(HULL, f)
    s = 1 if a >= 0 else -1
    aa = abs(a)
    if aa > pi / 2:
        return Vector((s * (w + off), f, zl - (aa - pi / 2) / radians(30) * 0.3))
    return Vector((s * (w + off) * se(sin(aa), e), f, zl + (zt - zl + off) * se(cos(aa), e)))


def jaw_surf(y, a, off=0.0, e=2.2):
    """Lower jaw surface, a in [90, 270] degrees (180 = keel)."""
    w, dep = table(JAW, y)
    return Vector(((w + off) * se(sin(a), e), y, 0.02 + (dep + off) * se(cos(a), e)))


def tooth(p, base, d, L, r, mat, bend=Vector((0, 0, 0))):
    base, d = Vector(base), Vector(d).normalized()
    pts, rad = [], []
    for k in range(7):
        t = k / 6
        pts.append(base + d * L * t + bend * (t * t))
        rr = r * (1 - t ** 1.6) + 0.002
        rad.append((rr, rr * 0.72))
    p.sweep(pts, rad, mat, n=8, up=Y, exp=1.8)


def horn(p, base, fn, r0, m, nseg=6, tip_mat=None):
    """Telescoping segmented horn along curve fn(t)."""
    T, CH, AU = m["AEGIS_Titanium"], m["AEGIS_Chrome"], m["AEGIS_Gold"]
    base = Vector(base)
    for i in range(nseg):
        ta, tb = i / nseg, (i + 1) / nseg
        pts = [base + fn(lerp(ta, tb, k / 4)) for k in range(5)]
        ra = r0 * (1 - ta) ** 0.85 * (1.0 if i == 0 else 0.9)
        rb = r0 * (1 - tb) ** 0.85 + (0.004 if i == nseg - 1 else 0)
        rads = [lerp(ra, rb, k / 4) for k in range(5)]
        mat = (tip_mat or m["AEGIS_Tooth"]) if i == nseg - 1 else T
        p.sweep(pts, [(r, r * 0.8) for r in rads], mat, n=10, exp=1.7)
        d = pts[1] - pts[0]
        p.lathe(pts[0] - d.normalized() * 0.012, d, [(0, ra * 0.7), (0, ra * 1.12), (0.03, ra * 1.12), (0.03, ra * 0.7)],
                AU if i == 0 else CH, 12)


def build_core(ctx):
    arm, m = ctx["arm"], ctx["mats"]
    G, CH, AU, TL, CF, CU, RB = (m[k] for k in ("AEGIS_Gunmetal", "AEGIS_Chrome", "AEGIS_Gold", "AEGIS_Titanium_Light",
                                               "AEGIS_Carbon", "AEGIS_Copper", "AEGIS_Rubber"))
    c = ctx["c_head"] = get_coll("AEGIS_Head", ctx["root"])
    S = Matrix.Scale(HS, 4)
    hm = bone_m(arm, "head")
    p = Part("HD_skull_core").at(S)
    rows = []
    for i in range(22):
        f = lerp(-0.15, 2.4, i / 21)
        w, zt, zl = table(HULL, f)
        zc, hh = (zt + zl) / 2 + 0.01, max((zt - zl) / 2 - 0.035, 0.015)
        rows.append([Vector((max(w - 0.06, 0.02) * se(sin(2 * pi * k / 20), 2.6), f, zc + hh * se(cos(2 * pi * k / 20), 2.6)))
                     for k in range(20)])
    p.grid(rows, G, closed=True, cap=True)
    # neck socket + occipital joint
    p.ball((0, 0, 0), 0.2, CH, 18, Y)
    p.lathe((0, -0.2, 0), Y, [(0, 0.14), (0, 0.3), (0.1, 0.32), (0.12, 0.2)], TL, 20)
    for s in (-1, 1):
        # jaw hinge
        p.joint((s * 0.5, 0.3, -0.2), X, 0.12, 0.13, CH, AU, TL, nb=5)
        p.beam((s * 0.42, 0.3, -0.02), (s * 0.5, 0.3, -0.2), 0.1, 0.16, G, up=Y)
        p.box((s * 0.48, -0.05, 0.12), (0.1, 0.14, 0.12), TL)            # jaw piston lug
        # side wiring looms and the energy seam under the snout plates
        for j, (dz, mat, r) in enumerate(((0.0, CU, 0.012), (0.03, RB, 0.018), (-0.03, RB, 0.014), (0.055, CU, 0.009))):
            pts = [head_surf(f, s * radians(64), -0.045) + V(0, 0, dz + 0.01 * sin(f * 9 + j)) for f in
                   (0.0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.05)]
            p.sweep(catmull(pts, 3), r, mat, 6)
        p.sweep(catmull([head_surf(f, s * radians(57), -0.03) for f in (1.0, 1.3, 1.6, 1.9, 2.15)], 4), 0.02,
                m["AEGIS_Energy_Conduit"], 8)
        for j in range(3):   # cable bundle skull -> jaw joint
            pts = [(s * (0.28 + 0.03 * j), -0.1, 0.12 - 0.04 * j), (s * (0.4 + 0.02 * j), 0.02, 0.0 - 0.03 * j),
                   (s * 0.46, 0.2 + 0.03 * j, -0.14)]
            p.sweep(catmull(pts, 5), 0.016, RB if j != 1 else CU, 6)
    # throat emitter
    p.lathe((0, 0.34, -0.2), Y, [(0, 0.0), (0, 0.2), (0.1, 0.2), (0.1, 0.165), (0.03, 0.165)], G, 20)
    p.lathe((0, 0.37, -0.2), Y, [(0, 0.0), (0, 0.165)], m["AEGIS_Energy_Throat"], 20)
    for rr in (0.06, 0.115):
        p.ring((0, 0.44, -0.2), Y, rr, 0.008, CH, 20, 6)
    for a in range(4):
        d = V(cos(a * pi / 4), 0, sin(a * pi / 4)) * 0.165
        p.cyl(V(0, 0.44, -0.2) - d, V(0, 0.44, -0.2) + d, 0.006, CH, 6)
    # palate ridges
    for i in range(7):
        f = 0.75 + i * 0.2
        w, zt, zl = table(HULL, f)
        p.beam((-(w - 0.09), f, zl + 0.03), (w - 0.09, f, zl + 0.03), 0.05, 0.03, CF, up=Z)
    attach(p.finish(c, bevel=0.004), arm, "head", basis=hm)

    # mandible structure (jaw space)
    jm = bone_m(arm, "jaw")
    p = Part("HD_jaw_core").at(S)
    for s in (-1, 1):
        pts = [Vector((s * (table(JAW, y)[0] - 0.045), y, 0.0)) for y in [k * 0.13 for k in range(15)]]
        p.sweep(pts, (0.07, 0.045), G, n=8, exp=3.0)
        p.sweep([V(s * 0.47, 0.0, 0.0), V(s * 0.5, -0.0, 0.0)], 0.1, CH, 12)   # hinge boss
        p.box((s * 0.46, 0.5, -0.04), (0.08, 0.12, 0.1), TL)                  # piston lug
        p.sweep(catmull([jaw_surf(y, radians(180 - s * 84), -0.012) for y in (0.3, 0.7, 1.1, 1.5, 1.7)], 4), 0.017,
                m["AEGIS_Energy_Conduit"], 8)
    rows = []
    for i in range(14):
        y = lerp(0.05, 1.8, i / 13)
        rows.append([jaw_surf(y, radians(lerp(96, 264, k / 12)), -0.04) for k in range(13)])
    p.grid(rows, CF)
    p.sweep([V(-0.1, 1.8, 0.0), V(0.1, 1.8, 0.0)], 0.05, G, 8)
    for i in range(6):
        y = 0.35 + i * 0.25
        w = table(JAW, y)[0] - 0.08
        p.beam((-w, y, -0.03), (w, y, -0.03), 0.045, 0.03, TL, up=Z)
    attach(p.finish(c, bevel=0.004), arm, "jaw", basis=jm)
    # jaw hydraulics
    sj = side_sign(arm, "jaw")
    for sx, s in ((1, "L"), (-1, "R")):
        piston("HY_jaw." + s, arm, "head", rig.head_pt(-0.05, 0.5 * sx, 0.12), "jaw",
               to_world(arm, "jaw", Vector((sx * sj * 0.5, 0.5, -0.04)) * HS), 0.036 * HS, ctx["c_hy"], ctx["c_help"], m,
               up=X, short=0.85)


def build(ctx):
    arm, m = ctx["arm"], ctx["mats"]
    T, TL, G, CH, AU, BZ, CF, TO = (m[k] for k in ("AEGIS_Titanium", "AEGIS_Titanium_Light", "AEGIS_Gunmetal",
                                                   "AEGIS_Chrome", "AEGIS_Gold", "AEGIS_Bronze", "AEGIS_Carbon", "AEGIS_Tooth"))
    c = ctx["c_head"]
    S = Matrix.Scale(HS, 4)
    hm = bone_m(arm, "head")
    jm = bone_m(arm, "jaw")
    sh = side_sign(arm, "head")

    def hplate(name, fn, ns, nt, mat, bone="head", thick=0.03, basis=hm):
        ob = plate(name, lambda s, t: S @ fn(s, t), ns, nt, mat, c, thick=thick * HS)
        return attach(ob, arm, bone, basis=basis)

    # --- upper armor ---------------------------------------------------------------------
    hplate("HD_plate_cranium", shell_fn(lambda y, a, o: head_surf(y, a, o), 0.93, -0.22, radians(-60), radians(60),
                                        lift=0.13, base=0.03, point=-0.5, pexp=1.6), 15, 12, T)
    hplate("HD_plate_snout_top", shell_fn(lambda y, a, o: head_surf(y, a, o), 0.86, 2.44, radians(-52), radians(52),
                                          base=0.025, point=0.03, notch=-0.12), 13, 18, T)
    for sx in (1, -1):
        s = "L" if sx * sh > 0 else "R"
        hplate("HD_plate_snout_side." + s, shell_fn(lambda y, a, o: head_surf(y, a, o), 1.12, 2.26, sx * radians(60),
                                                    sx * radians(97), base=0.02, lift=0.0), 7, 14, TL)
        hplate("HD_plate_brow." + s, shell_fn(lambda y, a, o: head_surf(y, a, o), 0.52, 1.36, sx * radians(20),
                                              sx * radians(57), base=0.075, lift=0.06, point=0.1), 8, 9, T,
               bone="brow." + s, thick=0.04)
        hplate("HD_plate_cheek." + s, shell_fn(lambda y, a, o: head_surf(y, a, o), 0.84, -0.12, sx * radians(64),
                                               sx * radians(124), base=0.04, lift=0.16, point=-0.34), 9, 11, T,
               bone="cheek." + s, thick=0.035)

    # --- details on the skull --------------------------------------------------------------
    p = Part("HD_optics_horns").at(S)
    for sx in (1, -1):
        # recessed optic
        c0 = head_surf(1.0, sx * radians(77), 0.02)
        d = V(sx * 0.82, 0.55, 0.12).normalized()
        p.lathe(c0 - d * 0.1, d, [(0, 0.0), (0, 0.105), (0.1, 0.105), (0.115, 0.125), (0.12, 0.15), (0.1, 0.158),
                                  (0.07, 0.15)], G, 24)
        p.lathe(c0 - d * 0.07, d, [(0, 0.0), (0, 0.09), (0.004, 0.09)], m["AEGIS_Energy_Eye"], 24)
        p.ring(c0 - d * 0.045, d, 0.092, 0.011, CH, 24, 6)
        p.ring(c0 + d * 0.016, d, 0.138, 0.017, AU, 24, 6)
        p.lathe(c0 - d * 0.068, d, [(0, 0.0), (0, 0.016), (0.012, 0.03), (0.012, 0.0)], G, 12)       # aperture
        for k in range(6):     # iris blades
            a = k * pi / 3
            rv = frame(d) @ V(cos(a), 0, sin(a))
            p.beam(c0 - d * 0.05 + rv * 0.045, c0 - d * 0.05 + rv * 0.1, 0.012, 0.006, CH, up=d)
        # main horns
        horn(p, (sx * 0.27, 0.14, 0.31), lambda t, sx=sx: V(sx * (0.3 * t + 0.42 * t * t), -1.85 * t + 0.45 * t ** 3,
                                                           0.95 * sin(t * pi * 0.62)), 0.135, m, 7)
        horn(p, (sx * 0.45, 0.16, 0.12), lambda t, sx=sx: V(sx * (0.5 * t + 0.1 * t * t), -1.05 * t,
                                                           -0.12 * t + 0.28 * t * t), 0.085, m, 5)
        horn(p, (sx * 0.2, 0.55, 0.36), lambda t, sx=sx: V(sx * 0.08 * t, -0.42 * t, 0.36 * t), 0.045, m, 3)
        # nostril vents
        for k in range(3):
            cn = head_surf(2.0 + 0.07 * k, sx * radians(38), 0.03)
            p.beam(cn - V(sx * 0.05, 0, -0.03), cn + V(sx * 0.05, 0, -0.03), 0.028, 0.012, m["AEGIS_Energy_Vent"], up=Z)
    horn(p, (0, 2.04, 0.15), lambda t: V(0, -0.2 * t, 0.36 * t), 0.055, m, 3)
    for k, (f, L) in enumerate(((0.72, 0.3), (0.42, 0.42), (0.12, 0.5))):
        w, zt, zl = table(HULL, f)
        horn(p, (0, f, zt + 0.02), lambda t, L=L: V(0, -0.75 * L * t, L * t), 0.05, m, 3)
    attach(p.finish(c, bevel=0.004), arm, "head", basis=hm)

    # cheek vent pods + spikes ride on the moving cheek plates
    for sx in (1, -1):
        s = "L" if sx * sh > 0 else "R"
        p = Part("HD_cheek_vents." + s).at(S)
        for k in range(4):
            f = 0.56 - k * 0.13
            a0, a1 = head_surf(f, sx * radians(72), 0.075 + 0.03 * k), head_surf(f - 0.04, sx * radians(100), 0.075 + 0.03 * k)
            p.beam(a0, a1, 0.05, 0.016, TL, up=Y)
            b0, b1 = head_surf(f - 0.05, sx * radians(74), 0.06 + 0.03 * k), head_surf(f - 0.08, sx * radians(98), 0.06 + 0.03 * k)
            p.beam(b0, b1, 0.035, 0.01, m["AEGIS_Energy_Vent"], up=Y)
        for k, (f, L) in enumerate(((-0.02, 0.5), (0.02, 0.36))):
            b = head_surf(f, sx * radians(80 + 26 * k), 0.17)
            horn(p, b, lambda t, L=L, sx=sx, k=k: V(sx * 0.35 * L * t, -L * t, (0.1 - 0.3 * k) * L * t), 0.05, m, 3)
        attach(p.finish(c, bevel=0.003), arm, "cheek." + s, basis=hm)

    # --- teeth -----------------------------------------------------------------------------
    p = Part("HD_teeth_upper").at(S)
    ups = [(1.12, 0.1), (1.24, 0.13), (1.36, 0.11), (1.48, 0.15), (1.61, 0.12), (1.74, 0.24), (1.88, 0.13), (1.99, 0.15),
           (2.12, 0.3), (2.22, 0.14)]
    for sx in (1, -1):
        for f, L in ups:
            w, zt, zl = table(HULL, f)
            b = V(sx * (w - 0.04), f, zl + 0.02)
            tooth(p, b, V(sx * 0.1, 0.12, -1), L, 0.034 + L * 0.1, TO, bend=V(0, -0.05, 0))
            p.lathe(b + V(0, 0, 0.0), V(0, 0, -1), [(0, 0.052 + L * 0.08), (0.03, 0.045 + L * 0.08)], AU, 10)
        p.sweep([V(sx * (table(HULL, f)[0] - 0.04), f, table(HULL, f)[2] + 0.03) for f in [1.05 + 0.1 * k for k in range(13)]],
                (0.035, 0.05), G, n=8, exp=3.0)
    for x in (-0.06, 0.06):
        tooth(p, V(x, 2.3, -0.08), V(0, 0.25, -1), 0.13, 0.035, TO)
    attach(p.finish(c, bevel=0.002), arm, "head", basis=hm)

    p = Part("HD_teeth_lower").at(S)
    lows = [(0.82, 0.09), (0.94, 0.11), (1.06, 0.1), (1.18, 0.13), (1.3, 0.2), (1.43, 0.11), (1.55, 0.13), (1.66, 0.25),
            (1.76, 0.12)]
    for sx in (1, -1):
        for y, L in lows:
            w, dep = table(JAW, y)
            b = V(sx * (w - 0.075), y, 0.03)
            tooth(p, b, V(-sx * 0.02, 0.1, 1), L, 0.03 + L * 0.1, TO, bend=V(0, -0.04, 0))
            p.lathe(b - V(0, 0, 0.01), Z, [(0, 0.048 + L * 0.08), (0.03, 0.04 + L * 0.08)], AU, 10)
    attach(p.finish(c, bevel=0.002), arm, "jaw", basis=jm)

    # --- jaw armor ---------------------------------------------------------------------------
    def jplate(name, fn, ns, nt, mat, thick=0.03):
        ob = plate(name, lambda s, t: S @ fn(s, t), ns, nt, mat, c, thick=thick * HS)
        return attach(ob, arm, "jaw", basis=jm)

    jplate("HD_plate_chin", shell_fn(lambda y, a, o: jaw_surf(y, a, o), 0.98, 1.84, radians(104), radians(256),
                                     base=0.02, point=0.07, notch=-0.1), 13, 10, T)
    jplate("HD_plate_jaw_keel", shell_fn(lambda y, a, o: jaw_surf(y, a, o), 0.12, 1.0, radians(150), radians(210),
                                         base=0.012, point=0.1), 7, 9, CF)
    sj = side_sign(arm, "jaw")
    for sx in (1, -1):
        s = "L" if sx * sj > 0 else "R"
        a0, a1 = (radians(96), radians(148)) if sx > 0 else (radians(264), radians(212))
        jplate("HD_plate_jaw_side." + s, shell_fn(lambda y, a, o: jaw_surf(y, a, o), 1.04, 0.02, a0, a1, base=0.03,
                                                  lift=0.07, point=-0.22), 7, 10, TL)
    p = Part("HD_jaw_spikes").at(S)
    horn(p, (0, 1.72, -0.12), lambda t: V(0, 0.12 * t, -0.3 * t), 0.05, m, 3)
    for sx in (1, -1):
        horn(p, (sx * 0.47, 0.12, -0.14), lambda t, sx=sx: V(sx * 0.12 * t, -0.42 * t, -0.16 * t), 0.05, m, 3)
        for y in (0.4, 0.8, 1.25, 1.6):
            p.bolt(jaw_surf(y, radians(180 - sx * 70), 0.03), V(sx, 0, -0.3), 0.016, CH)
    attach(p.finish(c, bevel=0.003), arm, "jaw", basis=jm)
