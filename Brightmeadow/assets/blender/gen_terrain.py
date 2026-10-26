"""Modular terrain (ASSET_CONTRACT.md "Terrain").

Every piece is an edge *profile* swept along a *plan path*:
  - mids: the front edge (y = -depth/2) and the back edge (y = +depth/2), straight along X;
  - caps: one U-shaped path around the rounded outer end.
The profile is identical for every piece and the front-lip wave is a sum of
(1 - cos(2*pi*k*u)) / 2 terms, which is 0 with zero slope at both ends of a mid (u = 0, 1)
and at the inner edge of a cap. So the cross-section at every joint is exactly the same and
any order of mids/caps tiles without gaps or seams. The walk surface is the flat top at z = 0.

Run:  python gen_terrain.py   |   blender -b --python gen_terrain.py --
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import bpy  # noqa: E402,F401  (must precede bmesh when bpy is a module)
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common  # noqa: E402
import export  # noqa: E402
import geom  # noqa: E402

V = Vector
G, GD, E, ED, ST = 0, 1, 2, 3, 4
MATS = ["M_Grass", "M_GrassDark", "M_Earth", "M_EarthDark", "M_Stone"]

# (d = outward offset from the nominal edge, z, material of the band below, lip-wave weight)
LIP = [
    (-0.10, 0.000, G, 0.0),
    (-0.05, -0.006, G, 0.0),
    (0.010, -0.030, G, 0.25),
    (0.060, -0.075, G, 0.55),
    (0.103, -0.150, G, 0.85),
    (0.120, -0.240, GD, 1.0),
    (0.095, -0.318, GD, 1.0),
    (0.030, -0.358, E, 0.8),
]
GROUND_PROFILE = LIP + [
    (0.000, -0.40, E, 0.0),
    (0.014, -0.95, E, 0.0),
    (0.000, -1.50, ED, 0.0),
    (0.000, -1.82, E, 0.0),
    (-0.010, -3.20, ED, 0.0),
    (-0.010, -3.55, E, 0.0),
    (0.000, -8.00, E, 0.0),
]
FLOAT_PROFILE = LIP + [
    (0.000, -0.40, E, 0.0),
    (-0.030, -0.52, E, 0.0),
]
LIP_DROP = 0.075        # how far the scallops hang at the wave peaks
LIP_OUT = 0.012
HALF_W = 0.5
LIP_MAX = max(p[0] for p in LIP)          # 0.12 -> caps' side edge sits at x = -0.38


def lip_wave(u, terms):
    return sum(a * (1 - math.cos(2 * math.pi * k * u)) / 2 for a, k in terms)


# --------------------------------------------------------------------------- plan paths

def straight(p0, p1, n, normal, s0=0.0):
    out = []
    for i in range(n + 1):
        t = i / n
        p = p0.lerp(p1, t)
        out.append((p, normal.copy(), s0 + (p - p0).length))
    return out


def arc(center, r, a0, a1, n, s0):
    out = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        nrm = V((math.cos(a), math.sin(a)))
        out.append((center + nrm * r, nrm, s0 + r * abs(math.radians(a1 - a0)) * i / n))
    return out


def join(*segs):
    pts = []
    for sg in segs:
        pts += sg if not pts else sg[1:]
    return pts


def cap_path(half_depth, r, side_n):
    """Left cap: from the front inner corner (0, -h) around the outer end to (0, +h)."""
    h = half_depth
    xc = -HALF_W + LIP_MAX
    a = straight(V((0, -h)), V((xc + r, -h)), 1, V((0, -1)))
    b = arc(V((xc + r, -h + r)), r, -90, -180, 6, a[-1][2])
    c = straight(V((xc, -h + r)), V((xc, h - r)), side_n, V((-1, 0)), b[-1][2])
    d = arc(V((xc + r, h - r)), r, 180, 90, 6, c[-1][2])
    e = straight(V((xc + r, h)), V((0, h)), 1, V((0, 1)), d[-1][2])
    return join(a, b, c, d, e), b[-1][2]


# --------------------------------------------------------------------------- builder

def build_slab(paths, profile, under_k=0, under_depth=0.0, x_squeeze=0.0):
    """Sweep `profile` along each plan path, then close top, bottom and the open ends.

    paths: list of [(pos2d, normal2d, s, wave)] (wave = lip displacement 0..1).
    under_k > 0 builds a rounded underside of `under_k` rings dropping `under_depth` below the
    last profile point (floating platforms). x_squeeze pulls the underside rings in along X
    (rounded ends of caps); 0 for mids so their underside is a pure extrusion along X.
    """
    bm = bmesh.new()
    columns = []          # per path: list of columns (list of verts top->bottom)
    for path in paths:
        cols = []
        for pos, nrm, _s, w in path:
            col = []
            for d, z, _m, ww in profile:
                k = w * ww
                dd = d + LIP_OUT * k
                col.append(bm.verts.new((pos.x + nrm.x * dd, pos.y + nrm.y * dd,
                                         z - LIP_DROP * k)))
            cols.append(col)
        columns.append(cols)
        for i in range(len(cols) - 1):
            a, b = cols[i], cols[i + 1]
            for j in range(len(profile) - 1):
                f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
                f.material_index = profile[j][2]

    # underside rings (rounded) or flat bottom
    last = len(profile) - 1
    z_last = profile[last][1]
    ring_rows = []
    for cols in columns:
        rows = [[c[last] for c in cols]]
        for k in range(1, under_k + 1):
            t = k / under_k
            g = math.sqrt(max(0.0, 1 - (1 - t) ** 2))
            row = []
            for c in cols:
                p = c[last].co
                row.append(bm.verts.new((p.x * (1 - x_squeeze * t), p.y * (1 - t),
                                         z_last - under_depth * g)))
            rows.append(row)
        ring_rows.append(rows)
        for k in range(len(rows) - 1):
            a, b = rows[k], rows[k + 1]
            for i in range(len(a) - 1):
                f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
                f.material_index = ED if k == 0 else E

    # flat top: n-gon over the inner (first) profile row of every path
    top = []
    for cols in columns:
        top += [c[0] for c in cols]
    f = bm.faces.new(top)
    f.material_index = G
    if under_k == 0:
        bot = []
        for cols in columns:
            bot += [c[last] for c in cols]
        f = bm.faces.new(bot)
        f.material_index = E

    # open ends: cross-section polygons where a path starts/ends
    ends = []
    if len(columns) == 2:          # mid: front runs -x..+x, back runs +x..-x
        ends.append((columns[0][0], ring_rows[0], 0, columns[1][-1], ring_rows[1], -1))
        ends.append((columns[0][-1], ring_rows[0], -1, columns[1][0], ring_rows[1], 0))
    else:                          # cap: one U path, both ends at x = 0
        ends.append((columns[0][0], ring_rows[0], 0, columns[0][-1], ring_rows[0], -1))
    for colA, rowsA, ia, colB, rowsB, ib in ends:
        loop = list(colA) + [r[ia] for r in rowsA[1:]]
        loopB = list(colB) + [r[ib] for r in rowsB[1:]]
        if under_k:
            loopB = loopB[:-1]       # the last underside ring point is shared (y = 0)
        loop += list(reversed(loopB))
        vs = []
        for v in loop:                   # duplicate coincident vertices get merged later
            vs.append(bm.verts.new(v.co))
        try:
            f = bm.faces.new(vs)
            f.material_index = E
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    # drop degenerate faces left by merging
    bad = [f for f in bm.faces if f.calc_area() < 1e-9]
    bmesh.ops.delete(bm, geom=bad, context="FACES")
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4],
                          quad_method="BEAUTY", ngon_method="BEAUTY")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    geom.set_smooth(bm, True)
    geom.mark_sharp(bm, 55)
    return bm


def mid_paths(half_depth, terms, n=12):
    front = []
    for i in range(n + 1):
        x = -HALF_W + i / n
        u = i / n
        front.append((V((x, -half_depth)), V((0, -1)), u, lip_wave(u, terms)))
    back = []
    for i in range(n + 1):
        x = HALF_W - i / n
        back.append((V((x, half_depth)), V((0, 1)), i / n, 0.0))
    return [front, back]


def cap_paths(half_depth, r, side_n, terms):
    path, s_corner = cap_path(half_depth, r, side_n)
    total = path[-1][2]
    out = []
    for pos, nrm, s in path:
        win = 1 - geom.smoothstep(s_corner - 0.45, s_corner - 0.05, s)
        out.append((pos, nrm, s, lip_wave(s / total, terms) * win))
    return out


def mirror_x(bm):
    geom.transform(bm, Matrix.Diagonal(V((-1, 1, 1, 1))))
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return bm


# --------------------------------------------------------------------------- decoration

def stone(rng, size, flat=0.6):
    bm = geom.quad_sphere(1)
    geom.transform(bm, Matrix.Diagonal(V((size * rng.uniform(0.9, 1.3), size * flat,
                                         size * rng.uniform(0.7, 1.0), 1))))
    geom.noise_displace(bm, size * 0.25, 3.0 / size, seed=rng.randint(0, 9999))
    geom.set_smooth(bm, True)
    return bm


def add_front_stones(mb, rng, front_y, spots, xlim=0.34):
    for x, z, size, kind in spots:
        x = max(-xlim, min(xlim, x))
        if kind == "stone":
            st = stone(rng, size)
            mb.add(st, "M_Stone", matrix=Matrix.Translation((x, front_y - size * 0.25, z)) @
                   Matrix.Rotation(rng.uniform(-0.6, 0.6), 4, "Y"), sharp=70)
        else:
            st = stone(rng, size, flat=0.5)
            mb.add(st, "M_EarthDark", matrix=Matrix.Translation((x, front_y - size * 0.15, z)),
                   sharp=70)


def tuft_blades(rng, height=0.13, blades=4):
    out = []
    for i in range(blades):
        a = 2 * math.pi * i / blades + rng.uniform(-0.4, 0.4)
        lean = rng.uniform(0.25, 0.55)
        h = height * rng.uniform(0.7, 1.1)
        tip = V((math.cos(a) * lean * h, math.sin(a) * lean * h * 0.6, h))
        mid = tip * 0.5 + V((0, 0, h * 0.08))
        out.append(geom.tube([(0, 0, -0.02), mid, tip], [0.018, 0.012, 0.004], segments=4,
                             samples=2, caps=(None, "point"), ellipse=(1.0, 0.45)))
    return out


def add_tufts(mb, rng, spots, mat="M_GrassDark"):
    for x, y in spots:
        M = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z")
        for blade in tuft_blades(rng):
            mb.add(blade, mat, matrix=M.copy())


# --------------------------------------------------------------------------- pieces

MID_VARIANTS = {
    "a": dict(terms=[(0.65, 2), (0.30, 3), (0.12, 5)], seed=11,
              stones=[(-0.18, -0.72, 0.10, "stone"), (0.21, -1.15, 0.08, "stone"),
                      (0.02, -2.2, 0.13, "stone"), (-0.25, -1.7, 0.05, "pebble"),
                      (0.3, -0.6, 0.04, "pebble")],
              tufts=[(-0.2, 1.2), (0.25, 1.6)]),
    "b": dict(terms=[(0.55, 3), (0.35, 2), (0.15, 4)], seed=23,
              stones=[(0.12, -0.85, 0.12, "stone"), (-0.22, -1.35, 0.07, "stone"),
                      (0.25, -2.6, 0.09, "stone"), (-0.05, -0.62, 0.04, "pebble")],
              tufts=[(0.1, 1.35)]),
    "c": dict(terms=[(0.5, 2), (0.25, 4), (0.25, 5)], seed=37,
              stones=[(-0.1, -1.0, 0.07, "stone"), (0.2, -0.7, 0.05, "pebble"),
                      (-0.28, -2.4, 0.11, "stone"), (0.05, -1.95, 0.05, "pebble")],
              tufts=[(-0.3, 1.3), (0.05, 1.0), (0.3, 1.7)]),
}
CAP_TERMS = [(0.6, 7), (0.3, 11)]


def make_ground_mid(col, v):
    cfg = MID_VARIANTS[v]
    rng = random.Random(cfg["seed"])
    mb = geom.MeshBuilder(f"ground_mid_{v}")
    slab = build_slab(mid_paths(2.0, cfg["terms"]), GROUND_PROFILE)
    mb.add(slab, MATS)
    add_front_stones(mb, rng, -2.0, cfg["stones"])
    add_tufts(mb, rng, cfg["tufts"])
    return mb.to_object(col)


def make_ground_cap(col, side):
    rng = random.Random(51 if side == "left" else 52)
    mb = geom.MeshBuilder(f"ground_cap_{side}")
    slab = build_slab([cap_paths(2.0, 0.3, 10, CAP_TERMS)], GROUND_PROFILE)
    stones = [(-0.2, -0.9, 0.09, "stone"), (-0.12, -1.6, 0.05, "pebble")]
    if side == "right":
        mirror_x(slab)
    mb.add(slab, MATS)
    sx = -1 if side == "left" else 1
    add_front_stones(mb, rng, -2.0, [(sx * abs(x), z, s, k) for x, z, s, k in stones], 0.3)
    add_tufts(mb, rng, [(sx * 0.22, 1.1)])
    return mb.to_object(col)


FLOAT_VARIANTS = {
    "a": dict(terms=[(0.6, 2), (0.3, 3)], seed=61, stones=[(0.18, -0.45, 0.06, "stone")],
              tufts=[(-0.2, 0.85)]),
    "b": dict(terms=[(0.5, 3), (0.3, 2), (0.15, 5)], seed=62,
              stones=[(-0.2, -0.46, 0.045, "pebble")], tufts=[(0.2, 0.95)]),
}


def make_float_mid(col, v):
    cfg = FLOAT_VARIANTS[v]
    rng = random.Random(cfg["seed"])
    mb = geom.MeshBuilder(f"float_mid_{v}")
    slab = build_slab(mid_paths(1.25, cfg["terms"]), FLOAT_PROFILE, under_k=5,
                      under_depth=0.38)
    mb.add(slab, MATS)
    add_front_stones(mb, rng, -1.25, cfg["stones"])
    add_tufts(mb, rng, cfg["tufts"])
    return mb.to_object(col)


def make_float_cap(col, side):
    rng = random.Random(71 if side == "left" else 72)
    mb = geom.MeshBuilder(f"float_cap_{side}")
    slab = build_slab([cap_paths(1.25, 0.3, 6, CAP_TERMS)], FLOAT_PROFILE, under_k=5,
                      under_depth=0.38, x_squeeze=0.8)
    if side == "right":
        mirror_x(slab)
    mb.add(slab, MATS)
    return mb.to_object(col)


PIECES = (
    [(f"ground_mid_{v}", lambda c, v=v: make_ground_mid(c, v)) for v in "abc"]
    + [(f"ground_cap_{s}", lambda c, s=s: make_ground_cap(c, s)) for s in ("left", "right")]
    + [(f"float_mid_{v}", lambda c, v=v: make_float_mid(c, v)) for v in "ab"]
    + [(f"float_cap_{s}", lambda c, s=s: make_float_cap(c, s)) for s in ("left", "right")]
)


def build(out_dir, save=True, only=None):
    common.reset_scene()
    written = []
    for name, fn in PIECES:
        if only and name not in only:
            continue
        col = common.new_collection(name)
        ob = fn(col)
        ob.name = name
        path = os.path.join(out_dir, name + ".glb")
        export.export_glb([ob], path)
        written.append(path)
    if save:
        common.save_blend("terrain")
    return written


def main():
    args = common.parse_args("Generate terrain pieces")
    for p in build(args.out, save=not args.no_blend, only=args.only):
        print("wrote", p)


if __name__ == "__main__":
    main()
