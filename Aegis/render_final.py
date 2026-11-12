"""Final renders.  python3 render_final.py [stills|anim|test] [names...]
Renders from aegis_dragon.blend if it exists, otherwise builds the scene first."""
import os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bpy
from aegis import render

mode = sys.argv[1] if len(sys.argv) > 1 else "stills"
names = sys.argv[2:]
blend = os.path.join(HERE, "aegis_dragon.blend")
if os.path.exists(blend) and not os.environ.get("REBUILD"):
    bpy.ops.wm.open_mainfile(filepath=blend)
else:
    import build as B
    B.build(6)
scene = bpy.context.scene
cam = {k: bpy.data.objects["CAM_" + v] for k, v in (("hero", "hero"), ("head", "head"), ("reactor", "reactor"),
                                                    ("wings", "wings"), ("cine", "cinematic"))}
STILLS = {"hero": ("hero", 264, "01_hero.png"), "head": ("head", 150, "02_head_closeup.png"),
          "reactor": ("reactor", 264, "03_chest_reactor.png"), "wings": ("wings", 218, "04_full_body_wings_extended.png"),
          "dormant": ("hero", 1, "05_dormant.png")}
out = os.path.join(HERE, "renders")
if mode == "test":
    render.setup_cycles(scene, res=(960, 540), samples=int(os.environ.get("SPP", 24)))
    for n in names or STILLS:
        c, f, fn = STILLS[n]
        t = time.time()
        render.still(scene, cam[c], os.path.join(HERE, "previews", "test_" + fn), frame=int(os.environ.get("FRAME", f)))
        print("TEST %s %.0fs" % (n, time.time() - t))
elif mode == "stills":
    render.setup_cycles(scene, res=(1920, 1080), samples=int(os.environ.get("SPP", 160)))
    for n in names or STILLS:
        c, f, fn = STILLS[n]
        t = time.time()
        render.still(scene, cam[c], os.path.join(out, fn), frame=f)
        print("STILL %s %.0fs" % (n, time.time() - t))
elif mode == "anim":
    render.setup_cycles(scene, res=(768, 432), samples=int(os.environ.get("SPP", 16)))
    scene.cycles.adaptive_threshold = 0.08
    scene.camera = cam["cine"]
    a = int(names[0]) if names else scene.frame_start
    b = int(names[1]) if len(names) > 1 else scene.frame_end
    for f in range(a, b + 1):
        path = os.path.join(out, "frames", "aegis_%04d.png" % f)
        if os.path.exists(path):
            continue
        t = time.time()
        render.still(scene, cam["cine"], path, frame=f)
        print("FRAME %d %.0fs" % (f, time.time() - t), flush=True)
