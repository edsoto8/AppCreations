"""Milestone preview renders with neutral studio lighting.  python3 preview.py <milestone> <tag> [views] [frame]"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
import build as B
from aegis import render
from aegis.geo import get_coll

VIEWS = {
    "front34": ((-13, -17, 6.5), (0, -1.0, 4.0), 32),
    "side": ((-26, 1, 4.5), (0, 1.5, 3.8), 40),
    "top": ((0, 1.5, 34), (0, 1.5, 0), 35),
    "head": ((-5.2, -12.6, 6.3), (0, -7.2, 6.8), 55),
    "headfront": ((-1.8, -14.5, 5.6), (0, -7.2, 6.7), 60),
    "chest": ((-2.6, -6.4, 1.5), (0, -2.1, 2.5), 50),
    "rear34": ((12, 17, 8), (0, 1, 3.5), 32),
    "wing": ((9, -9, 10), (5.5, 0.5, 5.5), 40),
    "foot": ((-4.2, -4.6, 1.2), (-1.3, -2.0, 0.6), 50),
    "front": ((0, -24, 4.5), (0, 0, 4.6), 35),
}
ms = int(sys.argv[1]); tag = sys.argv[2]
views = sys.argv[3].split(",") if len(sys.argv) > 3 else ["front34", "side"]
frame = int(sys.argv[4]) if len(sys.argv) > 4 else None
ctx = B.build(ms, env=False)
scene = ctx["scene"]
render.setup_cycles(scene, res=(1280, 720), samples=int(os.environ.get("SPP", 24)))
render.studio(scene, get_coll("Preview"))
if frame is not None: scene.frame_set(frame)
for v in views:
    loc, tgt, lens = VIEWS[v]
    cam = render.camera(scene, "cam_" + v, loc, tgt, lens)
    render.still(scene, cam, os.path.join(HERE, "previews", "%s_%s.png" % (tag, v)))
