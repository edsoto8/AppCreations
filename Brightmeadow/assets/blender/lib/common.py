"""Bootstrap shared by every generator: paths, CLI args, scene reset, collections.

Works both as `python gen_x.py [args]` (bpy wheel) and `blender -b --python gen_x.py -- [args]`.
"""
import argparse
import os
import sys

import bpy

LIB_DIR = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(LIB_DIR)                       # assets/blender
APP_ROOT = os.path.dirname(os.path.dirname(BLENDER_DIR))     # Brightmeadow/
MODELS_DIR = os.path.join(APP_ROOT, "game", "assets", "models")
SOURCE_DIR = os.path.join(BLENDER_DIR, "source")
RENDERS_DIR = os.path.join(BLENDER_DIR, "renders")
FPS = 30


def script_args(argv=None):
    """Arguments after `--` when run inside Blender, otherwise sys.argv[1:]."""
    argv = sys.argv if argv is None else argv
    if "--" in argv:
        return argv[argv.index("--") + 1:]
    # bpy-module run: python script.py a b c
    return argv[1:]


def parse_args(description, extra=None):
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--out", default=MODELS_DIR, help="output folder for .glb files")
    p.add_argument("--no-blend", action="store_true", help="skip saving source .blend")
    p.add_argument("--only", nargs="*", help="only build these asset names")
    if extra:
        extra(p)
    return p.parse_args(script_args())


def reset_scene():
    """Empty factory scene (deterministic starting point for every group)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.fps = FPS
    scn.frame_start = 0
    scn.frame_end = 60
    scn.unit_settings.system = "METRIC"
    return scn


def new_collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def save_blend(group):
    os.makedirs(SOURCE_DIR, exist_ok=True)
    path = os.path.join(SOURCE_DIR, f"{group}.blend")
    # Only the first asset collection stays visible so the overlapping assets (all built at
    # the origin, as exported) don't pile up in the viewport.
    for i, lc in enumerate(bpy.context.view_layer.layer_collection.children):
        lc.hide_viewport = i > 0
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True, check_existing=False)
    for lc in bpy.context.view_layer.layer_collection.children:
        lc.hide_viewport = False
    return path


def want(args, name):
    return not args.only or name in args.only
