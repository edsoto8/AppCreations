"""Dragon proportions (single source of truth), armature, bone parenting and working pistons.

World frame: the dragon faces -Y, +Z is up, +X is the dragon's left (.L).
"""
import math
from math import cos, radians, sin

import bpy
from mathutils import Matrix, Vector

from .geo import Part, V, X, Y, Z, frame, frame4, lerp, se, smooth, table

# ------------------------------------------------------------------------------------------
# Proportions
# ------------------------------------------------------------------------------------------
# torso hull: (y, center z, half width, half height)
TORSO = [(-2.95, 3.12, 0.50, 0.55), (-2.3, 2.97, 0.98, 1.02), (-1.5, 2.9, 1.1, 1.15), (-0.3, 2.95, 0.95, 0.95),
         (0.9, 3.0, 0.72, 0.72), (2.0, 2.95, 0.9, 0.85), (2.95, 2.95, 0.56, 0.56)]


def torso_pt(y, a, off=0.0, scale=1.0, e=2.5):
    """Point on the torso hull. a = angle from the dorsal line (+ = left)."""
    cz, w, h = table(TORSO, y)
    c = cos(a)
    if c < 0:
        h *= 0.82
    return Vector(((w * scale + off) * se(sin(a), e), y, cz + (h * scale + off) * se(c, e)))


NECK = [(-2.6, 3.45), (-3.15, 3.95), (-3.6, 4.5), (-3.95, 5.1), (-4.25, 5.7), (-4.6, 6.25), (-5.05, 6.7), (-5.6, 6.95)]
N_NECK = len(NECK) - 1
HEAD0 = Vector((0, -5.6, 6.95))
HEAD_F = Vector((0, -0.965, -0.262)).normalized()
HEAD_U = Vector((0, HEAD_F.z, -HEAD_F.y))
HS = 1.42  # head design-unit scale
HEAD_LEN = 2.3 * HS
N_TAIL = 14
N_FING = 4


def head_pt(f, x, z):
    return HEAD0 + (HEAD_F * f + X * x + HEAD_U * z) * HS


def neck_radius(i):
    return lerp(0.54, 0.4, i / (N_NECK - 1))


def tail_points():
    p = Vector((0, 2.9, 2.95))
    pts = [p]
    for i in range(N_TAIL):
        t = i / (N_TAIL - 1)
        L = lerp(0.86, 0.46, t)
        a = radians(lerp(-6, -30, smooth(t / 0.45)) if t < 0.45 else lerp(-30, 14, smooth((t - 0.45) / 0.55)))
        p = p + Vector((0, cos(a) * L, sin(a) * L))
        pts.append(p)
    return pts


def tail_radius(i):
    return lerp(0.5, 0.11, (i / (N_TAIL - 1)) ** 0.85)


# wings ------------------------------------------------------------------------------------
WING_DIHEDRAL = radians(24)
WING_TILT = radians(7)
WING_ROOT = (0.62, -1.3, 3.88)
W_ELBOW = (2.3, -0.5)
W_WRIST = (4.6, -1.6)
W_TIPS = [(10.0, 0.6), (8.7, 3.7), (6.4, 5.5), (3.9, 5.7)]
W_STRUT = (1.55, 4.5)
W_THUMB = (5.0, -2.45)


def wing_axes(sx):
    u = Vector((cos(WING_DIHEDRAL) * sx, 0, sin(WING_DIHEDRAL)))
    v = Vector((0, cos(WING_TILT), -sin(WING_TILT)))
    n = (u.cross(v) * sx).normalized()
    return u, v, n


def wing_pt(sx, u, v, k=0.0):
    U, Vv, N = wing_axes(sx)
    return Vector((WING_ROOT[0] * sx, WING_ROOT[1], WING_ROOT[2])) + U * u + Vv * v + N * k


def finger_pts(k):
    """2D (u, v) base / mid / tip of finger k (0..3); slightly bowed toward the leading edge."""
    a = Vector(W_WRIST)
    b = Vector(W_TIPS[k])
    d = (b - a)
    perp = Vector((d.y, -d.x)).normalized()
    mid = a + d * 0.48 + perp * 0.32
    return a, mid, b


def finger_k(k):
    """Stacking offset of finger k along the wing normal (a folding-fan hub)."""
    return 0.085 * (k - 1.5)


# legs -------------------------------------------------------------------------------------
def front_leg(sx):
    x = 1.32 * sx
    return dict(S=V(x, -1.75, 2.85), E=V(x, -1.12, 1.62), W=V(x, -1.72, 0.5), P=V(x, -2.22, 0.15))


def rear_leg(sx):
    x = 1.27 * sx
    return dict(H=V(x, 2.2, 2.75), K=V(x, 1.3, 1.58), Hk=V(x, 2.72, 0.98), A=V(x, 2.28, 0.44), P=V(x, 1.78, 0.15))


def toe_specs(P, sx, front=True):
    """Return [(name_stem, base, mid, tip)] for the three forward toes and the rear dew claw."""
    out = []
    for i, off in enumerate((-0.27, 0.0, 0.27)):
        yaw = radians(22) * off / 0.27
        d = Vector((sin(yaw), -cos(yaw), 0))
        base = P + Vector((off, -0.02, 0.0))
        mid = base + d * 0.44 + Z * -0.02
        tip = mid + d * 0.40 + Z * -0.125
        out.append(("toe%d" % (i + 1), base, mid, tip))
    back = P + Vector((0, 0.42, 0.17))
    bm = back + Vector((0, 0.3, -0.1))
    bt = bm + Vector((0, 0.26, -0.17))
    out.append(("dew", back, bm, bt))
    return out


# ------------------------------------------------------------------------------------------
# Armature
# ------------------------------------------------------------------------------------------
def bone_specs():
    """[(name, head, tail, parent, z_axis)]"""
    B = []
    B.append(("root", V(0, 0, 0), V(0, -1.0, 0), None, Z))
    B.append(("body", V(0, 2.4, 2.95), V(0, 0.2, 3.0), "root", Z))
    B.append(("chest", V(0, 0.2, 3.0), V(0, -2.6, 3.2), "body", Z))
    par = "chest"
    for i in range(N_NECK):
        a, b = NECK[i], NECK[i + 1]
        B.append(("neck_%02d" % (i + 1), V(0, a[0], a[1]), V(0, b[0], b[1]), par, Z))
        par = "neck_%02d" % (i + 1)
    B.append(("head", HEAD0, HEAD0 + HEAD_F * HEAD_LEN, par, HEAD_U))
    B.append(("jaw", head_pt(0.3, 0, -0.2), head_pt(2.08, 0, -0.3), "head", HEAD_U))
    for sx, s in ((1, "L"), (-1, "R")):
        B.append(("brow." + s, head_pt(0.62, 0.2 * sx, 0.3), head_pt(1.28, 0.31 * sx, 0.2), "head", HEAD_U))
        B.append(("cheek." + s, head_pt(0.8, 0.44 * sx, 0.0), head_pt(0.0, 0.56 * sx, 0.04), "head", HEAD_U))
    tp = tail_points()
    par = "body"
    for i in range(N_TAIL):
        B.append(("tail_%02d" % (i + 1), tp[i], tp[i + 1], par, Z))
        par = "tail_%02d" % (i + 1)
    for sx, s in ((1, "L"), (-1, "R")):
        fl = front_leg(sx)
        fwd = V(0, -1, 0)
        B.append(("arm_upper." + s, fl["S"], fl["E"], "chest", fwd))
        B.append(("arm_lower." + s, fl["E"], fl["W"], "arm_upper." + s, fwd))
        B.append(("hand." + s, fl["W"], fl["P"], "arm_lower." + s, Z))
        B.append(("ik_hand." + s, fl["W"], fl["P"], "root", Z))
        for stem, a, m, t in toe_specs(fl["P"], sx):
            B.append(("f%s_a.%s" % (stem, s), a, m, "hand." + s, Z))
            B.append(("f%s_b.%s" % (stem, s), m, t, "f%s_a.%s" % (stem, s), Z))
        rl = rear_leg(sx)
        B.append(("thigh." + s, rl["H"], rl["K"], "body", fwd))
        B.append(("shin." + s, rl["K"], rl["Hk"], "thigh." + s, fwd))
        B.append(("meta." + s, rl["Hk"], rl["A"], "shin." + s, fwd))
        B.append(("foot." + s, rl["A"], rl["P"], "meta." + s, Z))
        B.append(("ik_foot." + s, rl["A"], rl["P"], "root", Z))
        for stem, a, m, t in toe_specs(rl["P"], sx, front=False):
            B.append(("r%s_a.%s" % (stem, s), a, m, "foot." + s, Z))
            B.append(("r%s_b.%s" % (stem, s), m, t, "r%s_a.%s" % (stem, s), Z))
        # wing
        U, Vv, N = wing_axes(sx)
        w = lambda uv, k=0.0: wing_pt(sx, uv[0], uv[1], k)
        B.append(("wing_base." + s, w((-0.45, 0)), w((0, 0)), "chest", N))
        B.append(("wing_arm." + s, w((0, 0)), w(W_ELBOW), "wing_base." + s, N))
        B.append(("wing_fore." + s, w(W_ELBOW), w(W_WRIST), "wing_arm." + s, N))
        B.append(("wing_thumb." + s, w(W_WRIST, 0.2), w(W_THUMB, 0.2), "wing_fore." + s, N))
        B.append(("wing_strut." + s, w(W_ELBOW, -0.2), w(W_STRUT, -0.2), "wing_arm." + s, N))
        for k in range(N_FING):
            a, m, t = finger_pts(k)
            kk = finger_k(k)
            B.append(("wing_f%da.%s" % (k + 1, s), w(a, kk), w(m, kk), "wing_fore." + s, N))
            B.append(("wing_f%db.%s" % (k + 1, s), w(m, kk), w(t, kk), "wing_f%da.%s" % (k + 1, s), N))
            # retractable armor panel slides along the finger base
            B.append(("wing_panel%d.%s" % (k + 1, s), w(a.lerp(m, 0.12), kk), w(a.lerp(m, 0.55), kk),
                      "wing_f%da.%s" % (k + 1, s), N))
    return B


def build_armature(coll):
    ad = bpy.data.armatures.new("AEGIS_Rig")
    arm = bpy.data.objects.new("AEGIS_Rig", ad)
    coll.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent, zax in bone_specs():
        eb = ad.edit_bones.new(name)
        eb.head = head
        eb.tail = tail
        eb.align_roll(Vector(zax))
        if parent:
            eb.parent = ad.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    ad.display_type = 'STICK'
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    # IK: feet stay planted while the body moves
    for s in ("L", "R"):
        for low, tgt, n, foot in (("arm_lower." + s, "ik_hand." + s, 2, "hand." + s),
                                  ("meta." + s, "ik_foot." + s, 3, "foot." + s)):
            c = arm.pose.bones[low].constraints.new('IK')
            c.target = arm
            c.subtarget = tgt
            c.chain_count = n
            c.use_stretch = False
            c2 = arm.pose.bones[foot].constraints.new('COPY_ROTATION')
            c2.target = arm
            c2.subtarget = tgt
    # animation control properties
    for prop in ("energy", "eye_power", "membrane_power", "throat_power"):
        arm[prop] = 1.0
        arm.id_properties_ui(prop).update(min=0.0, max=1.0, soft_min=0.0, soft_max=1.0)
    return arm


def bone_m(arm, bone):
    return arm.matrix_world @ arm.data.bones[bone].matrix_local


def attach(ob, arm, bone, local=False, basis=None):
    """Bone-parent `ob`. local=True: mesh was built in bone space; else it was built in world space."""
    b = arm.data.bones[bone]
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    pm = arm.matrix_world @ b.matrix_local @ Matrix.Translation((0, b.length, 0))
    ob.matrix_parent_inverse = pm.inverted()
    ob.matrix_basis = basis if basis is not None else (bone_m(arm, bone) if local else Matrix.Identity(4))
    return ob


def side_sign(arm, bone):
    """+1 if the bone's local +X points to world +X (the dragon's left), else -1."""
    return 1 if (arm.data.bones[bone].matrix_local.to_3x3() @ X).x > 0 else -1


def to_world(arm, bone, p):
    return bone_m(arm, bone) @ Vector(p)


PISTONS = []  # (name, barrel_obj, rod_obj, rest_length) for motion validation


def piston(name, arm, bone_a, pa, bone_b, pb, r, coll, helpers, mats, up=Z, short=0.8):
    """A working hydraulic cylinder between two bones (world-space rest anchors pa -> pb).

    The barrel is pinned to bone_a and aims at bone_b's anchor; the chrome rod is pinned to bone_b
    and aims back, so the rod visibly slides in and out as the joint moves.
    """
    pa, pb = Vector(pa), Vector(pb)
    d = (pb - pa).length
    ti, ch, gold, steel = mats["AEGIS_Gunmetal"], mats["AEGIS_Chrome"], mats["AEGIS_Gold"], mats["AEGIS_Titanium_Light"]
    lb = d * short * 0.97
    brl = Part(name + "_barrel")
    brl.cyl((-r * 1.5, 0, 0), (r * 1.5, 0, 0), r * 0.95, ch, 14)            # clevis pin
    brl.lathe((0, r * 0.2, 0), Y, [(0, 0), (0, r * 1.25), (r * 0.8, r * 1.25), (r * 1.0, r), (lb * 0.8, r),
                                   (lb * 0.82, r * 1.18), (lb * 0.9, r * 1.18), (lb * 0.92, r * 0.85),
                                   (lb, r * 0.8), (lb, r * 0.5)], ti, 18)
    brl.lathe((0, lb * 0.28, 0), Y, [(0, r * 1.12), (r * 0.5, r * 1.12)], gold, 18)
    brl.lathe((0, lb * 0.28, 0), Y, [(0, r * 1.12), (0, r * 0.9)], gold, 18)
    brl.lathe((0, lb * 0.28 + r * 0.5, 0), Y, [(0, r * 1.12), (0, r * 0.9)], gold, 18)
    # hydraulic feed line + port blocks
    brl.box((0, lb * 0.16, r * 1.1), (r * 0.9, r * 0.9, r * 0.8), steel)
    brl.box((0, lb * 0.74, r * 1.1), (r * 0.9, r * 0.9, r * 0.8), steel)
    brl.sweep([(0, lb * 0.16, r * 1.5), (0, lb * 0.2, r * 1.9), (0, lb * 0.7, r * 1.9), (0, lb * 0.74, r * 1.5)],
              r * 0.22, mats["AEGIS_Copper"], 8)
    ob_b = brl.finish(coll, bevel=min(0.006, r * 0.12))
    lr = d * short * 0.97
    rod = Part(name + "_rod")
    rod.cyl((-r * 1.5, 0, 0), (r * 1.5, 0, 0), r * 0.95, ch, 14)
    rod.lathe((0, 0, 0), Y, [(-r * 1.2, 0), (-r * 1.2, r * 0.7), (r * 1.2, r * 1.0), (r * 1.6, r * 0.48), (lr, r * 0.48),
                             (lr, 0)], ch, 16)
    ob_r = rod.finish(coll, bevel=min(0.005, r * 0.1))
    ob_b.matrix_world = frame4(pa, pb - pa, up)
    ob_r.matrix_world = frame4(pb, pa - pb, up)
    ea = bpy.data.objects.new(name + "_anchorA", None)
    eb = bpy.data.objects.new(name + "_anchorB", None)
    for e, p, bone in ((ea, pa, bone_a), (eb, pb, bone_b)):
        e.empty_display_size = 0.05
        helpers.objects.link(e)
        attach(e, arm, bone)
        e.matrix_basis = Matrix.Translation(p)
    for ob, bone, tgt, p, d2 in ((ob_b, bone_a, eb, pa, pb - pa), (ob_r, bone_b, ea, pb, pa - pb)):
        attach(ob, arm, bone)
        ob.matrix_basis = frame4(p, d2, up)
        c = ob.constraints.new('DAMPED_TRACK')
        c.target = tgt
        c.track_axis = 'TRACK_Y'
    PISTONS.append((name, ea, eb, d, short))
    return ob_b, ob_r
