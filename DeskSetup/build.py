"""Build the desk scene, render the camera views and save the .blend.

Run with the ``bpy`` module (Blender as a Python package)::

    python build.py                                  # full quality, all views
    python build.py --preview --views front          # quick 960x540 check
    python build.py --config config/standing.json    # custom setup

or inside Blender::

    blender --background --python build.py -- --preview
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from desksetup.config import SceneConfig  # noqa: E402


def parse_args(argv):
    if "--" in argv:  # blender --python build.py -- <our args>
        argv = argv[argv.index("--") + 1:]
    else:
        argv = argv[1:]
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", type=Path, help="JSON file overriding the defaults in desksetup/config.py")
    p.add_argument("--views", nargs="+", help="camera names to render (default: all)")
    p.add_argument("--out", type=Path, help="output folder for PNGs and the .blend (default: render.output_dir)")
    p.add_argument("--samples", type=int, help="override render.samples")
    p.add_argument("--resolution", help="override resolution, e.g. 3840x2160")
    p.add_argument("--preview", action="store_true", help="960x540, 48 samples")
    p.add_argument("--no-render", action="store_true", help="only build and save the .blend")
    p.add_argument("--no-save", action="store_true", help="do not save the .blend")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv if argv is None else argv)
    cfg = SceneConfig.load(args.config) if args.config else SceneConfig()
    rc = cfg.render
    if args.preview:
        rc.resolution_x, rc.resolution_y, rc.samples = 960, 540, 48
    if args.samples:
        rc.samples = args.samples
    if args.resolution:
        rc.resolution_x, rc.resolution_y = (int(v) for v in args.resolution.lower().split("x"))
    out = (args.out or HERE / rc.output_dir).resolve()

    from desksetup import render, scene  # imports bpy

    t0 = time.time()
    built = scene.build(cfg)
    print(f"scene built in {time.time() - t0:.1f}s")
    for k, val in built.layout.report.items():
        print(f"  {k:34s} {val}")
    for w in built.layout.warnings:
        print(f"  warning: {w}")
    out.mkdir(parents=True, exist_ok=True)
    (out / "layout_report.json").write_text(
        json.dumps({"report": built.layout.report, "warnings": built.layout.warnings}, indent=2) + "\n", encoding="utf-8"
    )
    if not args.no_save:
        blend = out / rc.blend_file
        render.save_blend(blend)
        print(f"saved {blend}")
    if not args.no_render:
        for path in render.render_views(built.cameras, out, args.views):
            print(f"wrote {path} ({time.time() - t0:.0f}s elapsed)")


if __name__ == "__main__":
    main()
