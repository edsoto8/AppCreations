"""Explorer "Juni" — the player character (ASSET_CONTRACT.md "Character").

Run:  python gen_character.py            (bpy module)
      blender -b --python gen_character.py --
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import bpy  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

import common  # noqa: E402
import export  # noqa: E402
import geom  # noqa: E402
import rig  # noqa: E402
from geom import V, smoothstep  # noqa: E402
from rig import BoneXf, euler_q, keys, wave  # noqa: E402

HEIGHT = 1.55

# --------------------------------------------------------------------------- skeleton
# (name, head, tail, parent) in Blender armature space (Z up, front -Y, character left +X)
SHOULDER = {1: V((0.160, 0.0, 0.855)), -1: V((-0.160, 0.0, 0.855))}
ELBOW = {1: V((0.228, 0.01, 0.700)), -1: V((-0.228, 0.01, 0.700))}
WRIST = {1: V((0.262, 0.0, 0.548)), -1: V((-0.262, 0.0, 0.548))}
HIP = {1: V((0.098, 0.0, 0.50)), -1: V((-0.098, 0.0, 0.50))}
KNEE = {1: V((0.103, 0.0, 0.36)), -1: V((-0.103, 0.0, 0.36))}
ANKLE = {1: V((0.108, 0.0, 0.20)), -1: V((-0.108, 0.0, 0.20))}
HEAD_C = V((0.0, 0.0, 1.19))
EYE_Z = 1.205
EYE_X = 0.094


def sfx(s):
    return ".L" if s > 0 else ".R"


def bone_list(eye_pts):
    b = [
        ("root", (0, 0, 0), (0, 0, 0.12), None),
        ("hips", (0, 0, 0.50), (0, 0, 0.60), "root"),
        ("spine", (0, 0, 0.60), (0, 0, 0.74), "hips"),
        ("chest", (0, 0, 0.74), (0, 0, 0.90), "spine"),
        ("neck", (0, 0, 0.90), (0, 0, 0.98), "chest"),
        ("head", (0, 0, 0.98), (0, 0, 1.32), "neck"),
        ("hair", (0, 0.0, 1.42), (0, -0.02, 1.53), "head"),
        ("pack", (0, 0.20, 0.87), (0, 0.20, 0.62), "chest"),
        ("scarf.1", (0.02, 0.08, 0.95), (0.05, 0.25, 0.91), "neck"),
        ("scarf.2", (0.05, 0.25, 0.91), (0.07, 0.34, 0.72), "scarf.1"),
    ]
    for s in (1, -1):
        x = sfx(s)
        b += [
            ("upper_arm" + x, tuple(SHOULDER[s]), tuple(ELBOW[s]), "chest"),
            ("forearm" + x, tuple(ELBOW[s]), tuple(WRIST[s]), "upper_arm" + x),
            ("hand" + x, tuple(WRIST[s]), tuple(WRIST[s] + V((0.012 * s, 0, -0.11))),
             "forearm" + x),
            ("thigh" + x, tuple(HIP[s]), tuple(KNEE[s]), "hips"),
            ("shin" + x, tuple(KNEE[s]), tuple(ANKLE[s]), "thigh" + x),
            ("foot" + x, tuple(ANKLE[s]), tuple(ANKLE[s] + V((0, -0.15, -0.12))), "shin" + x),
            ("eye" + x, tuple(eye_pts[s]), tuple(eye_pts[s] + V((0, 0, 0.05))), "head"),
        ]
    return b


# --------------------------------------------------------------------------- weights

def torso_weights(co):
    z = co.z
    wh = 1 - smoothstep(0.47, 0.60, z)
    wc = smoothstep(0.66, 0.80, z)
    ws = max(0.0, 1 - wh - wc)
    return {"hips": wh, "spine": ws, "chest": wc}


def chain_weights(a, b, c, bone_a, bone_b, blend=0.045):
    """Blend two bones around joint b along the a->b->c chain (for sleeves / trousers)."""
    def fn(co):
        d1 = (b - a)
        t = (co - b).dot(d1.normalized())          # signed distance past the joint
        w = smoothstep(-blend, blend, t)
        return {bone_a: 1 - w, bone_b: w}
    return fn


# --------------------------------------------------------------------------- head

def head_shape(d):
    x, y, z = d.x, d.y, d.z
    cheek = math.exp(-((z + 0.38) / 0.32) ** 2)
    x *= 1 + 0.075 * cheek
    if z < -0.45:
        k = smoothstep(-0.45, -1.0, z)
        x *= 1 - 0.16 * k
        y *= 1 - 0.10 * k
    if y < 0:
        y *= 0.90 + 0.06 * max(0.0, z)        # flatter face, fuller forehead
    else:
        y *= 1.04
    if z > 0.3:
        x *= 1 - 0.05 * (z - 0.3)
    return V((x, y, z))


def build_head(mb):
    head = geom.blob((0.258, 0.240, 0.248), HEAD_C, cuts=9, fn=head_shape)
    surf = geom.Surface(head)
    mb.add(head, "M_Skin", bone="head")

    eye_pts = {}
    for s in (1, -1):
        loc, n = surf.front(s * EYE_X, EYE_Z)
        # tilt the eye frame a little toward the camera so both eyes read from the front
        n = (n + V((0, -0.18, 0))).normalized()
        M = Matrix.Translation(loc) @ geom.orient_to(n)
        eye_pts[s] = loc.copy()
        x = sfx(s)
        white = geom.blob((0.064, 0.028, 0.080), (0, 0, 0), cuts=4)
        mb.add(white, "M_EyeWhite", bone="eye" + x, matrix=M @ Matrix.Translation((0, 0.0175, 0)))
        pupil = geom.blob((0.043, 0.016, 0.055), (0, 0, 0), cuts=3)
        mb.add(pupil, "M_EyeDark", bone="eye" + x,
               matrix=M @ Matrix.Translation((-s * 0.006, -0.0005, -0.006)))
        hl = geom.blob((0.016, 0.008, 0.018), (0, 0, 0), cuts=2)
        mb.add(hl, "M_EyeWhite", bone="eye" + x,
               matrix=M @ Matrix.Translation((s * 0.013, -0.009, 0.020)))
        hl2 = geom.blob((0.007, 0.005, 0.007), (0, 0, 0), cuts=1)
        mb.add(hl2, "M_EyeWhite", bone="eye" + x,
               matrix=M @ Matrix.Translation((-s * 0.016, -0.0075, -0.022)))

        # brows: short arched strokes
        pts = []
        for bx, bz in ((0.046, 1.300), (0.090, 1.318), (0.136, 1.300)):
            l2, n2 = surf.front(s * bx, bz)
            pts.append(l2 + n2 * 0.006)
        brow = geom.tube(pts, [0.008, 0.013, 0.007], segments=6, samples=4, up=(0, -1, 0),
                         ellipse=(0.55, 1.0), cap_rings=2)
        mb.add(brow, "M_Hair", bone="head")

        # cheeks
        l3, n3 = surf.front(s * 0.158, 1.108)
        cheek = geom.blob((0.042, 0.010, 0.026), (0, 0, 0), cuts=3)
        mb.add(cheek, "M_Blush", bone="head",
               matrix=Matrix.Translation(l3 + n3 * 0.001) @ geom.orient_to(n3))

        # ears
        l4, n4 = surf.hit((s * 1.0, 0.015, 1.17), (-s, 0, 0))
        ear = geom.blob((0.034, 0.024, 0.046), (0, 0, 0), cuts=3)
        mb.add(ear, "M_Skin", bone="head",
               matrix=Matrix.Translation(l4 - n4 * 0.004) @ geom.orient_to(n4))

    # nose
    ln, nn = surf.front(0.0, 1.145)
    nose = geom.blob((0.030, 0.032, 0.025), (0, 0, 0), cuts=3)
    mb.add(nose, "M_Skin", bone="head", matrix=Matrix.Translation(ln + nn * 0.016) @
           geom.orient_to(nn))

    # mouth: a happy open smile (dark crescent)
    pts = []
    for mx, mz in ((-0.046, 1.083), (-0.024, 1.066), (0.0, 1.061), (0.024, 1.066),
                   (0.046, 1.083)):
        l5, n5 = surf.front(mx, mz)
        pts.append(l5 + n5 * 0.002)
    mouth = geom.tube(pts, [0.006, 0.012, 0.016, 0.012, 0.006], segments=8, samples=2,
                      up=(0, -1, 0), ellipse=(0.5, 1.0), cap_rings=2)
    mb.add(mouth, "M_EyeDark", bone="head")

    build_hair(mb, head_surf=surf)
    return eye_pts


def hair_limit(theta_deg):
    """Polar angle (deg from the crown) where the hair cap ends, per azimuth (0 = front)."""
    a = abs(theta_deg)
    base = 56 + 58 * smoothstep(35, 175, a)
    # side-swept fringe locks
    for c, h, w in ((-48, 15, 11), (-20, 11, 9), (10, 9, 9), (36, 6, 9)):
        base += h * math.exp(-((theta_deg - c) / w) ** 2)
    # nape locks at the back
    for c, h in ((150, 7), (172, 9), (-165, 8), (-140, 6)):
        base += h * math.exp(-((theta_deg - c) / 7) ** 2)
    # sideburns in front of the ears
    for c in (-74, 74):
        base += 12 * math.exp(-((theta_deg - c) / 7) ** 2)
    return base


def build_hair(mb, head_surf):
    seg, rows = 44, 7
    grid = []
    import bmesh
    bm = bmesh.new()
    top_dir = V((0, 0, 1))
    l, n = head_surf.radial(HEAD_C, top_dir)
    pole = bm.verts.new(l + n * 0.03)
    for i in range(seg):
        th = -180 + 360 * i / seg
        lim = hair_limit(th)
        col = []
        for r in range(1, rows + 1):
            ph = lim * r / rows
            d = V((math.sin(math.radians(ph)) * math.sin(math.radians(th)),
                   -math.sin(math.radians(ph)) * math.cos(math.radians(th)),
                   math.cos(math.radians(ph))))
            loc, nrm = head_surf.radial(HEAD_C, d)
            u = r / rows
            thick = 0.030 * (1 - u) ** 0.7 + 0.010
            col.append(bm.verts.new(loc + nrm * thick))
        # rolled-under edge (inside the head)
        loc, nrm = head_surf.radial(HEAD_C, d)
        col.append(bm.verts.new(loc - nrm * 0.006))
        grid.append(col)
    for i in range(seg):
        a, b = grid[i], grid[(i + 1) % seg]
        bm.faces.new((pole, b[0], a[0]))
        for r in range(len(a) - 1):
            bm.faces.new((a[r], b[r], b[r + 1], a[r + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    geom.set_smooth(bm)
    mb.add(bm, "M_Hair", bone="head")


def build_tuft(mb, top_z):
    strands = [
        ([(0.0, 0.03, top_z - 0.05), (0.004, 0.005, top_z + 0.03), (-0.02, -0.035, top_z + 0.085),
          (-0.055, -0.05, top_z + 0.075)], [0.042, 0.032, 0.018, 0.004]),
        ([(0.03, 0.05, top_z - 0.05), (0.05, 0.04, top_z + 0.02), (0.085, 0.02, top_z + 0.035)],
         [0.03, 0.02, 0.004]),
        ([(-0.02, 0.07, top_z - 0.06), (-0.04, 0.085, top_z + 0.0), (-0.075, 0.08, top_z + 0.0)],
         [0.026, 0.017, 0.004]),
    ]
    for pts, radii in strands:
        t = geom.tube(pts, radii, segments=8, samples=3, caps=("round", "point"), cap_rings=2)
        mb.add(t, "M_Hair", bone="hair")


# --------------------------------------------------------------------------- body

JACKET = [
    # (centre, rx, ry, exponent)
    ((0, 0.000, 0.415), 0.180, 0.150, 0.85),
    ((0, 0.000, 0.440), 0.184, 0.153, 0.85),
    ((0, 0.000, 0.468), 0.174, 0.145, 0.85),
    ((0, -0.004, 0.565), 0.152, 0.127, 0.85),
    ((0, -0.008, 0.690), 0.160, 0.134, 0.85),
    ((0, -0.006, 0.790), 0.170, 0.134, 0.85),
    ((0, 0.000, 0.860), 0.153, 0.118, 0.9),
    ((0, 0.000, 0.905), 0.105, 0.088, 1.0),
    ((0, 0.000, 0.930), 0.060, 0.055, 1.0),
]


def build_body(mb):
    torso = geom.loft(JACKET, segments=28, samples=2)
    for f in torso.faces:
        f.material_index = 1 if f.calc_center_median().z < 0.462 else 0
    tsurf = geom.Surface(torso)
    mb.add(torso, ["M_Jacket", "M_JacketTrim"], bone=torso_weights)

    # collar
    collar = geom.torus(0.104, 0.024, segments=24, ring_segments=6, center=(0, 0, 0.902),
                        major_y=0.090, minor_z=0.02)
    mb.add(collar, "M_JacketTrim", bone="chest")

    # zip down the front
    pts = []
    for z in [0.885, 0.82, 0.75, 0.68, 0.61, 0.54, 0.475]:
        l, n = tsurf.front(0.0, z)
        pts.append(l + n * 0.002)
    zipper = geom.tube(pts, [0.011] * len(pts), segments=8, samples=2, up=(0, -1, 0),
                       ellipse=(0.45, 1.0), caps=("flat", "flat"))
    mb.add(zipper, "M_JacketTrim", bone=torso_weights)
    l, n = tsurf.front(0.0, 0.835)
    pull = geom.bevel(geom.box((0.022, 0.010, 0.036)), 0.004, segments=2)
    mb.add(pull, "M_JacketTrim", bone="chest",
           matrix=Matrix.Translation(l + n * 0.012 + V((0, 0, -0.012))))

    # patch pockets
    for s in (1, -1):
        l, n = tsurf.front(s * 0.085, 0.545)
        pocket = geom.blob((0.042, 0.010, 0.036), (0, 0, 0), cuts=2, exponent=0.6)
        mb.add(pocket, "M_Jacket", bone="spine",
               matrix=Matrix.Translation(l + n * 0.001) @ geom.orient_to(n))
        flap = geom.blob((0.046, 0.010, 0.012), (0, 0, 0), cuts=2, exponent=0.6)
        mb.add(flap, "M_JacketTrim", bone="spine",
               matrix=Matrix.Translation(l + n * 0.004 + V((0, 0, 0.034))) @ geom.orient_to(n))

    # neck (hidden under the scarf, avoids gaps when the head turns)
    neck = geom.cylinder(0.052, 0.12, segments=12, center=(0, 0.005, 0.955))
    mb.add(neck, "M_Skin", bone="neck")

    # pelvis / trousers top
    pelvis = geom.blob((0.148, 0.122, 0.085), (0, 0.004, 0.462), cuts=3)
    mb.add(pelvis, "M_Pants", bone="hips")
    return tsurf


def build_arms(mb):
    for s in (1, -1):
        x = sfx(s)
        S, E, W = SHOULDER[s], ELBOW[s], WRIST[s]
        sleeve = geom.tube([S + V((-s * 0.012, 0, 0.005)), E, W + (W - E).normalized() * 0.006],
                           [0.064, 0.050, 0.055], segments=10, samples=3,
                           caps=("round", "round"), cap_rings=3)
        mb.add(sleeve, "M_Jacket", bone=chain_weights(S, E, W, "upper_arm" + x, "forearm" + x))
        # cuff ring
        axis = (W - E).normalized()
        cuff = geom.torus(0.050, 0.018, segments=14, ring_segments=6, minor_z=0.020)
        q = V((0, 0, 1)).rotation_difference(axis)
        mb.add(cuff, "M_JacketTrim", bone="forearm" + x,
               matrix=Matrix.Translation(W - axis * 0.004) @ q.to_matrix().to_4x4())
        # mitten
        hand_dir = (V((0.012 * s, 0, -0.11))).normalized()
        c = W + hand_dir * 0.080
        mitten = geom.blob((0.054, 0.070, 0.080), (0, 0, 0), cuts=4, exponent=0.92,
                           fn=lambda d: V((d.x * (1 - 0.15 * max(0, d.z)), d.y,
                                           d.z * (1 + 0.08 * max(0, -d.z)))))
        mb.add(mitten, "M_Scarf", bone="hand" + x,
               matrix=Matrix.Translation(c) @ Matrix.Rotation(math.radians(-s * 6), 4, "Y"))
        thumb = geom.blob((0.026, 0.028, 0.043), (0, 0, 0), cuts=2)
        mb.add(thumb, "M_Scarf", bone="hand" + x,
               matrix=Matrix.Translation(c + V((-s * 0.034, -0.046, 0.014))) @
               Matrix.Rotation(math.radians(s * 25), 4, "Y") @
               Matrix.Rotation(math.radians(-20), 4, "X"))


def build_legs(mb):
    for s in (1, -1):
        x = sfx(s)
        H, K, A = HIP[s], KNEE[s], ANKLE[s]
        leg = geom.tube([H + V((-s * 0.008, 0, -0.02)), K, A + V((0, 0, 0.02))],
                        [0.068, 0.060, 0.055], segments=10, samples=3, caps=("round", "round"))
        mb.add(leg, "M_Pants", bone=chain_weights(H, K, A, "thigh" + x, "shin" + x, 0.04))
        build_boot(mb, s)


def boot_shape(d):
    x, y, z = d.x, d.y, d.z
    if y < 0:                            # toe: wider and taller, slightly upturned
        k = smoothstep(0, -1, y)
        x *= 1 + 0.10 * k
        z *= 1 + 0.06 * k
        z += 0.10 * k * k
    else:                                # heel: narrower
        x *= 1 - 0.10 * smoothstep(0, 1, y)
    z = max(z, -0.62)
    return V((x, y, z))


def build_boot(mb, s):
    x = sfx(s)
    A = ANKLE[s]
    bone = "foot" + x
    body = geom.blob((0.090, 0.150, 0.088), (A.x, -0.045, 0.118), cuts=5, exponent=0.85,
                     fn=boot_shape)
    bsurf = geom.Surface(body)
    mb.add(body, "M_Boot", bone=bone)
    shaft = geom.lathe([(0.0, 0.11), (0.074, 0.11), (0.078, 0.18), (0.076, 0.245),
                        (0.07, 0.262), (0.0, 0.262)], segments=12, center=(A.x, 0.012, 0))
    mb.add(shaft, "M_Boot", bone=bone)
    cuff = geom.torus(0.074, 0.024, segments=14, ring_segments=6, center=(A.x, 0.012, 0.262),
                      minor_z=0.028)
    mb.add(cuff, "M_Sole", bone=bone)
    sole = geom.blob((0.097, 0.170, 0.036), (A.x, -0.048, 0.036), cuts=4, exponent=0.45,
                     fn=lambda d: V((d.x * (1 + 0.06 * max(0, -d.y)), d.y, d.z)))
    for v in sole.verts:
        v.co.z = max(v.co.z, 0.0)
    mb.add(sole, "M_Sole", bone=bone)
    # toe cap: a slightly raised rounded patch over the toe
    l, n = bsurf.hit((A.x, -0.17, 0.6), (0, 0, -1))
    toe = geom.blob((0.070, 0.050, 0.012), (0, 0, 0), cuts=3, exponent=0.7)
    mb.add(toe, "M_Sole", bone=bone, matrix=Matrix.Translation(l - n * 0.002) @
           geom.orient_to(n, up=(0, -1, 0)))


def build_pack(mb, tsurf):
    body = geom.blob((0.128, 0.078, 0.136), (0, 0.208, 0.722), cuts=4, exponent=0.6)
    mb.add(body, "M_Pack", bone="pack")
    flap = geom.blob((0.131, 0.082, 0.048), (0, 0.207, 0.835), cuts=4, exponent=0.5)
    mb.add(flap, "M_Pack", bone="pack")
    tongue = geom.blob((0.072, 0.012, 0.058), (0, 0.283, 0.80), cuts=3, exponent=0.5)
    mb.add(tongue, "M_Pack", bone="pack")
    buckle = geom.bevel(geom.box((0.034, 0.014, 0.026), (0, 0.296, 0.752)), 0.004, segments=2)
    mb.add(buckle, "M_JacketTrim", bone="pack", sharp=60)
    pocket = geom.blob((0.088, 0.034, 0.055), (0, 0.268, 0.652), cuts=3, exponent=0.6)
    mb.add(pocket, "M_Pack", bone="pack")
    for s in (1, -1):
        side = geom.blob((0.030, 0.050, 0.058), (s * 0.123, 0.205, 0.680), cuts=2,
                         exponent=0.7)
        mb.add(side, "M_Pack", bone="pack")

    # shoulder straps (follow the jacket surface)
    C = V((0, 0.0, 0.72))
    for s in (1, -1):
        raw = [(s * 0.075, 0.16, 0.86), (s * 0.098, 0.09, 0.915), (s * 0.110, -0.01, 0.93),
               (s * 0.108, -0.10, 0.875), (s * 0.104, -0.14, 0.78), (s * 0.112, -0.135, 0.68),
               (s * 0.135, -0.11, 0.60)]
        pts = []
        for p in raw:
            l, n = tsurf.radial(C, V(p) - C)
            pts.append(l + n * 0.010)
        strap = geom.tube(pts, [0.024] * len(pts), segments=6, samples=2, up=(0, 1, 0.3),
                          ellipse=(0.36, 1.0), caps=("round", "round"), cap_rings=2)
        mb.add(strap, "M_Sole", bone="chest")
    # chest strap with buckle
    pts = []
    for xx in (-0.105, -0.05, 0.0, 0.05, 0.105):
        l, n = tsurf.front(xx, 0.765)
        pts.append(l + n * 0.016)
    cs = geom.tube(pts, [0.013] * 5, segments=6, samples=2, up=(0, -1, 0), ellipse=(0.45, 1.0),
                   caps=("round", "round"), cap_rings=2)
    mb.add(cs, "M_Sole", bone="chest")
    l, n = tsurf.front(0.0, 0.765)
    bk = geom.bevel(geom.box((0.034, 0.012, 0.026)), 0.004, segments=2)
    mb.add(bk, "M_JacketTrim", bone="chest", matrix=Matrix.Translation(l + n * 0.024),
           sharp=60)


def build_scarf(mb):
    wrap = geom.torus(0.088, 0.040, segments=20, ring_segments=7, center=(0, 0.004, 0.940),
                      major_y=0.082, minor_z=0.034)
    geom.transform(wrap, Matrix.Translation((0, 0, 0.94)) @ Matrix.Rotation(
        math.radians(-7), 4, "X") @ Matrix.Translation((0, 0, -0.94)))
    geom.noise_displace(wrap, 0.006, 18.0, seed=3)
    mb.add(wrap, "M_Scarf", bone="neck")
    wrap2 = geom.torus(0.074, 0.032, segments=18, ring_segments=6, center=(0, 0.006, 0.985),
                       major_y=0.070, minor_z=0.028)
    geom.transform(wrap2, Matrix.Translation((0, 0, 0.985)) @ Matrix.Rotation(
        math.radians(6), 4, "Y") @ Matrix.Translation((0, 0, -0.985)))
    geom.noise_displace(wrap2, 0.005, 20.0, seed=4)
    mb.add(wrap2, "M_Scarf", bone="neck")
    knot = geom.blob((0.034, 0.030, 0.032), (0.05, 0.08, 0.95), cuts=2)
    mb.add(knot, "M_Scarf", bone="neck")

    def tail_w(co):
        w_neck = 1 - smoothstep(0.08, 0.15, co.y)
        w2 = smoothstep(0.22, 0.31, co.y) * (1 - w_neck)
        return {"neck": w_neck, "scarf.1": max(0.0, 1 - w_neck - w2), "scarf.2": w2}

    tails = [
        ([(0.035, 0.07, 0.955), (0.05, 0.18, 0.945), (0.062, 0.27, 0.90), (0.07, 0.31, 0.81),
          (0.075, 0.322, 0.715)], [0.034, 0.040, 0.042, 0.044, 0.046], [0, 10, 35, 55, 65]),
        ([(0.0, 0.07, 0.95), (0.0, 0.17, 0.935), (0.0, 0.26, 0.895), (-0.004, 0.30, 0.82),
          (-0.006, 0.31, 0.755)], [0.028, 0.034, 0.036, 0.038, 0.04], [0, -10, -30, -45, -50]),
    ]
    for pts, radii, twist in tails:
        t = geom.tube(pts, radii, segments=8, samples=3, up=(0, 0, 1), ellipse=(0.42, 1.0),
                      caps=("round", "flat"), cap_rings=2, twist=twist)
        mb.add(t, "M_Scarf", bone=tail_w)


# --------------------------------------------------------------------------- build

def build_model(col):
    mb = geom.MeshBuilder("Explorer")
    eye_pts = build_head(mb)
    tsurf = build_body(mb)
    build_arms(mb)
    build_legs(mb)
    build_pack(mb, tsurf)
    build_scarf(mb)
    # place the tuft so the top of the hair lands exactly on HEIGHT
    zmax = max(v.co.z for v in mb.bm.verts)
    tb = geom.MeshBuilder("tuft_probe")
    build_tuft(tb, 0.0)
    tuft_top = max(v.co.z for v in tb.bm.verts)
    tb.bm.free()
    build_tuft(mb, HEIGHT - tuft_top)
    ob = mb.to_object(col)
    return ob, eye_pts


# --------------------------------------------------------------------------- animation helpers
THIGH_LEN = HIP[1].z - KNEE[1].z
SHIN_LEN = KNEE[1].z - ANKLE[1].z
HIPS_PIVOT = V((0, 0, 0.50))
GROUND_ANKLE = ANKLE[1].z
SOLE_PTS = [V((0, 0.125, -0.20)), V((0, -0.215, -0.19))]   # heel / toe, relative to ankle


def ankle_lift(pitch_deg):
    """Extra ankle height so a pitched boot does not sink into the ground."""
    q = Quaternion((1, 0, 0), math.radians(pitch_deg))
    low = min((q @ p).z for p in SOLE_PTS)
    return max(0.0, -low - GROUND_ANKLE)


def clamp(x, a, b):
    return max(a, min(b, x))


class Pose(dict):
    """Per-frame pose under construction ({bone: BoneXf})."""

    def rot(self, bone, x=0.0, y=0.0, z=0.0):
        xf = self.setdefault(bone, BoneXf())
        xf.rot = (x, y, z)
        return self

    def loc(self, bone, x=0.0, y=0.0, z=0.0):
        self.setdefault(bone, BoneXf()).loc = (x, y, z)
        return self

    def scale(self, bone, sc):
        self.setdefault(bone, BoneXf()).scale = sc
        return self

    def hips(self, loc=(0, 0, 0), x=0.0, y=0.0, z=0.0, squash=1.0):
        q = euler_q(x, y, z)
        self["hips"] = BoneXf(rot=q, loc=loc)
        self._hq = q
        self._hl = V(loc)
        if squash != 1.0:
            self["hips"].scale = rig.squash(squash)
        return self

    def leg(self, s, ankle, pitch=0.0, planted=False):
        """Two-bone IK in the sagittal plane. ankle: (y, z) target; pitch: toe-down degrees."""
        x = sfx(s)
        hq = getattr(self, "_hq", Quaternion())
        hl = getattr(self, "_hl", V((0, 0, 0)))
        H = HIPS_PIVOT + hl + hq @ (HIP[s] - HIPS_PIVOT)
        ay, az = ankle
        if planted:
            az = max(az, GROUND_ANKLE + ankle_lift(pitch))
        a, b = THIGH_LEN, SHIN_LEN
        dyf = -(ay - H.y)
        dz = H.z - az
        d = clamp(math.hypot(dyf, dz), 0.03, a + b - 1e-4)
        base = math.atan2(dyf, dz)
        alpha = math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1))
        gamma = math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1))
        th = base + alpha
        sh = th - (math.pi - gamma)
        self["thigh" + x] = BoneXf(rot=hq.inverted() @ Quaternion((1, 0, 0), -th))
        self["shin" + x] = BoneXf(rot=Quaternion((1, 0, 0), th - sh))
        self["foot" + x] = BoneXf(rot=Quaternion((1, 0, 0), sh + math.radians(pitch)))
        return self

    def arm(self, s, fwd=0.0, out=0.0, bend=0.0, twist=0.0, hand=(0.0, 0.0, 0.0)):
        """fwd: swing forward (deg), out: raise sideways, bend: elbow flex forward."""
        x = sfx(s)
        self.rot("upper_arm" + x, -fwd, -s * out, s * twist)
        self.rot("forearm" + x, -bend, 0, 0)
        self.rot("hand" + x, hand[0], s * hand[1], s * hand[2])
        return self

    def eyes(self, openness):
        for s in (1, -1):
            self.scale("eye" + sfx(s), (1.0, max(0.08, openness), 1.0))
        return self


def lagged(fn, t, lag, loop=True):
    tt = t - lag
    if loop:
        tt %= 1.0
    else:
        tt = max(0.0, tt)
    return fn(tt)


def foot_cycle(u, stride, lift, stance, toe_off=25.0, heel=-12.0):
    """Ankle (y, z) and pitch for one leg at cycle phase u in [0, 1)."""
    u %= 1.0
    if u < stance:
        k = u / stance
        y = -stride + 2 * stride * k
        z = GROUND_ANKLE
        pitch = keys(k, [(0, heel), (0.18, 0), (0.7, 0), (1.0, toe_off)])
        return (y, z), pitch, True
    v = (u - stance) / (1 - stance)
    y = stride - 2 * stride * rig.ease_in_out(v)
    z = GROUND_ANKLE + lift * math.sin(math.pi * min(1.0, v * 1.08)) ** 0.9
    pitch = keys(v, [(0, toe_off), (0.35, toe_off * 0.6), (1.0, heel)])
    return (y, z), pitch, False


def secondary(p, hair=0.0, hair_y=0.0, scarf1=0.0, scarf2=0.0, scarf_z=0.0, pack=0.0,
              pack_z=0.0, pack_drop=0.0):
    p.rot("hair", hair, hair_y, 0)
    p.rot("scarf.1", max(-4.0, scarf1), 0, scarf_z)
    p.rot("scarf.2", max(-6.0, scarf2), 0, scarf_z * 0.6)
    p.rot("pack", max(0.0, pack), 0, pack_z)
    if pack_drop:
        p.loc("pack", 0, 0, pack_drop)


# --------------------------------------------------------------------------- animations

def anim_idle(t, f):
    p = Pose()
    br = math.sin(2 * math.pi * t)
    p.hips(loc=(0.004 * br, 0, -0.012 - 0.003 * (0.5 + 0.5 * br)), y=-1.0 * br)
    p.rot("spine", 1.5 * wave(t, 1, 0.1), 0, 0)
    b = 0.5 + 0.5 * wave(t, 1, 0.0)
    p.rot("chest", 1.0 * wave(t, 1, 0.15), 0, 0)
    p.scale("chest", (1 + 0.018 * b, 1 + 0.012 * b, 1 + 0.018 * b))
    p.rot("neck", 0, 0, 0)
    p.rot("head", 2.0 * wave(t, 2, 0.2), 4.5 * wave(t, 1, 0.15), 3.0 * wave(t, 1, 0.3))
    for s in (1, -1):
        p.arm(s, fwd=2 + 2 * wave(t, 1, 0.2 + 0.1 * s), out=3 + 1.5 * wave(t, 1, 0.1),
              bend=12 + 3 * wave(t, 1, 0.25), hand=(4 * wave(t, 1, 0.35), 0, 0))
        p.leg(s, (0.0, GROUND_ANKLE), 0.0, planted=True)
    blink = max(0.0, 1 - abs(f - 44) / 2.5)
    p.eyes(1 - 0.92 * blink)
    secondary(p, hair=4 * wave(t, 1, 0.3), hair_y=3 * wave(t, 1, 0.35),
              scarf1=3 + 3 * wave(t, 1, 0.3), scarf2=3 + 5 * wave(t, 1, 0.45),
              pack=2.5 + 2 * wave(t, 1, 0.25), pack_drop=-0.003 * br)
    return p


def anim_walk(t, f):
    p = Pose()
    c1 = math.cos(2 * math.pi * t)
    bob = 0.5 + 0.5 * math.cos(4 * math.pi * t)        # 1 at contacts
    p.hips(loc=(0.010 * math.sin(2 * math.pi * t), 0, -0.016 - 0.014 * bob),
           y=-3 * math.sin(2 * math.pi * t), z=-6 * c1)
    p.rot("spine", 4 + 1.5 * math.cos(4 * math.pi * (t - 0.08)), 0, 3 * c1)
    p.rot("chest", 1, 0, 4 * c1)
    p.rot("neck", 0, 0, 0)
    p.rot("head", -3 + 2 * math.cos(4 * math.pi * (t - 0.12)), 2 * math.sin(2 * math.pi * (t - 0.1)),
          -1.5 * c1)
    for s, ph in ((1, 0.0), (-1, 0.5)):
        (ay, az), pitch, planted = foot_cycle(t + ph, 0.085, 0.065, 0.6)
        p.leg(s, (ay, az), pitch, planted=planted)
        sw = -s * 24 * math.cos(2 * math.pi * (t - 0.04))      # arm opposite to leg
        sw_lag = -s * 24 * math.cos(2 * math.pi * (t - 0.12))
        p.arm(s, fwd=sw, out=5 + 1.5 * bob, bend=20 + 0.45 * max(0.0, sw_lag),
              hand=(-6 * math.cos(2 * math.pi * (t - 0.2)) * s, 0, 0))
    p.eyes(1.0)
    secondary(p, hair=5 * math.cos(4 * math.pi * (t - 0.18)),
              hair_y=3 * math.sin(2 * math.pi * (t - 0.15)),
              scarf1=8 + 4 * math.cos(4 * math.pi * (t - 0.15)),
              scarf2=6 + 6 * math.cos(4 * math.pi * (t - 0.28)),
              scarf_z=5 * math.sin(2 * math.pi * (t - 0.15)),
              pack=3.5 + 3 * math.cos(4 * math.pi * (t - 0.12)),
              pack_z=-2.5 * math.cos(2 * math.pi * (t - 0.1)))
    return p


def anim_run(t, f):
    p = Pose()
    c1 = math.cos(2 * math.pi * t)
    comp = math.cos(4 * math.pi * (t - 0.19))              # 1 at mid-stance compression
    p.hips(loc=(0.008 * math.sin(2 * math.pi * t), 0.0, -0.040 - 0.022 * comp),
           x=4, y=-3 * math.sin(2 * math.pi * t), z=-11 * c1)
    p.rot("spine", 11 + 2 * comp, 0, 6 * c1)
    p.scale("spine", rig.squash(1 - 0.045 * comp))
    p.rot("chest", 5, 0, 8 * c1)
    p.rot("neck", -4, 0, 0)
    p.rot("head", -12 + 3 * math.cos(4 * math.pi * (t - 0.28)), 0, -4 * c1)
    for s, ph in ((1, 0.0), (-1, 0.5)):
        (ay, az), pitch, planted = foot_cycle(t + ph, 0.13, 0.15, 0.38, toe_off=35, heel=-8)
        p.leg(s, (ay - 0.01, az), pitch, planted=planted)
        sw = -s * 52 * math.cos(2 * math.pi * (t - 0.03))
        sw_lag = -s * math.cos(2 * math.pi * (t - 0.11))
        p.arm(s, fwd=sw + 8, out=12, bend=78 + 14 * sw_lag, twist=-8,
              hand=(-10 * s * math.cos(2 * math.pi * (t - 0.18)), 0, 0))
    p.eyes(1.0)
    secondary(p, hair=-10 + 6 * math.cos(4 * math.pi * (t - 0.3)),
              hair_y=4 * math.sin(2 * math.pi * (t - 0.2)),
              scarf1=26 + 7 * math.cos(4 * math.pi * (t - 0.25)),
              scarf2=14 + 12 * math.cos(4 * math.pi * (t - 0.4)),
              scarf_z=8 * math.sin(2 * math.pi * (t - 0.25)),
              pack=7 + 5 * math.cos(4 * math.pi * (t - 0.3)),
              pack_z=-4 * math.cos(2 * math.pi * (t - 0.15)))
    return p


def anim_jump(t, f):
    p = Pose()
    hz = keys(t, [(0, -0.012), (0.3, -0.085), (0.55, 0.02), (1.0, 0.045)])
    lean = keys(t, [(0, 2), (0.3, 18), (0.55, -5), (1.0, -3)])
    sq = keys(t, [(0, 1.0), (0.3, 0.88), (0.55, 1.13), (0.8, 1.04), (1.0, 1.06)])
    p.hips(loc=(0, keys(t, [(0, 0), (0.3, 0.02), (0.6, 0), (1, 0)]), hz),
           x=keys(t, [(0, 0), (0.3, 8), (0.6, -2), (1, 0)]))
    p.rot("spine", lean, 0, 0)
    p.scale("spine", rig.squash(sq))
    p.rot("chest", lean * 0.4, 0, 0)
    p.rot("head", keys(t, [(0, 0), (0.3, 8), (0.55, -14), (1.0, -8)]), 0, 0)
    for s in (1, -1):
        tuck = 0.07 if s > 0 else 0.015
        az = keys(t, [(0, GROUND_ANKLE), (0.5, GROUND_ANKLE), (1.0, GROUND_ANKLE + 0.04 + tuck)])
        ay = keys(t, [(0, 0), (0.5, 0.0), (1.0, -0.03 if s > 0 else 0.05)])
        pitch = keys(t, [(0, 0), (0.3, 0), (0.55, 30), (1.0, 32)])
        p.leg(s, (ay, az), pitch, planted=t < 0.5)
        p.arm(s, fwd=keys(t, [(0, 4), (0.3, -42), (0.55, 160), (1.0, 172)]),
              out=keys(t, [(0, 3), (0.3, 8), (0.55, 30), (1.0, 36)]),
              bend=keys(t, [(0, 12), (0.3, 25), (0.55, 18), (1.0, 8)]),
              hand=(keys(t, [(0, 0), (0.3, 20), (0.6, -15), (1, -5)]), 0, 0))
    p.eyes(keys(t, [(0, 1), (0.3, 0.75), (0.55, 1.1), (1, 1.05)]))
    secondary(p, hair=keys(t, [(0, 0), (0.3, -8), (0.6, 22), (1.0, 12)]),
              scarf1=keys(t, [(0, 4), (0.3, 14), (0.6, -3), (1.0, 6)]),
              scarf2=keys(t, [(0, 4), (0.3, 16), (0.6, -5), (1.0, 4)]),
              pack=keys(t, [(0, 2), (0.3, 0), (0.6, 12), (1.0, 7)]),
              pack_drop=keys(t, [(0, 0), (0.6, -0.01), (1, -0.006)]))
    return p


def anim_fall(t, f):
    p = Pose()
    w1 = math.sin(2 * math.pi * t)
    p.hips(loc=(0, 0.01, 0.03 + 0.006 * math.sin(4 * math.pi * t)), x=-4)
    p.rot("spine", -6 + 2 * math.sin(2 * math.pi * (t - 0.1)), 0, 3 * w1)
    p.rot("chest", -4, 0, 0)
    p.rot("head", 8 + 3 * math.sin(2 * math.pi * (t - 0.2)), 3 * math.sin(2 * math.pi * (t - 0.3)), 0)
    for s, ph in ((1, 0.0), (-1, 0.5)):
        u = 2 * math.pi * (t + ph)
        p.leg(s, (-0.02 + 0.035 * math.sin(u), GROUND_ANKLE + 0.06 + 0.03 * math.cos(u)),
              24 + 8 * math.sin(u - 0.8))
        p.arm(s, fwd=12 + 18 * math.sin(u + 1.6), out=72 + 10 * math.sin(u),
              bend=28 + 12 * math.sin(u + 0.9), hand=(10 * math.sin(u + 0.4), 0, 0))
    p.eyes(1.1)
    secondary(p, hair=-24 + 8 * math.sin(4 * math.pi * t),
              hair_y=6 * math.sin(2 * math.pi * (t - 0.2)),
              scarf1=42 + 8 * math.sin(4 * math.pi * t),
              scarf2=30 + 15 * math.sin(4 * math.pi * (t - 0.15)),
              scarf_z=6 * math.sin(2 * math.pi * t),
              pack=9 + 3 * math.sin(4 * math.pi * (t - 0.2)), pack_drop=0.008)
    return p


def anim_land(t, f):
    p = Pose()
    base = anim_idle(0.0, 0)
    hz = keys(t, [(0, 0.03), (0.25, -0.105), (0.62, -0.004), (1.0, -0.0135)])
    sq = keys(t, [(0, 1.04), (0.25, 0.84), (0.62, 1.04), (1.0, 1.0)])
    lean = keys(t, [(0, -6), (0.25, 22), (0.62, -2), (1.0, 1.5 * wave(0, 1, 0.1))])
    p.hips(loc=(0, keys(t, [(0, 0.01), (0.25, 0.015), (1, 0)]), hz),
           x=keys(t, [(0, -4), (0.25, 6), (1, 0)]))
    p.rot("spine", lean, 0, 0)
    p.scale("spine", rig.squash(sq))
    p.rot("chest", keys(t, [(0, -4), (0.25, 8), (0.62, 0), (1, base["chest"].rot[0])]), 0, 0)
    p.scale("chest", base["chest"].scale)
    p.rot("head", keys(t, [(0, 8), (0.25, 14), (0.62, -5), (1.0, base["head"].rot[0])]),
          keys(t, [(0, 0), (1, base["head"].rot[1])]), keys(t, [(0, 0), (1, base["head"].rot[2])]))
    for s in (1, -1):
        az = keys(t, [(0, GROUND_ANKLE + 0.04), (0.15, GROUND_ANKLE), (1, GROUND_ANKLE)])
        pitch = keys(t, [(0, 20), (0.15, 0), (1, 0)])
        p.leg(s, (0.0, az), pitch, planted=t >= 0.15)
        ua = base["upper_arm" + sfx(s)].rot
        p.arm(s, fwd=keys(t, [(0, 12), (0.25, 28), (0.62, -4), (1.0, -ua[0])]),
              out=keys(t, [(0, 50), (0.25, 24), (0.62, 6), (1.0, -s * ua[1])]),
              bend=keys(t, [(0, 28), (0.25, 38), (0.62, 10), (1.0, -base["forearm" + sfx(s)].rot[0])]))
    p.eyes(keys(t, [(0, 1.05), (0.25, 0.55), (0.62, 1.05), (1, 1)]))
    secondary(p, hair=keys(t, [(0, -20), (0.3, 26), (0.65, -8), (1.0, base["hair"].rot[0])]),
              hair_y=keys(t, [(0, 0), (1, base["hair"].rot[1])]),
              scarf1=keys(t, [(0, 38), (0.3, -4), (0.65, 10), (1.0, base["scarf.1"].rot[0])]),
              scarf2=keys(t, [(0, 28), (0.35, -6), (0.7, 9), (1.0, base["scarf.2"].rot[0])]),
              pack=keys(t, [(0, 9), (0.3, 1), (0.6, 8), (1.0, base["pack"].rot[0])]),
              pack_drop=keys(t, [(0, 0.008), (0.3, -0.012), (0.7, 0.002), (1.0, 0.0)]))
    return p


CELEB_HZ = [(0, -0.012), (0.12, -0.075), (0.2, 0.08), (0.3, 0.19), (0.42, 0.07), (0.5, -0.075),
            (0.62, -0.008), (0.8, -0.025), (1.0, -0.012)]


def celeb_hz(t):
    return keys(t % 1.0, CELEB_HZ)


def anim_celebrate(t, f):
    p = Pose()
    hz = celeb_hz(t)
    p.hips(loc=(0, 0, hz), z=keys(t, [(0, 0), (0.3, -6), (0.7, 6), (1, 0)]))
    p.rot("spine", keys(t, [(0, 0), (0.12, 15), (0.3, -10), (0.5, 12), (0.62, -3), (1, 0)]), 0,
          keys(t, [(0, 0), (0.3, 6), (0.7, -6), (1, 0)]))
    p.scale("spine", rig.squash(keys(t, [(0, 1), (0.12, 0.9), (0.25, 1.1), (0.45, 1.02),
                                         (0.52, 0.88), (0.62, 1.03), (0.75, 1), (1, 1)])))
    sway = math.sin(2 * math.pi * (t - 0.55)) * smoothstep(0.5, 0.65, t) * (1 - smoothstep(0.9, 1.0, t))
    p.rot("head", keys(t, [(0, 0), (0.12, 10), (0.3, -15), (0.55, 8), (0.72, -8), (1, 0)]),
          8 * sway, 0)
    air = max(0.0, hz)
    for s in (1, -1):
        tuck = 0.05 * math.sin(math.pi * clamp((t - 0.18) / 0.27, 0, 1))
        p.leg(s, (0.01 * s, GROUND_ANKLE + air + tuck + (0.02 if s > 0 else 0) * (tuck > 0.001)),
              keys(t, [(0, 0), (0.16, 0), (0.28, 22), (0.44, 5), (0.48, 0), (1, 0)]),
              planted=(t < 0.18 or t > 0.46))
    # right arm: two fist pumps
    p.arm(-1, fwd=keys(t, [(0, 4), (0.12, -25), (0.3, 165), (0.45, 150), (0.58, 75), (0.72, 165),
                           (0.86, 80), (1.0, 4)]),
          out=keys(t, [(0, 3), (0.3, 15), (0.72, 15), (1, 3)]),
          bend=keys(t, [(0, 12), (0.12, 20), (0.3, 25), (0.45, 60), (0.58, 120), (0.72, 20),
                        (0.86, 110), (1.0, 12)]),
          hand=(keys(t, [(0, 0), (0.3, -20), (0.58, 10), (0.72, -20), (1, 0)]), 0, 0))
    # left arm: thrown out wide with joy
    p.arm(1, fwd=keys(t, [(0, 4), (0.12, -30), (0.3, 40), (0.5, 20), (1, 4)]),
          out=keys(t, [(0, 3), (0.3, 62), (0.55, 35), (0.75, 48), (1, 3)]),
          bend=keys(t, [(0, 12), (0.3, 32), (0.75, 40), (1, 12)]))
    p.eyes(keys(t, [(0, 1), (0.12, 0.8), (0.3, 1.1), (0.55, 0.7), (0.7, 1.0), (1, 1)]))

    def lagz(lag):
        return (celeb_hz(t - lag) - hz) * 160.0
    secondary(p, hair=4 + lagz(0.06), hair_y=4 * sway,
              scarf1=8 - lagz(0.05) * 0.8, scarf2=8 - lagz(0.09),
              scarf_z=5 * sway, pack=4 + 0.6 * abs(lagz(0.07)), pack_drop=0.0)
    return p


def anim_hurt(t, f):
    p = Pose()
    p.hips(loc=(0, keys(t, [(0, 0), (0.17, 0.05), (0.5, 0.03), (1, 0.012)]),
                keys(t, [(0, -0.012), (0.17, -0.03), (0.5, -0.02), (1, -0.015)])),
           x=keys(t, [(0, 0), (0.17, -6), (1, -2)]))
    p.rot("spine", keys(t, [(0, 0), (0.17, -18), (0.45, -9), (1, -4)]), 0,
          keys(t, [(0, 0), (0.17, 6), (1, 2)]))
    p.scale("spine", rig.squash(keys(t, [(0, 1), (0.12, 0.93), (0.4, 1.03), (1, 1)])))
    p.rot("chest", keys(t, [(0, 0), (0.17, -10), (0.5, -4), (1, -2)]), 0, 0)
    p.rot("head", keys(t, [(0, 0), (0.15, -20), (0.42, 9), (0.7, 2), (1, 0)]),
          keys(t, [(0, 0), (0.17, 8), (1, 3)]), keys(t, [(0, 0), (0.17, -6), (1, -2)]))
    for s in (1, -1):
        if s < 0:
            ay = keys(t, [(0, 0), (0.17, -0.07), (0.6, -0.05), (1, 0)])
            az = keys(t, [(0, GROUND_ANKLE), (0.17, GROUND_ANKLE + 0.08), (0.6, GROUND_ANKLE + 0.03),
                          (1, GROUND_ANKLE)])
            p.leg(s, (ay, az), keys(t, [(0, 0), (0.17, -10), (1, 0)]), planted=t > 0.9)
        else:
            p.leg(s, (0.0, GROUND_ANKLE), 0.0, planted=True)
        p.arm(s, fwd=keys(t, [(0, 4), (0.17, 62), (0.5, 35), (1, 14)]),
              out=keys(t, [(0, 3), (0.17, 38), (0.5, 22), (1, 10)]),
              bend=keys(t, [(0, 12), (0.17, 35), (0.5, 50), (1, 20)]),
              hand=(keys(t, [(0, 0), (0.17, -25), (0.6, 10), (1, 0)]), 0, 0))
    p.eyes(keys(t, [(0, 1), (0.1, 0.12), (0.6, 0.18), (1, 0.85)]))
    secondary(p, hair=keys(t, [(0, 0), (0.17, 18), (0.42, -12), (0.7, 6), (1, 0)]),
              scarf1=keys(t, [(0, 4), (0.2, 22), (0.5, 0), (1, 5)]),
              scarf2=keys(t, [(0, 4), (0.25, 26), (0.55, -2), (1, 5)]),
              pack=keys(t, [(0, 2), (0.2, 0), (0.35, 13), (0.7, 3), (1, 2)]))
    return p


ANIMATIONS = [
    # name, frames, loop, pose function
    ("idle", 60, True, anim_idle),
    ("walk", 24, True, anim_walk),
    ("run", 16, True, anim_run),
    ("jump", 10, False, anim_jump),
    ("fall", 20, True, anim_fall),
    ("land", 8, False, anim_land),
    ("celebrate", 40, True, anim_celebrate),
    ("hurt", 12, False, anim_hurt),
]


# --------------------------------------------------------------------------- entry point

def build(out_dir, save=True):
    common.reset_scene()
    col = common.new_collection("explorer")
    ob, eye_pts = build_model(col)
    arm = rig.build_armature("Armature", bone_list(eye_pts), col)
    rig.bind(ob, arm)
    for name, frames, loop, fn in ANIMATIONS:
        rig.make_action(arm, name, frames, fn, loop=loop)
    path = os.path.join(out_dir, "explorer.glb")
    export.export_glb([arm, ob], path, animations=True)
    if save:
        common.save_blend("character")
    return [path]


def main():
    args = common.parse_args("Generate explorer.glb")
    for p in build(args.out, save=not args.no_blend):
        print("wrote", p)


if __name__ == "__main__":
    main()
