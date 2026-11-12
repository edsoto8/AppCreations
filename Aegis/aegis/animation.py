"""Milestone 5: the activation sequence, keyed on the rig, plus motion validation.

Timeline (24 fps):  dormant -> eyes/core power on -> body & head rise, jaw opens ->
wings unfold (shoulder, elbow, wrist fan, panels retract, membranes ignite) -> tail sweep -> hero pose.
"""
from math import cos, pi, radians, sin

import bpy
from mathutils import Vector

from . import rig

FPS = 24
END = 264
SG = {"L": 1, "R": -1}

NECK_DORMANT = [-10, -12, -14, -12, -8, -2, 4]
NECK_HERO = [3, 3, 2, 0, -3, -5, -6]
FOLD = {"wing_arm": 84, "wing_fore": -122, "wing_f1a": 110, "wing_f2a": 85, "wing_f3a": 65, "wing_f4a": 49,
        "wing_strut": -78, "wing_thumb": 40}


def _key(pb, frame, rot=None, loc=None):
    if rot is not None:
        pb.rotation_euler = [radians(a) for a in rot]
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)


def _prop(arm, name, keys):
    for f, v in keys:
        arm[name] = float(v)
        arm.keyframe_insert('["%s"]' % name, frame=f)


def build(ctx):
    arm, scene = ctx["arm"], ctx["scene"]
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, END
    pb = arm.pose.bones

    # --- energy systems ---------------------------------------------------------------------
    flick = [(1, 0), (30, 0), (32, 0.7), (34, 0.05), (37, 0.9), (39, 0.2), (42, 1.0), (46, 0.6), (50, 1.0), (END, 1.0)]
    _prop(arm, "eye_power", flick)
    _prop(arm, "energy", [(1, 0), (40, 0), (48, 0.18), (56, 0.1), (72, 0.55), (96, 1.0), (130, 1.0), (142, 1.5), (160, 1.0),
                          (END, 1.0)])
    _prop(arm, "throat_power", [(1, 0), (104, 0), (128, 0.6), (142, 2.2), (160, 0.9), (200, 0.5), (END, 0.6)])
    _prop(arm, "membrane_power", [(1, 0), (180, 0), (190, 0.35), (194, 0.15), (204, 0.8), (216, 1.0), (END, 1.0)])

    # --- body: rises on planted feet (IK) ---------------------------------------------------
    _key(pb["body"], 1, rot=(-3, 0, 0), loc=(0, 0, -0.34))
    _key(pb["body"], 58, rot=(-3, 0, 0), loc=(0, 0, -0.34))
    _key(pb["body"], 112, rot=(2, 0, 0), loc=(0, 0.05, 0.0))
    _key(pb["body"], 140, rot=(3, 0, 0), loc=(0, -0.06, -0.04))      # leans into the roar
    _key(pb["body"], 190, rot=(1, 0, 0), loc=(0, 0, 0))
    _key(pb["body"], END, rot=(1.5, 0, 0), loc=(0, 0, 0.02))

    # --- neck & head ------------------------------------------------------------------------
    for i in range(rig.N_NECK):
        b = pb["neck_%02d" % (i + 1)]
        d, h = NECK_DORMANT[i], NECK_HERO[i]
        t0 = 56 + i * 4
        _key(b, 1, rot=(d, 0, 0))
        _key(b, t0, rot=(d, 0, 0))
        _key(b, t0 + 50, rot=(4, 0, -2.5))                # rears up, slight turn
        _key(b, 142, rot=(h - 4, 0, 0))                   # thrusts forward for the roar
        _key(b, 200, rot=(h, 0, 2.2))
        _key(b, END, rot=(h, 0, 2.6))
    _key(pb["head"], 1, rot=(38, 0, 0))
    _key(pb["head"], 70, rot=(38, 0, 0))
    _key(pb["head"], 122, rot=(8, 0, 0))
    _key(pb["head"], 142, rot=(16, 0, 0))
    _key(pb["head"], 200, rot=(-10, 0, 4))
    _key(pb["head"], END, rot=(-12, 0, 5))
    _key(pb["jaw"], 1, rot=(0, 0, 0))
    _key(pb["jaw"], 116, rot=(0, 0, 0))
    _key(pb["jaw"], 140, rot=(-36, 0, 0))
    _key(pb["jaw"], 156, rot=(-34, 0, 0))
    _key(pb["jaw"], 196, rot=(-14, 0, 0))
    _key(pb["jaw"], END, rot=(-17, 0, 0))
    for s in ("L", "R"):
        g = SG[s]
        _key(pb["brow." + s], 1, rot=(0, 0, 0))
        _key(pb["brow." + s], 96, rot=(0, 0, 0))
        _key(pb["brow." + s], 124, rot=(-7, 9 * g, 0))
        _key(pb["brow." + s], END, rot=(-6, 7 * g, 0))
        _key(pb["cheek." + s], 1, rot=(0, 0, 0))
        _key(pb["cheek." + s], 110, rot=(0, 0, 0))
        _key(pb["cheek." + s], 138, rot=(0, 0, 15 * g))
        _key(pb["cheek." + s], 200, rot=(0, 0, 8 * g))
        _key(pb["cheek." + s], END, rot=(0, 0, 9 * g))

    # --- wings -----------------------------------------------------------------------------
    for s in ("L", "R"):
        g = SG[s]
        seq = [("wing_arm", 104, 164), ("wing_fore", 116, 182), ("wing_f1a", 140, 198), ("wing_f2a", 146, 204),
               ("wing_f3a", 152, 210), ("wing_f4a", 158, 216), ("wing_strut", 150, 206), ("wing_thumb", 150, 190)]
        for bone, t0, t1 in seq:
            b = pb["%s.%s" % (bone, s)]
            a = FOLD[bone] * g
            _key(b, 1, rot=(0, 0, a))
            _key(b, t0, rot=(0, 0, a))
            _key(b, t1, rot=(0, 0, 0))
        b = pb["wing_base." + s]
        _key(b, 1, rot=(-34, 0, 0))
        _key(b, 100, rot=(-34, 0, 0))
        _key(b, 150, rot=(8, 0, 0))
        _key(b, 216, rot=(-4, 0, 0))
        _key(b, 240, rot=(23, 0, 0))           # final flare upward
        _key(b, END, rot=(20, 0, 0))
        for k in range(rig.N_FING):
            b = pb["wing_f%db.%s" % (k + 1, s)]
            _key(b, 1, rot=(0, 0, 6 * g))
            _key(b, 160 + 6 * k, rot=(0, 0, 6 * g))
            _key(b, 214 + 4 * k, rot=(0, 0, -4 * g))
            _key(b, END, rot=(0, 0, 0))
            p = pb["wing_panel%d.%s" % (k + 1, s)]      # panels shield the folded wing, then retract
            _key(p, 1, loc=(0, 1.15, 0))
            _key(p, 150 + 5 * k, loc=(0, 1.15, 0))
            _key(p, 196 + 5 * k, loc=(0, 0, 0))

    # --- tail: uncurls, then a travelling S-wave --------------------------------------------
    for i in range(rig.N_TAIL):
        b = pb["tail_%02d" % (i + 1)]
        _key(b, 1, rot=(0.6, 0, 6.8))
        _key(b, 66, rot=(0.6, 0, 6.8))
        for f in range(110, END + 1, 10):
            amp = min(1.0, (f - 66) / 80.0)
            ph = i * 0.5 - (f - 110) * 0.045
            _key(b, f, rot=(1.6 * amp * sin(ph * 0.7) + 0.8, 0, amp * (7.5 * sin(ph) + 1.2)))

    # --- reactor rings ----------------------------------------------------------------------
    speeds = (1.1, -1.7, 2.6)                               # revolutions per second at full power
    for ob, sp in zip(ctx.get("rings", []), speeds):
        ax = ob["spin_axis"]
        ang = 0.0
        for f in range(1, END + 1, 3):
            power = max(0.0, min(1.0, (f - 40) / 70.0)) ** 1.5
            ob.rotation_euler[ax] = ang
            ob.keyframe_insert("rotation_euler", index=ax, frame=f)
            ang += 3 * sp * 2 * pi / FPS * power
        ad = ob.animation_data
    scene.frame_set(END)


def validate(ctx, step=4):
    """Evaluate the animation and report mechanical problems. Returns (ok, lines)."""
    arm, scene = ctx["arm"], ctx["scene"]
    lines, ok = [], True
    rng = {p[0]: [1e9, -1e9] for p in rig.PISTONS}
    foot_err, min_z = 0.0, 1e9
    low = ""
    for f in range(scene.frame_start, scene.frame_end + 1, step):
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        for name, ea, eb, d, short in rig.PISTONS:
            dist = (ea.evaluated_get(dg).matrix_world.translation - eb.evaluated_get(dg).matrix_world.translation).length / d
            rng[name][0] = min(rng[name][0], dist)
            rng[name][1] = max(rng[name][1], dist)
        ae = arm.evaluated_get(dg)
        for s in ("L", "R"):
            for tip, tgt in (("arm_lower." + s, "ik_hand." + s), ("meta." + s, "ik_foot." + s)):
                foot_err = max(foot_err, (ae.pose.bones[tip].tail - ae.pose.bones[tgt].head).length)
        for b in ae.pose.bones:
            if b.name.startswith(("tail_", "wing_", "head", "jaw", "neck_")):
                z = min((ae.matrix_world @ b.head).z, (ae.matrix_world @ b.tail).z)
                if z < min_z:
                    min_z, low = z, "%s @ frame %d" % (b.name, f)
    bad = []
    for name, ea, eb, d, short in rig.PISTONS:
        lo, hi = rng[name]
        if lo < short * 0.985 or hi > short * 1.9:
            bad.append("%s stroke %.2f..%.2f outside %.2f..%.2f" % (name, lo, hi, short, short * 1.9))
    lines.append("pistons checked: %d, out of stroke: %d" % (len(rig.PISTONS), len(bad)))
    lines += ["  " + b for b in bad]
    lines.append("max foot slip (IK error): %.4f m" % foot_err)
    lines.append("lowest moving bone: %.2f m (%s)" % (min_z, low))
    ok = not bad and foot_err < 0.02 and min_z > 0.15
    lines.append("RESULT: %s" % ("PASS" if ok else "FAIL"))
    return ok, lines
