"""ATLAS-09 generator package. ``run(args, root_dir)`` performs one full, idempotent build."""

import json
import os
import time

import bpy

from . import utils as U


def build(milestone=9):
    from . import materials, qc

    U.purge_generated()
    U.seed_all()
    t0 = time.time()
    mats = materials.build(full=milestone >= 6)
    ctx = {"mats": mats, "milestone": milestone, "parts": {}}
    if milestone <= 1:
        from . import blockout
        ctx["parts"]["Blockout"] = blockout.build(mats)
    else:
        from . import parts_arms, parts_head, parts_legs, parts_torso
        parts_torso.build(ctx)
        parts_head.build(ctx)
        for side in ("L", "R"):
            parts_legs.build(ctx, side)
            parts_arms.build(ctx, side)
        if milestone >= 5:
            from . import cables
            cables.build(ctx)
    if milestone >= 2:
        from . import rig
        ctx["rig"] = rig.build(ctx, actions=milestone >= 7)
    if milestone >= 8:
        from . import scene
        scene.build(ctx)
    else:
        qc.preview_lights()
    U.log("INFO", f"build to milestone {milestone} took {time.time() - t0:.1f}s")
    return ctx


def run(args, root_dir):
    from . import qc

    ctx = build(args.milestone)
    if "rig" in ctx and args.pose:
        from . import rig
        rig.set_pose(ctx["rig"], args.pose)
    report = {"milestone": args.milestone, "blender": bpy.app.version_string}
    if not args.no_validate:
        report.update(validate(ctx))
    report["counts"] = qc.count_report()
    report["log"] = U.LOG
    rep_path = os.path.join(root_dir, "build_report.json")
    with open(rep_path, "w") as f:
        json.dump(report, f, indent=1, default=str)
    print(json.dumps({k: v for k, v in report.items() if k != "log"}, indent=1, default=str))
    if args.save:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save), compress=True)
        print("saved", args.save)
    if args.sheet:
        qc.contact_sheet(args.sheet, samples=args.sheet_samples)
        print("sheet", args.sheet)
    if args.render != "none":
        from . import scene
        scene.render_all(root_dir, args.render, args.samples,
                         [c for c in args.only.split(",") if c], ctx)


def validate(ctx):
    from . import qc

    root = bpy.data.collections[U.ROOT_COLL]
    objs = [o for o in root.all_objects if o.type in {"MESH", "CURVE", "FONT"}]
    robot = [o for o in objs if not any(c.name.endswith(("_Scene", "_QC")) for c in o.users_collection)]
    mesh_rep = U.validate_meshes([o for o in robot if not o.get("fastener")],
                                 allow_open=("Cable", "Decal", "Label"))
    anchors = {o.name for o in robot if o.get("ground_anchor")}
    floating = U.connectivity_check(robot, anchors) if anchors else []
    for n in floating:
        U.log("FLOAT", "not connected to the structure", n)
    out = {"mesh_checked": mesh_rep["checked"], "mesh_problems": len(mesh_rep["problems"]),
           "floating": floating, "objects_robot": len(robot)}
    if "rig" in ctx:
        from . import rig
        out["intersections"] = rig.intersection_report(ctx)
    return out
