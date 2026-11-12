"""Project AEGIS - build the mechanical dragon scene from scratch.

    python3 build.py --milestone 6 --save aegis_dragon.blend
"""
import argparse
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from aegis import materials, rig, render  # noqa: E402
from aegis.geo import get_coll  # noqa: E402


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build(milestone=6, env=True):
    t0 = time.time()
    reset()
    scene = bpy.context.scene
    mats = materials.build_all()
    root = get_coll("AEGIS")
    c_rig = get_coll("AEGIS_Rig", root)
    arm = rig.build_armature(c_rig)
    materials.bind_drivers(arm)
    ctx = dict(scene=scene, mats=mats, arm=arm, root=root)
    if milestone == 1:
        from aegis import blockout
        blockout.build(arm, get_coll("AEGIS_Blockout", root), mats)
    if milestone >= 2:
        from aegis import skeleton
        skeleton.build(ctx)
    if milestone >= 3:
        from aegis import armor, head, wings
        armor.build(ctx)
        head.build(ctx)
        wings.build(ctx)
    if milestone >= 4:
        from aegis import reactor
        reactor.build(ctx)
    if milestone >= 5:
        from aegis import animation
        animation.build(ctx)
    if milestone >= 6 and env:
        from aegis import environment
        environment.build(ctx)
    print("AEGIS build: milestone %d, %d objects, %.1fs" % (milestone, len(bpy.data.objects), time.time() - t0))
    return ctx


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--milestone", type=int, default=6)
    ap.add_argument("--save", default="")
    a = ap.parse_args()
    ctx = build(a.milestone)
    if a.milestone >= 5:
        from aegis import animation
        ok, lines = animation.validate(ctx)
        print("\n".join(["MOTION VALIDATION"] + lines))
        ctx["scene"].frame_set(ctx["scene"].frame_end)
    if a.milestone >= 6:
        from aegis import render
        render.setup_cycles(ctx["scene"], res=(1920, 1080), samples=160)
    if a.save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save), compress=True)
