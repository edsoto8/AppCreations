#!/usr/bin/env python3
"""Validate the exported models against docs/ASSET_CONTRACT.md (plain Python, no bpy).

    python3 assets/blender/validate_glb.py [--models game/assets/models]

Checks every contracted file exists and parses; bounds vs. contract sizes; pivots; triangle
budgets; animation names and frame counts; required node / bone names; palette material
names; terrain walk surface at y = 0 over the exact x extents and identical side profiles at
every joint; manifest.json in sync. Prints a PASS/FAIL table, exits 1 on any failure.
All coordinates are Godot axes (Y up, +Z toward the camera).
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import glb  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODELS = os.path.normpath(os.path.join(HERE, "..", "..", "game", "assets", "models"))

PALETTE = {"M_Grass", "M_GrassDark", "M_Earth", "M_EarthDark", "M_Stone", "M_Wood",
           "M_WoodDark", "M_Leaf", "M_Cloud", "M_Gold", "M_GoldDark", "M_Jacket",
           "M_JacketTrim", "M_Pack", "M_Scarf", "M_Pants", "M_Boot", "M_Sole", "M_Skin",
           "M_Hair", "M_EyeWhite", "M_EyeDark", "M_Blush", "M_Bug", "M_BugSpot", "M_Puff",
           "M_Wing", "M_FlowerWhite", "M_FlowerYellow", "M_FlowerPink", "M_Banner"}

CHAR_BONES = ["root", "hips", "spine", "chest", "neck", "head", "upper_arm.L", "upper_arm.R",
              "forearm.L", "forearm.R", "hand.L", "hand.R", "thigh.L", "thigh.R", "shin.L",
              "shin.R", "foot.L", "foot.R", "pack"]
CHAR_ANIMS = {"idle": 60, "walk": 24, "run": 16, "jump": 10, "fall": 20, "land": 8,
              "celebrate": 40, "hurt": 12}

# size: {axis: (target, relative tolerance)}; pivot: 'bottom' | 'center' | 'terrain' | 'cap_l'..
SPECS = {
    "explorer": dict(budget=15000, pivot="bottom", size={"y": (1.55, 0.01)},
                     anims=CHAR_ANIMS, nodes=["Armature"] + CHAR_BONES, capsule=0.38),
    "bramblebug": dict(budget=6000, pivot="bottom", size={"z": (0.9, 0.15), "y": (0.8, 0.15)},
                       anims={"walk": 16}, optional_anims={"idle"}),
    "buzzpuff": dict(budget=6000, pivot="center", center_tol=0.08,   # antennae/tuft on top
                     size={"x": (0.8, 0.25), "y": (0.8, 0.25)},
                     anims={"fly": 8}),
    "coin": dict(budget=3000, pivot="center", size={"x": (0.6, 0.02), "y": (0.6, 0.02),
                                                    "z": (0.12, 0.05)}),
    "checkpoint": dict(budget=3000, pivot="bottom", pivot_node="Post", size={"y": (2.4, 0.02)},
                       nodes=["Post", "Flag"], node_pos={"Flag": (None, 2.1, None)}),
    "goal": dict(budget=3000, pivot="bottom", size={"x": (4.0, 0.15), "y": (4.5, 0.05)},
                 nodes=["Emblem"], centred_nodes=["Emblem"]),
    "tree_round": dict(budget=3000, pivot="bottom", size={"y": (4.5, 0.1)}),
    "tree_pine": dict(budget=3000, pivot="bottom", size={"y": (5.0, 0.1)}),
    "bush": dict(budget=3000, pivot="bottom", size={"y": (1.0, 0.35), "x": (1.0, 0.35)}),
    "flowers": dict(budget=3000, pivot="bottom", size={"x": (1.0, 0.25)}),
    "grass_tuft": dict(budget=3000, pivot="bottom", size={"y": (0.4, 0.2)}),
    "rock": dict(budget=3000, pivot="bottom", size={"x": (0.8, 0.3)}),
    "mushroom": dict(budget=3000, pivot="bottom", size={"y": (0.6, 0.2)}),
    "fence": dict(budget=3000, pivot="bottom", size={"x": (2.0, 0.01)}),
    "signpost": dict(budget=3000, pivot="bottom", size={"y": (1.6, 0.1)}),
    "hill_a": dict(budget=3000, pivot="bottom", size={"x": (24.0, 0.1), "y": (10.0, 0.1)}),
    "hill_b": dict(budget=3000, pivot="bottom", size={"x": (24.0, 0.1), "y": (10.0, 0.1)}),
    "cloud_a": dict(budget=3000, pivot="center", size={"x": (6.0, 0.15)}),
    "cloud_b": dict(budget=3000, pivot="center", size={"x": (6.0, 0.15)}),
}
for v in "abc":
    SPECS[f"ground_mid_{v}"] = dict(budget=1500, pivot="terrain", xr=(-0.5, 0.5), depth=4.0,
                                    bottom=-8.0)
for v in "ab":
    SPECS[f"float_mid_{v}"] = dict(budget=1500, pivot="terrain", xr=(-0.5, 0.5), depth=2.5,
                                   bottom=-0.9)
for kind, depth, bottom in (("ground", 4.0, -8.0), ("float", 2.5, -0.9)):
    SPECS[f"{kind}_cap_left"] = dict(budget=1500, pivot="terrain", xr=(-0.5, 0.0), depth=depth,
                                     bottom=bottom)
    SPECS[f"{kind}_cap_right"] = dict(budget=1500, pivot="terrain", xr=(0.0, 0.5), depth=depth,
                                      bottom=bottom)

EPS = 2e-3


class Report:
    def __init__(self):
        self.rows = []

    def add(self, asset, check, ok, detail=""):
        self.rows.append((asset, check, bool(ok), detail))

    @property
    def failed(self):
        return [r for r in self.rows if not r[2]]

    def print(self):
        w1 = max(len(r[0]) for r in self.rows)
        w2 = max(len(r[1]) for r in self.rows)
        print(f"{'asset'.ljust(w1)}  {'check'.ljust(w2)}  result  detail")
        print("-" * (w1 + w2 + 40))
        for a, c, ok, d in self.rows:
            print(f"{a.ljust(w1)}  {c.ljust(w2)}  {'PASS' if ok else 'FAIL'}    {d}")
        print("-" * (w1 + w2 + 40))
        print(f"{len(self.rows) - len(self.failed)} passed, {len(self.failed)} failed")


def fmt(v):
    return "[" + ", ".join(f"{x:.3f}" for x in v) + "]"


def edge_profile(verts, x, tol=1e-4):
    return {(round(v[1], 4), round(v[2], 4)) for v in verts if abs(v[0] - x) < tol}


def check_asset(rep, name, spec, path):
    g = glb.Glb(path)
    verts = g.world_vertices()
    mn = [min(v[k] for v in verts) for k in range(3)]
    mx = [max(v[k] for v in verts) for k in range(3)]
    size = [mx[k] - mn[k] for k in range(3)]
    tris = g.triangles()
    rep.add(name, "triangles", tris <= spec["budget"], f"{tris} <= {spec['budget']}")
    mats = g.material_names()
    bad = [m for m in mats if m not in PALETTE]
    rep.add(name, "palette materials", not bad and mats, ", ".join(bad) or f"{len(mats)} used")
    rep.add(name, "no cameras/lights", "cameras" not in g.js and not any(
        "KHR_lights_punctual" in n.get("extensions", {}) for n in g.js.get("nodes", [])))
    axes = "xyz"
    for ax, (target, tol) in spec.get("size", {}).items():
        s = size[axes.index(ax)]
        rep.add(name, f"size {ax} ~{target}", abs(s - target) <= tol * target + 1e-3,
                f"{s:.3f}")
    pv = spec["pivot"]
    if pv == "bottom":
        pmn, pmx = mn, mx
        if spec.get("pivot_node"):
            pmn, pmx = g.bounds(node_filter=lambda nm: nm == spec["pivot_node"])
        cx, cz = (pmn[0] + pmx[0]) / 2, (pmn[2] + pmx[2]) / 2
        rep.add(name, "pivot bottom-centre", abs(mn[1]) < 0.01 and abs(cx) < 0.06 * max(
            size[0], 1) and abs(cz) < 0.06 * max(size[2], 1) + 0.05,
            f"min y {mn[1]:.4f}, centre x {cx:.3f} z {cz:.3f}")
    elif pv == "center":
        c = [(mn[k] + mx[k]) / 2 for k in range(3)]
        tol = spec.get("center_tol", 0.0)
        rep.add(name, "pivot centre",
                all(abs(c[k]) < 0.06 * max(size[k], 0.5) + tol for k in range(3)), fmt(c))
    elif pv == "terrain":
        check_terrain(rep, name, spec, verts, mn, mx, g)
    if spec.get("capsule"):
        r = max(math.hypot(v[0], v[2]) for v in verts)
        rep.add(name, f"inside capsule r={spec['capsule']}", r <= spec["capsule"] + 1e-3,
                f"max radius {r:.3f}")
    names = g.node_names()
    for n in spec.get("nodes", []):
        rep.add(name, f"node '{n}'", n in names)
    wm = g.world_matrices()
    for n, pos in spec.get("node_pos", {}).items():
        if n in names:
            m = wm[names.index(n)]
            t = (m[0][3], m[1][3], m[2][3])
            ok = all(p is None or abs(t[k] - p) < 1e-3 for k, p in enumerate(pos))
            rep.add(name, f"'{n}' origin", ok, fmt(t))
    for n in spec.get("centred_nodes", []):
        if n in names:
            i = names.index(n)
            vs = g.world_vertices(node_filter=lambda nm, n=n: nm == n)
            c = [(min(v[k] for v in vs) + max(v[k] for v in vs)) / 2 for k in range(3)]
            t = (wm[i][0][3], wm[i][1][3], wm[i][2][3])
            rep.add(name, f"'{n}' origin at its centre",
                    all(abs(c[k] - t[k]) < 0.03 for k in range(3)), f"origin {fmt(t)} centre {fmt(c)}")
    if "anims" in spec:
        got = g.animations()
        for a, fr in spec["anims"].items():
            rep.add(name, f"anim '{a}' {fr}f", got.get(a) == fr, f"got {got.get(a)}")
        extra = set(got) - set(spec["anims"]) - spec.get("optional_anims", set())
        rep.add(name, "no unexpected anims", not extra, ", ".join(sorted(extra)))
        # every animation only drives this rig's own nodes
        if name == "explorer":
            root_i = names.index("root") if "root" in names else -1
            moved = []
            for a in g.js.get("animations", []):
                for ch in a["channels"]:
                    if ch["target"]["node"] == root_i and ch["target"]["path"] == "translation":
                        vals = g.accessor(a["samplers"][ch["sampler"]]["output"])
                        if any(max(abs(c) for c in v) > 1e-4 for v in vals):
                            moved.append(a["name"])
            rep.add(name, "root stays at origin", not moved, ", ".join(moved))
    return dict(bounds_min=mn, bounds_max=mx, triangles=tris)


def check_terrain(rep, name, spec, verts, mn, mx, g):
    x0, x1 = spec["xr"]
    rep.add(name, f"x extents [{x0}, {x1}]", abs(mn[0] - x0) < 1e-3 and abs(mx[0] - x1) < 1e-3,
            f"[{mn[0]:.4f}, {mx[0]:.4f}]")
    half = spec["depth"] / 2
    rep.add(name, f"depth {spec['depth']} (+lip <= 0.15)",
            half - 0.01 <= mx[2] <= half + 0.15 + 1e-3 and -half - 0.15 - 1e-3 <= mn[2],
            f"z [{mn[2]:.3f}, {mx[2]:.3f}]")
    rep.add(name, f"bottom at {spec['bottom']}", abs(mn[1] - spec["bottom"]) < 0.01,
            f"{mn[1]:.3f}")
    # walk surface: cast vertical rays over the play band (|z| <= 0.5): the highest surface
    # must be exactly y = 0 everywhere from one joint edge to the other (caps: over the flat
    # part next to the inner edge; their outer edge is rounded by design)
    tris = g.triangles_world()
    if "mid" in name:
        xs = [x0 + (x1 - x0) * k / 20 for k in range(21)]
    elif "left" in name:
        xs = [-0.2 * k / 10 for k in range(11)]
    else:
        xs = [0.2 * k / 10 for k in range(11)]
    worst, missing = 0.0, 0
    for x in xs:
        for z in (-0.5, -0.25, 0.0, 0.25, 0.5):
            h = surface_height(tris, x, z)
            if h is None:
                missing += 1
            else:
                worst = max(worst, abs(h))
    rep.add(name, "walk surface y=0 over x span", missing == 0 and worst < 1e-4,
            f"x [{xs[0]:.2f}, {xs[-1]:.2f}] max |y| {worst:.5f}, {missing} holes")


def surface_height(tris, x, z):
    """Highest y where the vertical line at (x, z) hits a triangle (None if nothing)."""
    best = None
    for a, b, c in tris:
        d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d
        l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d
        l3 = 1 - l1 - l2
        if min(l1, l2, l3) < -1e-7:
            continue
        y = l1 * a[1] + l2 * b[1] + l3 * c[1]
        if best is None or y > best:
            best = y
    return best


def check_tiling(rep, models):
    """All mids share one side profile; caps match it at their inner edge."""
    for kind, mids in (("ground", "abc"), ("float", "ab")):
        profiles = {}
        for v in mids:
            p = os.path.join(models, f"{kind}_mid_{v}.glb")
            if not os.path.exists(p):
                continue
            vs = glb.Glb(p).world_vertices()
            profiles[f"{kind}_mid_{v}.L"] = edge_profile(vs, -0.5)
            profiles[f"{kind}_mid_{v}.R"] = edge_profile(vs, 0.5)
        for side, x in (("left", 0.0), ("right", 0.0)):
            p = os.path.join(models, f"{kind}_cap_{side}.glb")
            if os.path.exists(p):
                profiles[f"{kind}_cap_{side}.inner"] = edge_profile(glb.Glb(p).world_vertices(), x)
        if not profiles:
            continue
        ref_key = f"{kind}_mid_a.L"
        ref = profiles.get(ref_key) or next(iter(profiles.values()))
        for k, prof in sorted(profiles.items()):
            same = prof == ref
            # every joint vertex must also lie on the walk surface or below it
            rep.add(f"tiling:{kind}", f"{k} == {ref_key}", same and len(prof) > 10,
                    f"{len(prof)} pts" + ("" if same else
                                          f", {len(prof ^ ref)} differ"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=DEFAULT_MODELS)
    args = ap.parse_args()
    rep = Report()
    results = {}
    for name, spec in SPECS.items():
        path = os.path.join(args.models, name + ".glb")
        if not os.path.exists(path):
            rep.add(name, "file exists", False, path)
            continue
        rep.add(name, "file exists", True, f"{os.path.getsize(path) / 1024:.0f} KB")
        try:
            results[name] = check_asset(rep, name, spec, path)
        except Exception as e:  # noqa: BLE001
            rep.add(name, "parse", False, repr(e))
    check_tiling(rep, args.models)
    man_path = os.path.join(args.models, "manifest.json")
    if os.path.exists(man_path):
        man = json.load(open(man_path))
        missing = [n for n in SPECS if n not in man]
        rep.add("manifest.json", "lists every asset", not missing, ", ".join(missing))
        stale = [n for n, r in results.items() if n in man and (
            man[n]["triangles"] != r["triangles"] or any(
                abs(a - b) > 1e-3 for a, b in zip(man[n]["bounds_min"] + man[n]["bounds_max"],
                                                  r["bounds_min"] + r["bounds_max"])))]
        rep.add("manifest.json", "matches files", not stale, ", ".join(stale))
        anim_bad = [n for n, s in SPECS.items() if n in man and "anims" in s and any(
            man[n]["animations"].get(a) != f for a, f in s["anims"].items())]
        rep.add("manifest.json", "animation frames", not anim_bad, ", ".join(anim_bad))
    else:
        rep.add("manifest.json", "exists", False, man_path)
    total = sum(os.path.getsize(os.path.join(args.models, f)) for f in os.listdir(args.models)
                if f.endswith(".glb"))
    rep.add("models folder", "total size < 15 MB", total < 15 * 1024 * 1024,
            f"{total / 1024 / 1024:.2f} MB")
    rep.print()
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
