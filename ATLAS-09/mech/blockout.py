"""Milestone 1 blockout: proportion proxies on the skeleton, replaced from milestone 2 onward."""

from mathutils import Vector

from . import primitives as P
from . import skeleton as SK
from . import utils as U

# bone: (width x, depth y) of the proxy volume around the segment
PROXY = {
    "pelvis": (0.80, 0.55), "spine": (0.60, 0.45), "chest": (1.45, 0.95), "neck": (0.25, 0.25),
    "head": (0.55, 0.50), "sensor": (0.18, 0.18),
    "shoulder": (0.42, 0.42), "upperarm": (0.30, 0.32), "forearm": (0.38, 0.40), "wrist": (0.22, 0.22),
    "finger_a": (0.06, 0.06), "finger_b": (0.06, 0.06), "thumb": (0.06, 0.06), "tool": (0.14, 0.14),
    "thigh": (0.36, 0.40), "shin": (0.40, 0.46), "foot": (0.50, 0.50), "toe": (0.50, 0.36),
}


def build(mats):
    coll = U.sub_coll("Blockout")
    kit = P.Kit(mats, coll)
    out = []
    for b in SK.BONES:
        if b == "root":
            continue
        base = b.split(".")[0]
        w, d = PROXY[base]
        h, t = SK.head(b), SK.tail(b)
        L = (t - h).length
        mat = "armor" if base in {"chest", "thigh", "shin", "forearm", "shoulder", "head"} else "steel_dark"
        if base == "shoulder":
            # pauldron proxy sits over the shoulder joint, not along the clavicle
            out.append(P.make(f"Blockout_{b}", coll, kit.m(mat),
                              lambda bm, w=w: P.bm_box(bm, w, w, w, bevel=0.04), U.T(*t), b))
            continue
        if base == "foot":
            f = P.make(f"Blockout_{b}", coll, kit.m(mat),
                       lambda bm, w=w, d=d: P.bm_box(bm, w, 0.95, 0.22, bevel=0.03),
                       U.T(h.x, -0.12, 0.11), b)
            f["ground_anchor"] = True
            out.append(f)
            continue
        if base == "toe":
            continue
        out.append(P.make(f"Blockout_{b}", coll, kit.m(mat),
                          lambda bm, w=w, d=d, L=L: P.bm_beam(bm, (0, 0, 0), (0, 0, L), w, d, bevel=0.03),
                          U.frame(h, t - h), b))
    # joint markers
    for b in SK.BONES:
        if b == "root":
            continue
        out.append(P.make(f"Blockout_Joint_{b}", coll, kit.m("emit_amber"),
                          lambda bm: P.bm_sphere(bm, 0.05), U.T(*SK.head(b)), b, wn=False))
    return out
