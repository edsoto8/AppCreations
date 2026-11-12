import os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy, build as B
from aegis import render, animation
from aegis.geo import get_coll
ctx = B.build(5, env=False); scene = ctx["scene"]
ok, lines = animation.validate(ctx, step=6); print("\n".join(lines))
if len(sys.argv) > 1:
    render.setup_cycles(scene, res=(800, 450), samples=10)
    render.studio(scene, get_coll("Preview"))
    cams = {"a": render.camera(scene, "a", (-15, -19, 7), (0, -1, 4), 30), "s": render.camera(scene, "s", (-28, 1, 5), (0, 1.5, 4), 38),
            "t": render.camera(scene, "t", (0, 1.5, 36), (0, 1.5, 0), 35)}
    for spec in sys.argv[1:]:
        f, v = spec.split(":")
        render.still(scene, cams[v], os.path.join(HERE, "previews", "pose_%s_%s.png" % (f, v)), frame=int(f))
