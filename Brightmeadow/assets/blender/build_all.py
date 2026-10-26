"""Build every model group, then write game/assets/models/manifest.json.

    python assets/blender/build_all.py [--only explorer coin ...] [--no-blend]
    blender -b --python assets/blender/build_all.py -- [...]

Deterministic: fixed seeds everywhere, no timestamps in the outputs; safe to re-run.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import common  # noqa: E402
import export  # noqa: E402
import gen_character  # noqa: E402
import gen_decor  # noqa: E402
import gen_enemies  # noqa: E402
import gen_pickups  # noqa: E402
import gen_terrain  # noqa: E402

GROUPS = [
    ("character", lambda out, save, only: gen_character.build(out, save=save)
     if not only or "explorer" in only else []),
    ("enemies", gen_enemies.build),
    ("pickups", gen_pickups.build),
    ("terrain", gen_terrain.build),
    ("decor", gen_decor.build),
]


def main():
    args = common.parse_args("Build all Brightmeadow models")
    t0 = time.time()
    os.makedirs(args.out, exist_ok=True)
    for group, fn in GROUPS:
        t = time.time()
        paths = fn(args.out, not args.no_blend, args.only)
        print(f"[{group}] {len(paths)} file(s) in {time.time() - t:.1f}s", flush=True)
    path, data = export.write_manifest(args.out)
    print(f"manifest: {path} ({len(data)} models)")
    print(f"build_all done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
