"""ATLAS-09 industrial mech generator (thin entry point).

Run headless with the pip ``bpy`` module or with a Blender binary:

    python generate_mech.py [options]
    blender -b --python generate_mech.py -- [options]

Every run deletes the generated collections, purges orphan data and rebuilds, so reruns never
duplicate objects.
"""

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def parse(argv):
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = argv[1:]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--milestone", type=int, default=9, help="build up to this milestone (1-9)")
    ap.add_argument("--save", default=os.path.join(HERE, "ATLAS-09.blend"), help=".blend output ('' = don't save)")
    ap.add_argument("--sheet", default="", help="render a QC contact sheet to this PNG")
    ap.add_argument("--sheet-samples", type=int, default=24)
    ap.add_argument("--pose", default="Neutral", help="action to show: Neutral, Demo or rest")
    ap.add_argument("--render", default="none", choices=["none", "preview", "final"],
                    help="render the presentation cameras into renders/")
    ap.add_argument("--samples", type=int, default=0, help="override render samples")
    ap.add_argument("--only", default="", help="comma list of presentation cameras to render")
    ap.add_argument("--no-validate", action="store_true")
    return ap.parse_args(argv)


def main():
    args = parse(sys.argv)
    import mech
    mech.run(args, HERE)


if __name__ == "__main__":
    main()
