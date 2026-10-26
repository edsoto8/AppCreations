"""Decoration props (no collision): trees, bush, flowers, grass tuft, rock, mushroom, fence,
signpost, background hills and clouds. Origin bottom-centre (clouds: centre).

Run:  python gen_decor.py   |   blender -b --python gen_decor.py --
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import bpy  # noqa: E402,F401
from mathutils import Matrix, Vector  # noqa: E402

import common  # noqa: E402
import export  # noqa: E402
import geom  # noqa: E402

V = Vector
FACE_Y = Matrix.Rotation(math.radians(90), 4, "X")


def clip_floor(bm, z=0.0):
    for v in bm.verts:
        v.co.z = max(v.co.z, z)
    return bm


def lumpy(radii, center, seed, amp=0.06, cuts=5, freq=1.6):
    bm = geom.blob(radii, center, cuts=cuts)
    geom.noise_displace(bm, amp * max(radii), freq / max(radii), seed=seed)
    return bm


# --------------------------------------------------------------------------- trees

def make_tree_round(col):
    rng = random.Random(101)
    mb = geom.MeshBuilder("tree_round")
    trunk = geom.tube([(0, 0, -0.05), (0.04, 0, 1.0), (-0.03, 0.02, 2.0), (0.02, 0, 2.7)],
                      [0.36, 0.27, 0.22, 0.16], segments=10, samples=3, caps=("flat", "round"))
    mb.add(trunk, "M_Wood")
    for i in range(4):
        a = math.radians(45 + 90 * i + rng.uniform(-15, 15))
        root = geom.tube([(0, 0, 0.35), (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.08),
                          (math.cos(a) * 0.45, math.sin(a) * 0.45, 0.0)], [0.12, 0.09, 0.05],
                         segments=6, samples=2, caps=("round", "round"), cap_rings=1)
        mb.add(clip_floor(root), "M_Wood")
    for a, z, l in ((0.5, 1.9, 0.55), (3.6, 2.2, 0.5)):
        br = geom.tube([(0, 0, z), (math.cos(a) * l, math.sin(a) * l * 0.4, z + 0.45)],
                       [0.08, 0.05], segments=6, samples=1, caps=("round", "round"), cap_rings=1)
        mb.add(br, "M_WoodDark")
    blobs = [((1.25, 1.1, 1.05), (0.0, 0.05, 3.3)), ((0.85, 0.8, 0.75), (0.85, 0.15, 2.8)),
             ((0.8, 0.75, 0.7), (-0.9, 0.1, 2.85)), ((0.75, 0.7, 0.7), (0.35, -0.3, 3.7)),
             ((0.7, 0.7, 0.65), (-0.45, 0.35, 3.75))]
    for i, (r, c) in enumerate(blobs):
        mb.add(lumpy(r, c, 200 + i, amp=0.08, cuts=5 if i == 0 else 4), "M_Leaf")
    for i in range(5):        # a few darker clumps for depth
        a = rng.uniform(0, 6.28)
        c = V((math.cos(a) * 1.0, -0.6 + rng.uniform(-0.2, 0.2), 2.6 + rng.uniform(0, 1.2)))
        mb.add(lumpy((0.3, 0.25, 0.28), c, 300 + i, cuts=2), "M_GrassDark")
    return [mb.to_object(col)]


def make_tree_pine(col):
    mb = geom.MeshBuilder("tree_pine")
    trunk = geom.lathe([(0.0, 0.0), (0.24, 0.0), (0.2, 0.15), (0.15, 0.5), (0.12, 1.6),
                        (0.0, 1.6)], segments=10)
    mb.add(trunk, "M_Wood")
    tiers = [(1.35, 0.75, 1.55), (1.12, 1.6, 1.45), (0.88, 2.4, 1.35), (0.62, 3.15, 1.25),
             (0.38, 3.85, 1.15)]
    for i, (r, z0, h) in enumerate(tiers):
        prof = [(0.0, z0 + 0.25), (r * 0.55, z0 + 0.12), (r * 0.92, z0 + 0.02), (r, z0 + 0.10),
                (r * 0.8, z0 + 0.30), (r * 0.5, z0 + h * 0.55), (r * 0.22, z0 + h * 0.85),
                (0.0, z0 + h)]
        cone = geom.lathe(prof, segments=20)
        ph = i * 0.7
        for v in cone.verts:
            rr = math.hypot(v.co.x, v.co.y)
            if rr > 0.2 * r:
                th = math.atan2(v.co.y, v.co.x)
                k = 1 + 0.07 * math.cos(7 * th + ph)
                v.co.x *= k
                v.co.y *= k
                v.co.z -= 0.06 * (rr / r) * (1 + math.cos(7 * th + ph))
        mb.add(cone, "M_GrassDark")
    return [mb.to_object(col)]


# --------------------------------------------------------------------------- small props

def make_bush(col):
    mb = geom.MeshBuilder("bush")
    for i, (r, c) in enumerate((((0.42, 0.38, 0.40), (0.0, 0.0, 0.42)),
                                ((0.32, 0.3, 0.3), (0.32, 0.05, 0.3)),
                                ((0.3, 0.28, 0.28), (-0.33, 0.02, 0.28)),
                                ((0.26, 0.25, 0.25), (0.12, -0.18, 0.62)),
                                ((0.24, 0.24, 0.24), (-0.15, 0.15, 0.68)))):
        mb.add(clip_floor(lumpy(r, c, 400 + i, cuts=5)), "M_Grass")
    rng = random.Random(9)
    for i in range(6):
        a = rng.uniform(-1.2, 1.2)
        p = V((math.sin(a) * 0.38, -math.cos(a) * 0.36, rng.uniform(0.25, 0.7)))
        mb.add(geom.blob((0.035, 0.035, 0.035), p, cuts=1), "M_FlowerPink")
    return [mb.to_object(col)]


def flower(mb, pos, color, rng, height):
    top = V(pos) + V((rng.uniform(-0.04, 0.04), rng.uniform(-0.03, 0.03), height))
    stem = geom.tube([V(pos), V(pos) + V((0, 0, height * 0.5)), top], [0.012, 0.011, 0.01],
                     segments=5, samples=2, caps=(None, "round"), cap_rings=1)
    mb.add(stem, "M_GrassDark")
    tilt = Matrix.Rotation(math.radians(-60), 4, "X")      # face the camera, tilted up
    for k in range(5):
        a = 2 * math.pi * k / 5
        petal = geom.blob((0.045, 0.024, 0.01), (0.045, 0, 0), cuts=1)
        mb.add(petal, color, matrix=Matrix.Translation(top) @ tilt @
               Matrix.Rotation(a, 4, "Z"))
    centre = "M_GoldDark" if color != "M_FlowerYellow" else "M_EarthDark"
    mb.add(geom.blob((0.026, 0.026, 0.016), cuts=1), centre,
           matrix=Matrix.Translation(top) @ tilt @ Matrix.Translation((0, 0, 0.008)))
    leaf = geom.blob((0.06, 0.02, 0.008), (0.06, 0, 0), cuts=0)
    mb.add(leaf, "M_Grass", matrix=Matrix.Translation(V(pos) + V((0, 0, height * 0.35))) @
           Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z") @ Matrix.Rotation(-0.5, 4, "Y"))


def make_flowers(col):
    rng = random.Random(55)
    mb = geom.MeshBuilder("flowers")
    spots = [(-0.38, 0.05), (-0.18, -0.18), (0.0, 0.12), (0.2, -0.1), (0.38, 0.08),
             (-0.05, -0.3), (0.28, 0.28), (-0.3, 0.3)]
    colors = ["M_FlowerWhite", "M_FlowerYellow", "M_FlowerPink"]
    for i, (x, y) in enumerate(spots):
        flower(mb, (x, y, 0), colors[i % 3], rng, rng.uniform(0.18, 0.34))
    for i in range(9):          # grass blades between the flowers
        x, y = rng.uniform(-0.45, 0.45), rng.uniform(-0.3, 0.3)
        h = rng.uniform(0.1, 0.18)
        blade = geom.tube([(x, y, 0), (x + rng.uniform(-0.04, 0.04), y, h)], [0.015, 0.003],
                          segments=4, samples=1, caps=(None, "point"), ellipse=(1, 0.45))
        mb.add(blade, "M_Grass")
    return [mb.to_object(col)]


def make_grass_tuft(col):
    rng = random.Random(77)
    mb = geom.MeshBuilder("grass_tuft")
    n = 9
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.2, 0.2)
        lean = rng.uniform(0.15, 0.4)
        h = rng.uniform(0.26, 0.4)
        base = V((math.cos(a) * 0.04, math.sin(a) * 0.03, 0))
        tip = base + V((math.cos(a) * lean * h, math.sin(a) * lean * h * 0.5, h))
        mid = base.lerp(tip, 0.5) + V((0, 0, 0.04))
        blade = geom.tube([base, mid, tip], [0.035, 0.022, 0.004], segments=4, samples=2,
                          caps=(None, "point"), ellipse=(1.0, 0.4))
        mb.add(blade, "M_Grass" if i % 3 else "M_GrassDark")
    return [mb.to_object(col)]


def make_rock(col):
    mb = geom.MeshBuilder("rock")
    big = geom.blob((0.42, 0.34, 0.36), (0, 0, 0.26), cuts=4, exponent=0.75)
    geom.noise_displace(big, 0.06, 2.4, seed=12)
    mb.add(clip_floor(big), "M_Stone", sharp=38)
    small = geom.blob((0.17, 0.15, 0.13), (0.38, -0.12, 0.08), cuts=2, exponent=0.75)
    geom.noise_displace(small, 0.03, 5, seed=13)
    mb.add(clip_floor(small), "M_Stone", sharp=38)
    moss = geom.blob((0.26, 0.2, 0.06), (-0.05, 0.05, 0.56), cuts=3)
    geom.noise_displace(moss, 0.02, 6, seed=14)
    mb.add(moss, "M_GrassDark")
    return [mb.to_object(col)]


def mushroom(mb, x, y, s, rng):
    stem = geom.lathe([(0.0, 0.0), (0.075, 0.0), (0.07, 0.12), (0.06, 0.26), (0.0, 0.26)],
                      segments=12)
    geom.transform(stem, Matrix.Translation((x, y, 0)) @ Matrix.Diagonal(V((s, s, s, 1))))
    mb.add(stem, "M_FlowerWhite")
    cap = geom.lathe([(0.0, 0.2), (0.12, 0.205), (0.22, 0.19), (0.27, 0.215), (0.25, 0.28),
                      (0.19, 0.35), (0.10, 0.39), (0.0, 0.40)], segments=16)
    surf_bm = cap.copy()
    geom.transform(cap, Matrix.Translation((x, y, 0)) @ Matrix.Diagonal(V((s, s, s, 1))))
    mb.add(cap, "M_Scarf")
    geom.transform(surf_bm, Matrix.Translation((x, y, 0)) @ Matrix.Diagonal(V((s, s, s, 1))))
    surf = geom.Surface(surf_bm)
    for k, (a, el) in enumerate(((-1.6, 0.6), (-0.9, 0.35), (-2.3, 0.35), (0.6, 0.5),
                                 (2.5, 0.5), (0.0, 1.2))):
        d = V((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        l, n = surf.radial(V((x, y, 0.2 * s)), d)
        if l is None:
            continue
        r = 0.04 * s * rng.uniform(0.8, 1.2)
        mb.add(geom.blob((r, 0.008, r), cuts=2), "M_FlowerWhite",
               matrix=Matrix.Translation(l) @ geom.orient_to(n))
    surf_bm.free()


def make_mushroom(col):
    rng = random.Random(31)
    mb = geom.MeshBuilder("mushroom")
    mushroom(mb, 0.0, 0.0, 1.5, rng)
    mushroom(mb, 0.3, -0.08, 0.8, rng)
    return [mb.to_object(col)]


def make_fence(col):
    mb = geom.MeshBuilder("fence")
    for x in (-0.93, 0.93):
        post = geom.extrude_shape([(-0.07, -0.07), (0.07, -0.07), (0.07, 0.07), (-0.07, 0.07)],
                                  0.92, center_z=False)
        top = geom.lathe([(0.0, 0.92), (0.07, 0.92), (0.0, 1.04)], segments=4)
        geom.transform(top, Matrix.Rotation(math.radians(45), 4, "Z"))
        top_b = geom.bevel(top, 0.01, segments=1, angle=30)
        mb.add(geom.bevel(post, 0.018, segments=2), "M_WoodDark",
               matrix=Matrix.Translation((x, 0, 0)), sharp=50)
        mb.add(top_b, "M_WoodDark", matrix=Matrix.Translation((x, 0, 0)), sharp=50)
    for z in (0.33, 0.7):
        rail = geom.bevel(geom.box((1.96, 0.05, 0.13), (0, -0.09, z)), 0.015, segments=2)
        mb.add(rail, "M_Wood", sharp=50)
    for x in (-0.93, 0.93):
        for z in (0.33, 0.7):
            mb.add(geom.blob((0.012, 0.01, 0.012), (x, -0.118, z), cuts=1), "M_Sole")
    return [mb.to_object(col)]


def make_signpost(col):
    mb = geom.MeshBuilder("signpost")
    post = geom.bevel(geom.box((0.12, 0.12, 1.42), (0, 0, 0.71)), 0.025, segments=2)
    mb.add(post, "M_WoodDark", sharp=50)
    cap = geom.lathe([(0.0, 1.42), (0.09, 1.42), (0.05, 1.5), (0.0, 1.52)], segments=8)
    mb.add(cap, "M_WoodDark", sharp=50)
    arrow = [(-0.30, -0.15), (0.28, -0.15), (0.28, -0.22), (0.50, 0.0), (0.28, 0.22),
             (0.28, 0.15), (-0.30, 0.15)]
    board = geom.bevel(geom.extrude_shape(arrow, 0.07), 0.025, segments=2, angle=40)
    mb.add(board, "M_Wood", matrix=Matrix.Translation((0.08, -0.1, 1.2)) @ FACE_Y, sharp=50)
    inner = [(-0.22, -0.035), (0.2, -0.035), (0.2, -0.09), (0.34, 0.0), (0.2, 0.09),
             (0.2, 0.035), (-0.22, 0.035)]
    stripe = geom.bevel(geom.extrude_shape(inner, 0.02), 0.006, segments=1, angle=40)
    mb.add(stripe, "M_WoodDark", matrix=Matrix.Translation((0.08, -0.14, 1.2)) @ FACE_Y,
           sharp=50)
    for x in (-0.16, 0.18):
        mb.add(geom.blob((0.014, 0.01, 0.014), (0.08 + x, -0.142, 1.31), cuts=1), "M_Sole")
    grass = geom.blob((0.2, 0.18, 0.08), (0, 0, 0), cuts=2)
    geom.noise_displace(grass, 0.02, 8, seed=3)
    mb.add(clip_floor(grass), "M_Grass")
    return [mb.to_object(col)]


# --------------------------------------------------------------------------- backdrop

def hill(mb, humps, bumps, seed):
    for i, (r, c, e) in enumerate(humps):
        bm = geom.blob(r, c, cuts=8, exponent=e)
        geom.noise_displace(bm, 0.25, 0.18, seed=seed + i)
        mb.add(clip_floor(bm), "M_Grass")
    rng = random.Random(seed)
    surf_src = geom.blob(humps[0][0], humps[0][1], cuts=6, exponent=humps[0][2])
    surf = geom.Surface(surf_src)
    for x, sz in bumps:
        # bushes sit on the upper front slope so they break the silhouette
        d = V((0, 0.55, -1)).normalized()
        l, n = surf.hit(V((x, 0, 0)) - d * 40, d)      # ray aimed at (x, 0, 0)
        if l is None:
            continue
        b = geom.blob((sz, sz * 0.8, sz * 0.85), l + n * sz * 0.15, cuts=3)
        geom.noise_displace(b, 0.08 * sz, 1.5 / sz, seed=rng.randint(0, 999))
        mb.add(clip_floor(b), "M_GrassDark")
    surf_src.free()


def make_hill_a(col):
    mb = geom.MeshBuilder("hill_a")
    hill(mb, [((12.0, 4.0, 9.4), (0, 0, 0), 0.8)], [(-6.5, 1.6), (-4.6, 1.1), (5.5, 1.4)],
         500)
    return [mb.to_object(col)]


def make_hill_b(col):
    mb = geom.MeshBuilder("hill_b")
    hill(mb, [((8.0, 4.0, 9.4), (-4.0, 0, 0), 0.85), ((7.5, 3.6, 6.5), (4.5, 0.3, 0), 0.85)],
         [(-1.5, 1.3), (-6.0, 1.0), (-8.6, 0.9)], 600)
    return [mb.to_object(col)]


def cloud(mb, puffs, seed):
    for i, (r, c) in enumerate(puffs):
        bm = geom.blob((r, r * 0.8, r * 0.85), c, cuts=5)
        geom.noise_displace(bm, 0.05 * r, 1.2 / r, seed=seed + i)
        for v in bm.verts:                   # flat-ish cloud base
            v.co.z = max(v.co.z, -0.55)
        mb.add(bm, "M_Cloud")


def make_cloud_a(col):
    mb = geom.MeshBuilder("cloud_a")
    cloud(mb, [(1.3, (0, 0, 0.25)), (1.0, (-1.4, 0.1, -0.05)), (0.95, (1.45, 0.0, -0.05)),
               (0.75, (-2.35, 0.1, -0.2)), (0.7, (2.35, 0.1, -0.2)), (0.85, (0.6, -0.3, 0.6))],
          700)
    return [mb.to_object(col)]


def make_cloud_b(col):
    mb = geom.MeshBuilder("cloud_b")
    cloud(mb, [(1.1, (-0.6, 0, 0.2)), (1.15, (0.8, 0.1, 0.3)), (0.8, (-1.9, 0.0, -0.1)),
               (0.85, (2.2, 0.1, -0.1)), (0.6, (-0.1, -0.4, 0.75))], 800)
    return [mb.to_object(col)]


PIECES = [("tree_round", make_tree_round), ("tree_pine", make_tree_pine), ("bush", make_bush),
          ("flowers", make_flowers), ("grass_tuft", make_grass_tuft), ("rock", make_rock),
          ("mushroom", make_mushroom), ("fence", make_fence), ("signpost", make_signpost),
          ("hill_a", make_hill_a), ("hill_b", make_hill_b), ("cloud_a", make_cloud_a),
          ("cloud_b", make_cloud_b)]
CENTERED = {"cloud_a", "cloud_b"}


def recenter(ob, bottom=True):
    """Put the origin at bottom-centre (or bbox centre) of the mesh, transforms applied."""
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    off = V(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2,
             min(zs) if bottom else (min(zs) + max(zs)) / 2))
    ob.data.transform(Matrix.Translation(-off))


def build(out_dir, save=True, only=None):
    common.reset_scene()
    written = []
    for name, fn in PIECES:
        if only and name not in only:
            continue
        col = common.new_collection(name)
        objs = fn(col)
        for ob in objs:
            recenter(ob, bottom=name not in CENTERED)
        path = os.path.join(out_dir, name + ".glb")
        export.export_glb(objs, path)
        written.append(path)
    if save:
        common.save_blend("decor")
    return written


def main():
    args = common.parse_args("Generate decoration props")
    for p in build(args.out, save=not args.no_blend, only=args.only):
        print("wrote", p)


if __name__ == "__main__":
    main()
