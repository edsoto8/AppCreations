"""Armatures, rigid skinning and procedural (per-frame) actions.

Poses are authored in *armature axes* (Blender: X = character's left, -Y = front, Z = up) and
converted to each bone's local rest frame here, so animation code can say "swing the thigh
forward 30 degrees about X" without caring about bone rolls.

Conventions for rotations about armature X (right-hand rule): a bone that points down swings
BACKWARD (+Y) for positive angles and FORWARD (toward the camera, -Y) for negative angles.
"""
import math

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector


def build_armature(name, bones, collection):
    """bones: [(name, head, tail, parent_name_or_None), ...] in armature space."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, head, tail, parent in bones:
        eb = arm.edit_bones.new(bname)
        eb.head = head
        eb.tail = tail
        eb.roll = 0.0
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    arm.display_type = "STICK"
    return ob


def bind(mesh_ob, arm_ob):
    """Parent the mesh to the armature with an Armature modifier (first in the stack)."""
    mesh_ob.parent = arm_ob
    mod = mesh_ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_ob
    mod.use_vertex_groups = True
    idx = list(mesh_ob.modifiers).index(mod)
    if idx != 0:
        mesh_ob.modifiers.move(idx, 0)
    return mod


class BoneXf:
    __slots__ = ("rot", "loc", "scale")

    def __init__(self, rot=(0, 0, 0), loc=(0, 0, 0), scale=(1, 1, 1)):
        self.rot = rot        # degrees (armature axes, XYZ order) or a Quaternion
        self.loc = loc        # metres, armature axes
        self.scale = scale    # bone-local (Y = along the bone)


def _rest_rot(arm_ob, bname):
    return arm_ob.data.bones[bname].matrix_local.to_3x3().normalized()


def to_basis(arm_ob, bname, xf):
    R = _rest_rot(arm_ob, bname)
    Ri = R.inverted()
    if isinstance(xf.rot, Quaternion):
        m = xf.rot.to_matrix()
    else:
        m = Euler([math.radians(a) for a in xf.rot], "XYZ").to_matrix()
    q = (Ri @ m @ R).to_quaternion()
    loc = Ri @ Vector(xf.loc)
    return q, loc, Vector(xf.scale)


def make_action(arm_ob, name, frames, pose_fn, loop=True):
    """Key every bone on every frame 0..frames from pose_fn(t, frame) -> {bone: BoneXf}.

    t = frame / frames in [0, 1]. Loops should return the same pose at t=0 and t=1.
    Every bone is keyed (unlisted bones at rest) so each action is self-contained.
    """
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad = arm_ob.animation_data or arm_ob.animation_data_create()
    ad.action = act
    prev = {}
    for f in range(frames + 1):
        t = f / frames
        pose = pose_fn(t, f)
        for pb in arm_ob.pose.bones:
            xf = pose.get(pb.name, None) or BoneXf()
            q, loc, sc = to_basis(arm_ob, pb.name, xf)
            p = prev.get(pb.name)
            if p is not None and p.dot(q) < 0:
                q.negate()
            prev[pb.name] = q
            pb.rotation_quaternion = q
            pb.location = loc
            pb.scale = sc
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            pb.keyframe_insert("location", frame=f, group=pb.name)
            pb.keyframe_insert("scale", frame=f, group=pb.name)
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = frames
    act.use_cyclic = loop
    store_action(arm_ob, act)
    return act


def store_action(arm_ob, act):
    """Stash the action on its own (muted) NLA track named like the action, then clear the
    active action so the rest pose is untouched."""
    ad = arm_ob.animation_data
    slot = ad.action_slot if hasattr(ad, "action_slot") else None
    track = ad.nla_tracks.new()
    track.name = act.name
    strip = track.strips.new(act.name, 0, act)
    if slot is not None and hasattr(strip, "action_slot"):
        try:
            strip.action_slot = slot
        except Exception:
            pass
    track.mute = True
    ad.action = None
    for pb in arm_ob.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


# --------------------------------------------------------------------------- easing helpers

def ease_in_out(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) * (1 - t)


def ease_in(t):
    t = max(0.0, min(1.0, t))
    return t * t


def ease_out_back(t, s=1.70158):
    t = max(0.0, min(1.0, t)) - 1
    return t * t * ((s + 1) * t + s) + 1


def keys(t, pts, ease=ease_in_out):
    """Piecewise interpolation through [(t, value), ...] (value float or tuple)."""
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            u = ease((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
            if isinstance(v0, (tuple, list)):
                return tuple(a + (b - a) * u for a, b in zip(v0, v1))
            return v0 + (v1 - v0) * u
    return pts[-1][1]


def wave(t, cycles=1.0, phase=0.0):
    """sin wave over a loop: t in [0,1], phase in cycles (0.25 = quarter-cycle delay)."""
    return math.sin(2 * math.pi * (t * cycles - phase))


def squash(s):
    """Volume-preserving bone-local scale: s along the bone, 1/sqrt(s) across."""
    k = 1.0 / math.sqrt(s)
    return (k, s, k)


def euler_q(x=0.0, y=0.0, z=0.0):
    """Quaternion from XYZ euler degrees (armature axes)."""
    return Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ").to_quaternion()
