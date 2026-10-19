"""ATLAS-09 proportions: joint positions and the bone hierarchy (rest pose, metres, Z up).

The mech faces -Y. Its left side is +X (Blender ``.L`` convention). Overall height to the top
of the sensor head is about 4.0 m, about 4.2 m to the antenna tips.
"""

from mathutils import Vector

from . import utils as U

# name: (head, tail, parent)
BONES = {
    "root":        ((0.0, 0.0, 0.0),      (0.0, 0.6, 0.0),      None),
    "pelvis":      ((0.0, 0.06, 2.02),    (0.0, 0.06, 2.30),    "root"),
    "spine":       ((0.0, 0.06, 2.30),    (0.0, 0.06, 2.58),    "pelvis"),
    "chest":       ((0.0, 0.06, 2.58),    (0.0, 0.06, 3.40),    "spine"),
    "neck":        ((0.0, -0.06, 3.44),   (0.0, -0.06, 3.60),   "chest"),
    "head":        ((0.0, -0.06, 3.60),   (0.0, -0.06, 3.88),   "neck"),
    "sensor":      ((0.0, 0.02, 3.90),    (0.0, 0.02, 4.02),    "head"),
}

LEG = {
    "thigh":  ((0.44, 0.06, 2.10),  (0.47, -0.08, 1.26)),
    "shin":   ((0.47, -0.08, 1.26), (0.50, 0.06, 0.42)),
    "foot":   ((0.50, 0.06, 0.42),  (0.50, -0.26, 0.17)),
    "toe":    ((0.50, -0.30, 0.13), (0.50, -0.64, 0.10)),
}
ARM = {
    "shoulder": ((0.42, 0.06, 3.20), (1.00, 0.06, 3.20)),
    "upperarm": ((1.00, 0.06, 3.20), (1.10, 0.10, 2.52)),
    "forearm":  ((1.10, 0.10, 2.52), (1.14, 0.02, 1.90)),
    "wrist":    ((1.14, 0.02, 1.90), (1.15, 0.01, 1.74)),
}
PARENTS = {"thigh": "pelvis", "shin": "thigh", "foot": "shin", "toe": "foot",
           "shoulder": "chest", "upperarm": "shoulder", "forearm": "upperarm", "wrist": "forearm"}

for side, s in (("L", 1.0), ("R", -1.0)):
    for name, (h, t) in {**LEG, **ARM}.items():
        BONES[f"{name}.{side}"] = ((s * h[0], h[1], h[2]), (s * t[0], t[1], t[2]),
                                   PARENTS[name] if PARENTS[name] in BONES else f"{PARENTS[name]}.{side}")

# Gripper fingers (left hand) and tool spindle (right hand)
_palm_z = 1.66
for i, (dx, dy) in enumerate(((0.07, -0.085), (-0.07, -0.085), (0.0, 0.10))):
    nm = ("finger_a", "finger_b", "thumb")[i]
    BONES[f"{nm}.L"] = ((1.15 + dx, 0.01 + dy, _palm_z), (1.15 + dx * 1.2, 0.01 + dy * 1.5, _palm_z - 0.24), "wrist.L")
BONES["tool.R"] = ((-1.15, 0.01, 1.70), (-1.15, 0.01, 1.30), "wrist.R")


def head(b):
    return Vector(BONES[b][0])


def tail(b):
    return Vector(BONES[b][1])


def seg(b):
    """Segment frame: origin at the bone head, local Z = tail->head ("up" the limb),
    local X close to world X. Parts are modelled from z=0 down to z=-length."""
    h, t = head(b), tail(b)
    return U.frame(h, h - t, Vector((1, 0, 0))), (h - t).length


def side_sign(side):
    return 1.0 if side == "L" else -1.0
