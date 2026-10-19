"""Armature, bone parenting, cable hooks and the two actions ("Neutral", "Demo").

* Bones come from ``skeleton.BONES``. Rolls are set so every limb bone's local X equals world X;
  pitch joints (hip, knee, ankle, elbow, fingers) then all bend about X. Shoulder bones run
  along +-X, and their Y axis is the shoulder pitch axis.
* Every generated object tagged ``ob["bone"]`` is bone-parented (world transform preserved).
  Hydraulic cylinders/rods hang under two anchor empties that ride different bones and aim at
  each other (Damped Track), so they telescope with the joint. Coil springs Stretch-To.
* Cable curves that cross a joint get Hook modifiers: the far half of the control points
  follows the second bone and the middle point is shared 50/50.
* Leg poses are solved with a small analytic 2-bone IK in the sagittal plane, so the feet stay
  flat on the ground while the pelvis drops or a foot steps forward.
"""

import math

import bpy
from mathutils import Matrix, Vector

from . import qc
from . import skeleton as SK
from . import utils as U

RIG_NAME = "ATLAS-09_Rig"
FRAME_END = 48


def build(ctx, actions=False):
    coll = U.sub_coll("Rig")
    ad = bpy.data.armatures.new(RIG_NAME)
    ad.display_type = "OCTAHEDRAL"
    arm = bpy.data.objects.new(RIG_NAME, ad)
    arm.show_in_front = True
    coll.objects.link(arm)
    vl = bpy.context.view_layer
    vl.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    xw = Vector((1, 0, 0))
    for name, (h, t, parent) in SK.BONES.items():
        eb = ad.edit_bones.new(name)
        eb.head, eb.tail = Vector(h), Vector(t)
        y = (eb.tail - eb.head).normalized()
        z = xw.cross(y)
        eb.align_roll(z if z.length > 1e-3 else Vector((0, 0, 1)))
    for name, (h, t, parent) in SK.BONES.items():
        if parent:
            ad.edit_bones[name].parent = ad.edit_bones[parent]
            ad.edit_bones[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    vl.update()

    # ---- parent every tagged object to its bone (keeping its world transform)
    root = bpy.data.collections[U.ROOT_COLL]
    tagged = [o for o in root.all_objects if o.get("bone") and o.parent is None and o is not arm]
    for ob in tagged:
        b = ob["bone"]
        if b not in ad.bones:
            U.log("RIG", f"unknown bone '{b}'", ob.name)
            continue
        mw = ob.matrix_world.copy()
        ob.parent = arm
        ob.parent_type = "BONE"
        ob.parent_bone = b
        ob.matrix_world = mw
    vl.update()

    # ---- hooks on cables that cross a joint
    nhooks = 0
    for ob in [o for o in root.all_objects if o.type == "CURVE" and o.get("hook_b")]:
        n = len(ob.data.splines[0].points)
        split = int(ob["hook_split"])
        far = list(range(split + 1, n))
        _hook(ob, arm, ob["hook_b"], far, 1.0)
        _hook(ob, arm, ob["hook_b"], [split], 0.5)
        nhooks += 2
    U.log("RIG", f"{len(ad.bones)} bones, {len(tagged)} objects bone-parented, {nhooks} cable hooks")
    rig = {"arm": arm, "actions": {}}
    if actions:
        _make_actions(rig)
    ctx["rig_obj"] = arm
    return rig


def _hook(ob, arm, bone, idx, strength):
    m = ob.modifiers.new(f"Hook_{bone}_{int(strength * 100)}", "HOOK")
    m.object = arm
    m.subtarget = bone
    m.strength = strength
    m.vertex_indices_set(idx)
    pb = arm.pose.bones[bone]
    m.matrix_inverse = (arm.matrix_world @ pb.matrix).inverted() @ ob.matrix_world
    m.center = (0, 0, 0)


# =========================================================================== posing

def _leg_ik(side, pelvis_off, foot_off, pelvis_pitch=0.0):
    """Sagittal-plane 2-bone IK. Returns (thigh, shin, foot) X rotations in radians."""
    def yz(v):
        return Vector((v.y, v.z))

    H, K, A = (SK.head(f"thigh.{side}"), SK.head(f"shin.{side}"), SK.head(f"foot.{side}"))
    L1, L2 = (K - H).length, (A - K).length
    Hn = yz(H) + Vector(pelvis_off)
    An = yz(A) + Vector(foot_off)
    d = An - Hn
    dist = min(d.length, L1 + L2 - 1e-4)

    def ang(v):            # angle of a downward-ish vector, positive = backward (+Y)
        return math.atan2(v.x, -v.y)
    beta = ang(d)
    g1 = math.acos(max(-1, min(1, (L1 ** 2 + dist ** 2 - L2 ** 2) / (2 * L1 * dist))))
    g2 = math.acos(max(-1, min(1, (L2 ** 2 + dist ** 2 - L1 ** 2) / (2 * L2 * dist))))
    a1, a2 = beta - g1, beta + g2             # knee forward
    a1r, a2r = ang(yz(K) - yz(H)), ang(yz(A) - yz(K))
    phi1 = a1 - a1r - pelvis_pitch
    phi2 = (a2 - a2r) - (a1 - a1r)
    phi3 = -(pelvis_pitch + phi1 + phi2)
    return phi1, phi2, phi3


def pose_values(name):
    """Pose dictionary: bone -> (rot_xyz_degrees, loc_xyz) in bone-local terms."""
    P = {}

    def rot(b, x=0.0, y=0.0, z=0.0):
        P[b] = ((x, y, z), P.get(b, ((0, 0, 0), (0, 0, 0)))[1])

    def loc(b, v):
        P[b] = (P.get(b, ((0, 0, 0), (0, 0, 0)))[0], v)

    for b in SK.BONES:
        P[b] = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    if name == "Neutral":
        drop, pitch = 0.03, 0.0
        legs = {"L": ((0.0, -drop), (0.0, 0.0)), "R": ((0.0, -drop), (0.0, 0.0))}
        rot("chest", x=2)
        rot("neck", x=-3)
        rot("head", y=0)
        for sd, s in (("L", 1), ("R", -1)):
            rot(f"shoulder.{sd}", y=-s * 6)
            rot(f"upperarm.{sd}", z=-s * 3)
            rot(f"forearm.{sd}", x=-14)
        for f in ("finger_a.L", "finger_b.L"):
            rot(f, x=-6)                          # gripper open
        rot("thumb.L", x=6)
    elif name == "Demo":
        drop, pitch = 0.16, math.radians(4)
        legs = {"L": ((0.04, -drop), (0.18, 0.0)),     # left foot planted slightly back
                "R": ((0.04, -drop), (-0.30, 0.0))}    # right foot steps forward
        rot("spine", y=-14)
        rot("chest", x=6, y=-6)
        rot("neck", x=6)
        rot("head", y=-28)
        rot("sensor", y=65)
        # left (gripper) arm reaches forward and up, gripper closing on a target
        rot("shoulder.L", y=-62)            # shoulder bone Y = +X: negative = forward
        rot("upperarm.L", z=-10)
        rot("forearm.L", x=-48)
        rot("wrist.L", y=-35)
        for f in ("finger_a.L", "finger_b.L"):
            rot(f, x=22)
        rot("thumb.L", x=-22)
        # right (drill) arm braced low and forward
        rot("shoulder.R", y=28)             # shoulder bone Y = -X: positive = forward
        rot("upperarm.R", z=8)
        rot("forearm.R", x=-46)
        rot("wrist.R", y=20)
        rot("tool.R", y=90)
    else:
        return P
    for sd, ((py, pz), (fy, fz)) in legs.items():
        t, s_, f = _leg_ik(sd, (py, pz), (fy, fz), pitch)
        rot(f"thigh.{sd}", x=math.degrees(t))
        rot(f"shin.{sd}", x=math.degrees(s_))
        rot(f"foot.{sd}", x=math.degrees(f))
    # pelvis bone points up: local Y = world +Z, local Z = world -Y,
    # so a world offset (dy, dz) is the local location (0, dz, -dy)
    dy = legs["L"][0][0]
    rot("pelvis", x=math.degrees(pitch))
    loc("pelvis", (0.0, -drop, -dy))
    return P


def _apply(arm, values):
    for b, (r, l) in values.items():
        pb = arm.pose.bones[b]
        pb.rotation_euler = [math.radians(a) for a in r]
        pb.location = l


def _make_actions(rig):
    arm = rig["arm"]
    arm.animation_data_create()
    neutral = pose_values("Neutral")
    for name in ("Neutral", "Demo"):
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        frames = ((1, pose_values(name)),) if name == "Neutral" else ((1, neutral), (FRAME_END, pose_values(name)))
        for fr, vals in frames:
            _apply(arm, vals)
            for b in vals:
                pb = arm.pose.bones[b]
                pb.keyframe_insert("rotation_euler", frame=fr, group=b)
                pb.keyframe_insert("location", frame=fr, group=b)
        rig["actions"][name] = act
    set_pose(rig, "Neutral")


def set_pose(rig, pose):
    if not rig:
        return
    arm = rig["arm"]
    sc = bpy.context.scene
    if pose == "rest" or pose not in bpy.data.actions:
        if arm.animation_data:
            arm.animation_data.action = None
        _apply(arm, pose_values("rest"))
        sc.frame_set(1)
        return
    act = bpy.data.actions[pose]
    arm.animation_data.action = act
    try:
        if act.slots and arm.animation_data.action_slot is None:
            arm.animation_data.action_slot = act.slots[0]
    except AttributeError:
        pass
    sc.frame_start = 1
    sc.frame_end = FRAME_END if pose == "Demo" else 1
    sc.frame_set(sc.frame_end)
    bpy.context.view_layer.update()


# =========================================================================== QC

def _groups():
    root = bpy.data.collections[U.ROOT_COLL]
    groups = {}

    def bone_of(o):
        if o.parent_type == "BONE" and o.parent:
            return o.parent_bone
        if o.parent and o.parent.parent_type == "BONE":
            return o.parent.parent_bone
        return None
    spec = {
        "LegL_lower": {"shin.L", "foot.L", "toe.L"}, "LegR_lower": {"shin.R", "foot.R", "toe.R"},
        "ThighL": {"thigh.L"}, "ThighR": {"thigh.R"},
        "ArmL_lower": {"forearm.L", "wrist.L", "finger_a.L", "finger_b.L", "thumb.L"},
        "ArmR_lower": {"forearm.R", "wrist.R", "tool.R"},
        "Torso": {"pelvis", "spine", "chest"},
    }
    for o in root.all_objects:
        if o.type != "MESH" or o.get("fastener") or o.hide_render:
            continue
        b = bone_of(o)
        for g, bones in spec.items():
            if b in bones:
                groups.setdefault(g, []).append(o)
    return groups


PAIRS = [("LegL_lower", "LegR_lower"), ("ThighL", "ThighR"), ("ArmL_lower", "Torso"), ("ArmR_lower", "Torso"),
         ("ArmL_lower", "ThighL"), ("ArmR_lower", "ThighR"), ("ArmL_lower", "LegL_lower"),
         ("ArmR_lower", "LegR_lower")]


def intersection_report(ctx):
    rig = ctx.get("rig")
    out = {}
    current = rig["arm"].animation_data.action.name if rig and rig["arm"].animation_data and \
        rig["arm"].animation_data.action else "rest"
    for pose in ("Neutral", "Demo"):
        set_pose(rig, pose)
        g = _groups()
        res = qc.group_intersections({k: g.get(k, []) for k in {a for p in PAIRS for a in p}}, PAIRS)
        out[pose] = {f"{a}~{b}": n for (a, b), n in res.items()}
        for k, n in out[pose].items():
            if n:
                U.log("INTERSECT", f"{pose}: {k} overlapping triangle pairs={n}")
    set_pose(rig, current)
    return out
