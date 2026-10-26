"""Collectibles and markers: coin, checkpoint (Post + Flag), goal (Arch + Emblem).

Run:  python gen_pickups.py   |   blender -b --python gen_pickups.py --
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import bpy  # noqa: E402,F401
from mathutils import Matrix, Vector  # noqa: E402

import common  # noqa: E402
import export  # noqa: E402
import geom  # noqa: E402

V = Vector
FACE_Y = Matrix.Rotation(math.radians(90), 4, "X")   # XY-plane shape -> XZ plane (faces -Y)


def sun_shape(r_in, r_out, rays=8, ray_w=0.42, steps=3):
    """Rounded sun outline: disc with pointed rays (counter-clockwise 2D points)."""
    pts = []
    n = rays * steps * 2
    for i in range(n):
        a = 2 * math.pi * i / n
        ph = (a * rays / (2 * math.pi)) % 1.0
        d = min(ph, 1 - ph) * 2          # 0 at a ray centre, 1 midway between rays
        k = max(0.0, 1 - d / ray_w)
        r = r_in + (r_out - r_in) * (k ** 1.6)
        pts.append((r * math.cos(a + math.pi / 2), r * math.sin(a + math.pi / 2)))
    return pts


def star_shape(r_in, r_out, points=5):
    pts = []
    for i in range(points * 2):
        a = math.pi / 2 + math.pi * i / points
        r = r_out if i % 2 == 0 else r_in
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def plate(pts2d, thickness, bevel_w, segments=1):
    bm = geom.extrude_shape(pts2d, thickness)
    bm = geom.bevel(bm, bevel_w, segments=segments, angle=40)
    geom.mark_sharp(bm, 50)
    return bm


# --------------------------------------------------------------------------- coin

def make_coin(col):
    mb = geom.MeshBuilder("coin")
    prof = [(0.0, 0.034), (0.205, 0.034), (0.224, 0.044), (0.238, 0.060), (0.284, 0.060),
            (0.300, 0.044), (0.300, -0.044), (0.284, -0.060), (0.238, -0.060), (0.224, -0.044),
            (0.205, -0.034), (0.0, -0.034)]
    disc = geom.lathe(prof, segments=36, axis="Y", cap=False)
    for f in disc.faces:
        c = f.calc_center_median()
        f.material_index = 1 if math.hypot(c.x, c.z) > 0.215 else 0
    geom.mark_sharp(disc, 50)
    mb.add(disc, ["M_Gold", "M_GoldDark"])
    for side in (-1, 1):
        sun = plate(sun_shape(0.085, 0.165, rays=8), 0.026, 0.007)
        ring = geom.torus(0.105, 0.011, segments=24, ring_segments=5)
        M = Matrix.Translation((0, side * 0.034, 0)) @ FACE_Y
        if side > 0:
            M = M @ Matrix.Rotation(math.pi, 4, "Y")
        mb.add(sun, "M_Gold", matrix=M.copy())
        mb.add(ring, "M_GoldDark", matrix=Matrix.Translation((0, side * 0.047, 0)) @ FACE_Y)
        dot = geom.blob((0.045, 0.045, 0.012), cuts=2)
        mb.add(dot, "M_GoldDark", matrix=Matrix.Translation((0, side * 0.047, 0)) @ FACE_Y)
    return [mb.to_object(col)]


# --------------------------------------------------------------------------- checkpoint

def make_checkpoint(col):
    mb = geom.MeshBuilder("Post")
    post = geom.bevel(geom.box((0.15, 0.15, 2.28), (0, 0, 1.14)), 0.03, segments=3)
    mb.add(post, "M_Wood", sharp=50)
    for z in (0.35, 2.02):
        band = geom.bevel(geom.box((0.175, 0.175, 0.06), (0, 0, z)), 0.015, segments=2)
        mb.add(band, "M_WoodDark", sharp=50)
    cap = geom.lathe([(0.0, 2.26), (0.13, 2.26), (0.13, 2.30), (0.10, 2.34), (0.05, 2.385),
                      (0.0, 2.40)], segments=16)
    mb.add(cap, "M_WoodDark", sharp=60)
    base = geom.blob((0.22, 0.22, 0.09), (0, 0, 0.0), cuts=3, exponent=0.7)
    for v in base.verts:
        v.co.z = max(v.co.z, 0.0)
    geom.noise_displace(base, 0.02, 6.0, seed=5)
    for v in base.verts:
        v.co.z = max(v.co.z, 0.0)
    mb.add(base, "M_Stone", sharp=60)
    post_ob = mb.to_object(col)

    # Flag: pennant, origin at the top-left attachment point (x = post face, z = 2.1)
    fb = geom.MeshBuilder("Flag")
    import bmesh
    bm = bmesh.new()
    L, H, nx = 0.78, 0.48, 10
    rows = []
    for i in range(nx + 1):
        u = i / nx
        x = 0.02 + L * u
        top = -(H / 2 - 0.05) * u ** 1.15           # classic pennant: tapers to a
        bot = -H * (1 - u) + (-H / 2 - 0.05) * u    # rounded point (0.1 m) at the tip
        y = 0.035 * math.sin(math.pi * u * 1.4)
        rows.append((x, y, top, bot))
    th = 0.012
    front, back = [], []
    for x, y, top, bot in rows:
        front.append((bm.verts.new((x, y - th, top)), bm.verts.new((x, y - th, bot))))
        back.append((bm.verts.new((x, y + th, top)), bm.verts.new((x, y + th, bot))))
    for i in range(nx):
        bm.faces.new((front[i][0], front[i][1], front[i + 1][1], front[i + 1][0]))
        bm.faces.new((back[i][0], back[i + 1][0], back[i + 1][1], back[i][1]))
        bm.faces.new((front[i][0], front[i + 1][0], back[i + 1][0], back[i][0]))
        bm.faces.new((front[i][1], back[i][1], back[i + 1][1], front[i + 1][1]))
    bm.faces.new((front[0][0], back[0][0], back[0][1], front[0][1]))
    bm.faces.new((front[-1][0], front[-1][1], back[-1][1], back[-1][0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm = geom.subdivide(bm, 1)
    geom.mark_sharp(bm, 60)
    fb.add(bm, "M_Banner")
    for z in (-0.04, -0.36):
        clip = geom.torus(0.09, 0.016, segments=14, ring_segments=6, center=(-0.075, 0, z))
        fb.add(clip, "M_WoodDark")
    flag_ob = fb.to_object(col)
    flag_ob.location = (0.075, 0.0, 2.1)
    return [post_ob, flag_ob]


# --------------------------------------------------------------------------- goal

def make_goal(col):
    mb = geom.MeshBuilder("Arch")
    X = 1.82
    for s in (-1, 1):
        log = geom.lathe([(0.0, 0.0), (0.2, 0.0), (0.2, 0.05), (0.17, 0.12), (0.165, 1.8),
                          (0.16, 3.1), (0.0, 3.1)], segments=12)
        geom.noise_displace(log, 0.008, 3.0, seed=7 + s)
        for v in log.verts:
            v.co.z = max(v.co.z, 0.0)
        mb.add(log, "M_Wood", matrix=Matrix.Translation((s * X, 0, 0)), sharp=60)
        for z in (0.55, 2.6):
            band = geom.torus(0.17, 0.03, segments=10, ring_segments=4, center=(s * X, 0, z))
            mb.add(band, "M_WoodDark")
        stone = geom.blob((0.32, 0.30, 0.16), (s * X, 0, 0.0), cuts=2, exponent=0.7)
        geom.noise_displace(stone, 0.03, 4.0, seed=11 + s)
        for v in stone.verts:
            v.co.z = max(v.co.z, 0.0)
        mb.add(stone, "M_Stone", sharp=60)
    # curved top beam
    pts = [(-X - 0.25, 0, 2.86), (-X, 0, 3.06), (-0.9, 0, 3.28), (0, 0, 3.35), (0.9, 0, 3.28),
           (X, 0, 3.06), (X + 0.25, 0, 2.86)]
    beam = geom.tube(pts, [0.15, 0.19, 0.19, 0.19, 0.19, 0.19, 0.15], segments=10, samples=3,
                     caps=("round", "round"), cap_rings=2)
    mb.add(beam, "M_Wood")
    knob = geom.lathe([(0.0, 3.40), (0.13, 3.40), (0.10, 3.50), (0.05, 3.545), (0.0, 3.55)],
                      segments=12)
    mb.add(knob, "M_WoodDark")
    beam2 = geom.tube([(p[0], -0.05, p[2] - 0.30) for p in pts[1:-1]], [0.08] * 5, segments=6,
                      samples=3, caps=("round", "round"), cap_rings=2)
    mb.add(beam2, "M_WoodDark")
    # bunting: sagging string with alternating pennants
    n = 9
    a, b = V((-X + 0.15, -0.12, 2.72)), V((X - 0.15, -0.12, 2.72))
    sag = 0.28
    string_pts = []
    for i in range(n * 2 + 1):
        t = i / (n * 2)
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        string_pts.append(p)
    rope = geom.tube(string_pts, [0.015] * len(string_pts), segments=6, samples=1,
                     caps=("round", "round"), cap_rings=1)
    mb.add(rope, "M_WoodDark")
    cols = ["M_Banner", "M_FlowerYellow", "M_Jacket", "M_FlowerPink"]
    for i in range(n):
        t = (i + 0.5) / n
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        tri = plate([(-0.15, 0.0), (0.0, -0.30), (0.15, 0.0)], 0.02, 0.006)
        mb.add(tri, cols[i % len(cols)], matrix=Matrix.Translation(p) @ FACE_Y)
    arch = mb.to_object(col)

    eb = geom.MeshBuilder("Emblem")
    sun = plate(sun_shape(0.29, 0.48, rays=8, ray_w=0.45), 0.12, 0.03, segments=1)
    eb.add(sun, "M_Gold", matrix=FACE_Y.copy())
    for side in (-1, 1):
        ring = geom.torus(0.2, 0.025, segments=20, ring_segments=4)
        eb.add(ring, "M_GoldDark", matrix=Matrix.Translation((0, side * 0.065, 0)) @ FACE_Y)
        star = plate(star_shape(0.07, 0.16), 0.03, 0.01)
        eb.add(star, "M_GoldDark", matrix=Matrix.Translation((0, side * 0.07, 0)) @ FACE_Y)
    emblem = eb.to_object(col)
    emblem.location = (0, 0, 4.02)
    return [arch, emblem]


PIECES = [("coin", make_coin), ("checkpoint", make_checkpoint), ("goal", make_goal)]


def build(out_dir, save=True, only=None):
    common.reset_scene()
    written = []
    for name, fn in PIECES:
        if only and name not in only:
            continue
        col = common.new_collection(name)
        objs = fn(col)
        path = os.path.join(out_dir, name + ".glb")
        export.export_glb(objs, path)
        written.append(path)
    if save:
        common.save_blend("pickups")
    return written


def main():
    args = common.parse_args("Generate coin, checkpoint and goal")
    for p in build(args.out, save=not args.no_blend, only=args.only):
        print("wrote", p)


if __name__ == "__main__":
    main()
