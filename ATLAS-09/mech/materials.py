"""PBR materials built from shader nodes.

``build(full=False)`` gives flat blockout shading (milestones 1-5). ``build(full=True)`` gives the
procedural set: edge wear from a Bevel-node edge mask, AO-driven grime, noise roughness and
scratches. Every procedural texture is offset by values from a fixed seed, so reruns match.
"""

import bpy

from . import utils as U

# key: (base color, metallic, roughness)
FLAT = {
    "armor":       ((0.80, 0.48, 0.04), 0.0, 0.45),
    "armor_dark":  ((0.08, 0.085, 0.09), 0.2, 0.5),
    "steel_dark":  ((0.12, 0.125, 0.13), 0.8, 0.45),
    "titanium":    ((0.55, 0.56, 0.58), 1.0, 0.32),
    "chrome":      ((0.9, 0.9, 0.92), 1.0, 0.06),
    "rubber":      ((0.02, 0.02, 0.022), 0.0, 0.8),
    "hose":        ((0.025, 0.025, 0.028), 0.0, 0.6),
    "cable_orange": ((0.9, 0.25, 0.02), 0.0, 0.5),
    "cable_red":   ((0.5, 0.03, 0.02), 0.0, 0.5),
    "grease":      ((0.03, 0.025, 0.015), 0.4, 0.25),
    "weld":        ((0.25, 0.22, 0.2), 1.0, 0.55),
    "bolt":        ((0.35, 0.35, 0.36), 1.0, 0.4),
    "carbon":      ((0.03, 0.03, 0.035), 0.0, 0.3),
    "emit_blue":   ((0.1, 0.5, 1.0), 0.0, 0.3),
    "emit_amber":  ((1.0, 0.45, 0.05), 0.0, 0.3),
    "led_red":     ((1.0, 0.05, 0.02), 0.0, 0.3),
    "led_green":   ((0.1, 1.0, 0.2), 0.0, 0.3),
    "glass":       ((0.6, 0.7, 0.8), 0.0, 0.02),
    "lens_inner":  ((0.01, 0.02, 0.03), 0.5, 0.15),
    "hazard":      ((0.85, 0.6, 0.02), 0.0, 0.5),
    "decal_white": ((0.85, 0.85, 0.82), 0.0, 0.5),
    "decal_black": ((0.02, 0.02, 0.02), 0.0, 0.5),
    "concrete":    ((0.35, 0.34, 0.32), 0.0, 0.85),
    "floor_paint": ((0.85, 0.65, 0.05), 0.0, 0.6),
    "spring":      ((0.75, 0.08, 0.04), 0.3, 0.35),
    "copper":      ((0.8, 0.45, 0.3), 1.0, 0.35),
}
EMISSIVE = {"emit_blue": 12.0, "emit_amber": 8.0, "led_red": 10.0, "led_green": 10.0}


def _new(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def _principled(m):
    nt = m.node_tree
    return next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")


def build_flat():
    mats = {}
    for key, (col, met, rough) in FLAT.items():
        m = _new(f"M_{key}")
        b = _principled(m)
        b.inputs["Base Color"].default_value = (*col, 1.0)
        b.inputs["Metallic"].default_value = met
        b.inputs["Roughness"].default_value = rough
        m.diffuse_color = (*col, 1.0)
        if key in EMISSIVE:
            b.inputs["Emission Color"].default_value = (*col, 1.0)
            b.inputs["Emission Strength"].default_value = EMISSIVE[key]
        if key == "glass":
            b.inputs["Transmission Weight"].default_value = 1.0
            b.inputs["IOR"].default_value = 1.5
        mats[key] = m
    return mats


def build(full=False):
    if not full:
        return build_flat()
    from . import materials_pbr
    return materials_pbr.build()
