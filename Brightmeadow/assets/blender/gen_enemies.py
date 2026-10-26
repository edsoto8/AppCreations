"""Enemies: Bramblebug (ground patroller) and Buzzpuff (flyer).

Both face Blender -Y. Bramblebug's origin is bottom-centre; Buzzpuff's origin is the centre of
its body (it floats). Rigidly skinned to small armatures; actions exported as glTF animations.

Run:  python gen_enemies.py   |   blender -b --python gen_enemies.py --
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
import rig  # noqa: E402
from geom import V, smoothstep  # noqa: E402
from rig import BoneXf, keys  # noqa: E402

TAU = 2 * math.pi


def sfx(s):
    return ".L" if s > 0 else ".R"


def add_eye(mb, surf, x, z, bone, white_r=(0.085, 0.04, 0.095), iris=None, look=(0, 0),
            sink=0.018, toward=(0, -0.5, 0)):
    loc, n = surf.front(x, z)
    n = (n + V(toward)).normalized()
    M = Matrix.Translation(loc) @ geom.orient_to(n)
    rx, ry, rz = white_r
    mb.add(geom.blob(white_r, cuts=4), "M_EyeWhite", bone=bone,
           matrix=M @ Matrix.Translation((0, sink, 0)))
    front = sink - ry
    if iris:
        mb.add(geom.blob((rx * 0.62, 0.012, rz * 0.62), cuts=2), iris, bone=bone,
               matrix=M @ Matrix.Translation((look[0], front + 0.006, look[1])))
    mb.add(geom.blob((rx * 0.40, 0.012, rz * 0.44), cuts=2), "M_EyeDark", bone=bone,
           matrix=M @ Matrix.Translation((look[0], front + 0.002, look[1])))
    mb.add(geom.blob((rx * 0.17, 0.007, rz * 0.17), cuts=1), "M_EyeWhite", bone=bone,
           matrix=M @ Matrix.Translation((look[0] + rx * 0.2, front - 0.006, look[1] + rz * 0.22)))
    return loc, n


# =========================================================================== Bramblebug

BUG_LEGS = [(-0.20, 0), (0.02, 1), (0.23, 2)]     # (y, index)
BUG_HIP_Z = 0.20


def bug_shell_shape(d):
    x, y, z = d.x, d.y, d.z
    if y > 0:                         # rounder, fuller rear
        z *= 1 + 0.06 * y
    z = max(z, -0.55)                 # flat underside
    return V((x, y, z))


def build_bramblebug(col):
    mb = geom.MeshBuilder("Bramblebug")
    shell = geom.blob((0.335, 0.40, 0.30), (0, 0.06, 0.365), cuts=7, fn=bug_shell_shape)
    ssurf = geom.Surface(shell)
    mb.add(shell, "M_Bug", bone="body")
    # wing-case seam down the back
    pts = []
    for yy in (-0.24, -0.12, 0.0, 0.14, 0.28, 0.40):
        l, n = ssurf.hit((0, yy, 2.0), (0, 0, -1))
        pts.append(l + n * 0.002)
    seam = geom.tube(pts, [0.016] * len(pts), segments=6, samples=2, up=(0, 0, 1),
                     ellipse=(0.5, 1.0), caps=("round", "round"), cap_rings=2)
    mb.add(seam, "M_EyeDark", bone="body")
    # spots
    for sx, yy, r in ((0.17, -0.10, 0.075), (0.21, 0.17, 0.06), (0.09, 0.33, 0.05),
                      (0.25, 0.0, 0.04)):
        for s in (1, -1):
            l, n = ssurf.radial(V((0, 0.06, 0.30)), V((s * sx, yy, 0.62)) - V((0, 0.06, 0.30)))
            spot = geom.blob((r, 0.012, r * 0.9), cuts=1)
            mb.add(spot, "M_BugSpot", bone="body",
                   matrix=Matrix.Translation(l - n * 0.002) @ geom.orient_to(n))
    # belly
    belly = geom.blob((0.29, 0.36, 0.09), (0, 0.06, 0.20), cuts=3)
    mb.add(belly, "M_BugSpot", bone="body")
    # head (lavender face)
    head = geom.blob((0.235, 0.175, 0.205), (0, -0.30, 0.31), cuts=6,
                     fn=lambda d: V((d.x * (1 + 0.06 * max(0, -d.z)), d.y, d.z)))
    hsurf = geom.Surface(head)
    mb.add(head, "M_BugSpot", bone="head")
    for s in (1, -1):
        add_eye(mb, hsurf, s * 0.095, 0.36, "head", white_r=(0.075, 0.035, 0.085),
                iris="M_FlowerYellow", look=(-s * 0.006, -0.008), sink=0.016)
        # grumpy brow: thick bar slanting down toward the middle
        bpts = []
        for bx, bz in ((0.035, 0.425), (0.10, 0.450), (0.155, 0.440)):
            l, n = hsurf.front(s * bx, bz)
            bpts.append(l + n * 0.02)
        brow = geom.tube(bpts, [0.024, 0.026, 0.018], segments=8, samples=3, up=(0, -1, 0),
                         ellipse=(0.75, 1.0), caps=("round", "round"), cap_rings=2)
        mb.add(brow, "M_Bug", bone="head")
    # frown
    fpts = []
    for mx, mz in ((-0.045, 0.235), (0.0, 0.252), (0.045, 0.235)):
        l, n = hsurf.front(mx, mz)
        fpts.append(l + n * 0.003)
    frown = geom.tube(fpts, [0.007, 0.010, 0.007], segments=6, samples=3, up=(0, -1, 0),
                      ellipse=(0.5, 1.0), cap_rings=1)
    mb.add(frown, "M_EyeDark", bone="head")
    # sprout
    l, n = ssurf.hit((0, 0.02, 2.0), (0, 0, -1))
    base = l
    stem = geom.tube([base - V((0, 0, 0.02)), base + V((0, -0.01, 0.04)),
                      base + V((0.0, 0.025, 0.075))], [0.018, 0.015, 0.012], segments=6,
                     samples=3, caps=("round", "round"), cap_rings=1)
    mb.add(stem, "M_GrassDark", bone="sprout")
    tip = base + V((0.0, 0.025, 0.075))
    for s, ang in ((1, 35), (-1, -30)):
        leaf = geom.blob((0.075, 0.035, 0.014), cuts=2,
                         fn=lambda d: V((d.x, d.y * (1 - 0.6 * max(0, d.x) ** 2), d.z)))
        geom.transform(leaf, Matrix.Translation((0.07, 0, 0)))
        mb.add(leaf, "M_Leaf", bone="sprout",
               matrix=Matrix.Translation(tip) @ Matrix.Rotation(math.radians(ang), 4, "Z") @
               Matrix.Rotation(math.radians(-s * 35), 4, "Y") @
               (Matrix.Diagonal(V((s, 1, 1, 1)))))
    # legs
    for yy, i in BUG_LEGS:
        for s in (1, -1):
            hip = V((s * 0.19, yy, BUG_HIP_Z + 0.02))
            knee = V((s * 0.265, yy - 0.01, 0.125))
            foot = V((s * 0.285, yy - 0.02, 0.05))
            leg = geom.tube([hip, knee, foot], [0.05, 0.047, 0.044], segments=7, samples=2,
                            caps=("round", "round"), cap_rings=2)
            bone = f"leg{sfx(s)}.{i}"
            mb.add(leg, "M_EyeDark", bone=bone)
            shoe = geom.blob((0.058, 0.07, 0.042), (s * 0.29, yy - 0.035, 0.038), cuts=3)
            for v in shoe.verts:
                v.co.z = max(v.co.z, 0.0)
            mb.add(shoe, "M_EyeDark", bone=bone)
    ob = mb.to_object(col)
    ob.name = "Bramblebug"

    bones = [("root", (0, 0, 0), (0, 0, 0.1), None),
             ("body", (0, 0.05, 0.22), (0, 0.05, 0.5), "root"),
             ("head", (0, -0.20, 0.30), (0, -0.42, 0.30), "body"),
             ("sprout", tuple(base), tuple(base + V((0, 0, 0.12))), "body")]
    for yy, i in BUG_LEGS:
        for s in (1, -1):
            bones.append((f"leg{sfx(s)}.{i}", (s * 0.19, yy, BUG_HIP_Z),
                          (s * 0.29, yy - 0.02, 0.04), "root"))
    arm = rig.build_armature("Armature", bones, col)
    rig.bind(ob, arm)

    def walk(t, f):
        p = {}
        bob = math.cos(2 * TAU * t)
        p["body"] = BoneXf(rot=(2 * math.sin(2 * TAU * (t - 0.05)), 4 * math.sin(TAU * t), 0),
                           loc=(0, 0, 0.022 * (0.5 + 0.5 * bob)),
                           scale=rig.squash(1 + 0.035 * bob))
        p["head"] = BoneXf(rot=(-4 * math.cos(2 * TAU * (t - 0.12)), -3 * math.sin(TAU * t),
                                5 * math.sin(TAU * (t - 0.1))))
        p["sprout"] = BoneXf(rot=(14 * math.cos(2 * TAU * (t - 0.25)),
                                  10 * math.sin(TAU * (t - 0.25)), 0))
        for yy, i in BUG_LEGS:
            for s in (1, -1):
                ph = ((i + (0 if s > 0 else 1)) % 2) * 0.5
                u = TAU * (2 * t + ph)          # two steps per loop (16 frames)
                swing = 28 * math.cos(u)        # + = foot back
                lift = max(0.0, math.sin(u)) * 26
                p[f"leg{sfx(s)}.{i}"] = BoneXf(rot=(swing, -s * lift, 0))
        return p

    def idle(t, f):
        p = {}
        br = math.sin(TAU * t)
        p["body"] = BoneXf(rot=(1.5 * br, 0, 0), loc=(0, 0, 0.006 * br),
                           scale=(1 + 0.025 * br, 1 - 0.02 * br, 1 + 0.025 * br))
        p["head"] = BoneXf(rot=(3 * math.sin(TAU * (t - 0.1)), 0, 10 * math.sin(TAU * t)))
        p["sprout"] = BoneXf(rot=(8 * math.sin(TAU * (t - 0.3)), 6 * math.sin(2 * TAU * t), 0))
        for yy, i in BUG_LEGS:
            for s in (1, -1):
                tap = 6 * max(0.0, math.sin(TAU * (2 * t + 0.3 * i))) if (i == 0) else 0.0
                p[f"leg{sfx(s)}.{i}"] = BoneXf(rot=(-tap, 0, 0))
        return p

    rig.make_action(arm, "walk", 16, walk, loop=True)
    rig.make_action(arm, "idle", 40, idle, loop=True)
    return [arm, ob]


# =========================================================================== Buzzpuff

def build_buzzpuff(col):
    from mathutils import noise
    mb = geom.MeshBuilder("Buzzpuff")
    R = 0.34

    def puff(d):
        # fluffy lobes: a soft bumpy sphere
        n1 = noise.noise(d * 3.2 + V((3.1, 7.7, 1.3)))
        lobes = 0.5 + 0.5 * math.cos(9 * math.atan2(d.y, d.x)) * math.sqrt(max(0, 1 - d.z * d.z))
        r = 1 + 0.055 * n1 + 0.03 * lobes
        dd = V((d.x, d.y * 0.95, d.z * 0.96))
        return dd * r
    body = geom.blob((R, R, R), cuts=8, fn=puff)
    bsurf = geom.Surface(body)
    mb.add(body, "M_Puff", bone="body")
    # top tuft
    for i, (ox, oy, h, lean) in enumerate(((0, 0.0, 0.16, -0.05), (0.06, 0.04, 0.11, 0.06),
                                           (-0.06, 0.03, 0.10, -0.08))):
        l, n = bsurf.hit((ox, oy, 2), (0, 0, -1))
        t = geom.tube([l - V((0, 0, 0.03)), l + V((lean * 0.5, -0.02, h * 0.6)),
                       l + V((lean, 0.02, h))], [0.05, 0.035, 0.008], segments=8, samples=3,
                      caps=("round", "point"), cap_rings=2)
        mb.add(t, "M_Puff", bone="body")
    for s in (1, -1):
        add_eye(mb, bsurf, s * 0.115, 0.045, "body", white_r=(0.085, 0.04, 0.10),
                look=(-s * 0.008, -0.006), sink=0.02, toward=(0, -0.3, 0))
        l, n = bsurf.front(s * 0.19, -0.07)
        mb.add(geom.blob((0.045, 0.01, 0.028), cuts=3), "M_Blush", bone="body",
               matrix=Matrix.Translation(l + n * 0.002) @ geom.orient_to(n))
        # antenna
        l, n = bsurf.hit((s * 0.09, -0.12, 2), (0, 0, -1))
        a_pts = [l - V((0, 0, 0.02)), l + V((s * 0.03, -0.03, 0.10)),
                 l + V((s * 0.08, -0.07, 0.17))]
        ant = geom.tube(a_pts, [0.012, 0.01, 0.009], segments=6, samples=3,
                        caps=("round", "round"), cap_rings=1)
        mb.add(ant, "M_EyeDark", bone="antenna" + sfx(s))
        mb.add(geom.blob((0.032, 0.032, 0.032), a_pts[-1], cuts=3), "M_FlowerYellow",
               bone="antenna" + sfx(s))
        # dangling feet
        l, n = bsurf.hit((s * 0.09, 0.0, -2), (0, 0, 1))
        foot = geom.blob((0.045, 0.055, 0.04), l + V((0, -0.01, -0.025)), cuts=3)
        mb.add(foot, "M_Puff", bone="body")
        # wings: big upper + small lower, pale with white rims
        for big, (wl, ww, ang) in ((True, (0.36, 0.19, 28)), (False, (0.22, 0.12, -8))):
            wing = geom.blob((wl / 2, 0.012, ww / 2), (wl / 2, 0, 0), cuts=4,
                             fn=lambda d: V((d.x, d.y, d.z * (1 - 0.35 * max(0, -d.x)))))
            rim = geom.torus(1.0, 0.07, segments=20, ring_segments=4)
            geom.transform(rim, Matrix.Translation((wl / 2, 0, 0)) @ Matrix.Rotation(
                math.radians(90), 4, "X") @ Matrix.Diagonal(V((wl / 2, ww / 2, 0.15, 1))))
            root = V((s * 0.16, 0.16, 0.16 if big else 0.06))
            M = (Matrix.Translation(root) @ Matrix.Rotation(math.radians(-s * 25), 4, "Z") @
                 Matrix.Diagonal(V((s, 1, 1, 1))) @ Matrix.Rotation(math.radians(-ang), 4, "Y"))
            mb.add(wing, "M_Wing", bone="wing" + sfx(s), matrix=M.copy())
            mb.add(rim, "M_FlowerWhite", bone="wing" + sfx(s), matrix=M.copy())
    # smile
    pts = []
    for mx, mz in ((-0.05, -0.085), (0.0, -0.108), (0.05, -0.085)):
        l, n = bsurf.front(mx, mz)
        pts.append(l + n * 0.003)
    mb.add(geom.tube(pts, [0.008, 0.012, 0.008], segments=6, samples=3, up=(0, -1, 0),
                     ellipse=(0.5, 1.0), cap_rings=1), "M_EyeDark", bone="body")
    # little stinger
    l, n = bsurf.hit((0, 2, -0.05), (0, -1, 0))
    st = geom.tube([l - V((0, 0.03, 0)), l + V((0, 0.07, -0.02))], [0.04, 0.004], segments=8,
                   samples=1, caps=("round", "point"), cap_rings=2)
    mb.add(st, "M_EyeDark", bone="body")
    ob = mb.to_object(col)
    ob.name = "Buzzpuff"

    bones = [("root", (0, 0, 0), (0, 0, 0.1), None),
             ("body", (0, 0, -0.15), (0, 0, 0.2), "root")]
    for s in (1, -1):
        bones.append(("wing" + sfx(s), (s * 0.16, 0.16, 0.12), (s * 0.45, 0.30, 0.30), "body"))
        bones.append(("antenna" + sfx(s), (s * 0.09, -0.12, 0.30), (s * 0.17, -0.19, 0.47),
                      "body"))
    arm = rig.build_armature("Armature", bones, col)
    rig.bind(ob, arm)

    def fly(t, f):
        p = {}
        flap = math.cos(2 * TAU * t)                 # two wing beats per loop
        bob = math.sin(TAU * t)
        p["body"] = BoneXf(rot=(4 * math.sin(TAU * (t - 0.1)), 0, 3 * math.sin(TAU * t)),
                           loc=(0, 0, 0.04 * bob), scale=rig.squash(1 + 0.04 * flap))
        for s in (1, -1):
            # rotate about the body's front-back axis: wings sweep up / down
            p["wing" + sfx(s)] = BoneXf(rot=(8 * flap, -s * 48 * flap, 0))
            p["antenna" + sfx(s)] = BoneXf(rot=(-12 * math.cos(TAU * (t - 0.2)),
                                                 -s * 8 * math.sin(2 * TAU * (t - 0.15)), 0))
        return p

    rig.make_action(arm, "fly", 8, fly, loop=True)
    return [arm, ob]


PIECES = [("bramblebug", build_bramblebug), ("buzzpuff", build_buzzpuff)]


def build(out_dir, save=True, only=None):
    common.reset_scene()
    written = []
    for name, fn in PIECES:
        if only and name not in only:
            continue
        col = common.new_collection(name)
        objs = fn(col)
        path = os.path.join(out_dir, name + ".glb")
        export.export_glb(objs, path, animations=True)
        for o in objs:                  # free the name "Armature" for the next model
            if o.type == "ARMATURE":
                o.name = f"Armature_{name}"
        written.append(path)
    if save:
        common.save_blend("enemies")
    return written


def main():
    args = common.parse_args("Generate enemy models")
    for p in build(args.out, save=not args.no_blend, only=args.only):
        print("wrote", p)


if __name__ == "__main__":
    main()
