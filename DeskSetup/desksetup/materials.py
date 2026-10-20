"""Physically based material library.

Each public function returns a cached material, so components can ask for "walnut" or
"aluminum_silver" freely without duplicating node trees. Colours are linear RGB; reference
values come from measured albedo/F0 data (anodised aluminium F0 ~0.9, black powder coat albedo
~0.015, white paint ~0.75).

All textures are procedural (no image files), so the project has no external assets.
"""

from __future__ import annotations

import bpy

# --------------------------------------------------------------------------- node helpers


class Graph:
    """Small wrapper that keeps node-tree code readable."""

    def __init__(self, material: bpy.types.Material):
        self.nt = material.node_tree
        self.nt.nodes.clear()
        self.out = self.node("ShaderNodeOutputMaterial", x=600)
        self._x = 0

    def node(self, kind: str, x: float | None = None, y: float = 0, **props):
        n = self.nt.nodes.new(kind)
        if x is None:
            self._x -= 220
            x = self._x
        n.location = (x, y)
        for key, value in props.items():
            if key in n.inputs:
                n.inputs[key].default_value = value
            else:
                setattr(n, key, value)
        return n

    def link(self, src, dst, src_socket=0, dst_socket=0):
        out = src.outputs[src_socket] if not isinstance(src, bpy.types.NodeSocket) else src
        self.nt.links.new(out, dst.inputs[dst_socket])
        return dst

    def math(self, op: str, a, b=None, clamp: bool = False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, val in enumerate((a, b)):
            if val is None:
                continue
            if isinstance(val, (int, float)):
                n.inputs[i].default_value = val
            else:
                self.link(val, n, dst_socket=i)
        return n

    def ramp(self, src, stops: list[tuple[float, tuple[float, float, float, float]]], src_socket=0,
             interpolation: str = "LINEAR"):
        n = self.node("ShaderNodeValToRGB")
        cr = n.color_ramp
        cr.interpolation = interpolation
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = col
        self.link(src, n, src_socket=src_socket)
        return n

    def bsdf(self, **inputs):
        p = self.node("ShaderNodeBsdfPrincipled", x=300)
        for key, val in inputs.items():
            p.inputs[key].default_value = val
        self.link(p, self.out)
        return p


def _get(name: str):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat, None
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:  # Blender < 5 still needs use_nodes
        mat.use_nodes = True
    return mat, Graph(mat)


def rgba(r: float, g: float, b: float, a: float = 1.0):
    return (r, g, b, a)


def _micro_bump(g: Graph, bsdf, scale: float, strength: float, distance: float = 0.0002, coords=None):
    noise = g.node("ShaderNodeTexNoise", Scale=scale, Detail=4.0, Roughness=0.6)
    if coords is not None:
        g.link(coords, noise)
    bump = g.node("ShaderNodeBump", Strength=strength, Distance=distance)
    g.link(noise, bump, dst_socket="Height")
    g.link(bump, bsdf, dst_socket="Normal")
    return bump


# --------------------------------------------------------------------------- wood


def walnut(board_width_mm: float = 150.0):
    """Oiled black-walnut slab built from glued-up boards running along X.

    Tree rings are cylinders along X (Wave/Rings, direction X), sliced at a slight angle so flat-sawn
    "cathedral" figure appears. Each board gets its own ring centre, tone and grain offset from a
    white-noise lookup on its board index. Elongated noise adds open pores, which also drive the
    bump and a little extra roughness.
    """
    mat, g = _get("Walnut")
    if g is None:
        return mat
    tc = g.node("ShaderNodeTexCoord")
    sep = g.node("ShaderNodeSeparateXYZ")
    g.link(tc, sep, src_socket="Object")

    board = g.math("FLOOR", g.math("DIVIDE", sep.outputs["Y"], board_width_mm / 1000.0))
    rnd1 = g.node("ShaderNodeTexWhiteNoise", noise_dimensions="1D")
    g.link(board, rnd1, dst_socket="W")
    rnd2 = g.node("ShaderNodeTexWhiteNoise", noise_dimensions="1D")
    g.link(g.math("ADD", board, 17.3), rnd2, dst_socket="W")

    # Ring coordinates: log axis along X, centre below/beside each board, slight dive along X.
    ry = g.math("ADD", sep.outputs["Y"], g.math("MULTIPLY", g.math("SUBTRACT", rnd1.outputs["Value"], 0.5), 0.09))
    rz = g.math("ADD", sep.outputs["Z"], g.math("ADD", 0.035, g.math("MULTIPLY", rnd2.outputs["Value"], 0.05)))
    dive = g.math("MULTIPLY", g.math("SUBTRACT", rnd2.outputs["Value"], 0.5), 0.16)  # log axis vs board angle
    rz = g.math("ADD", rz, g.math("MULTIPLY", sep.outputs["X"], dive))
    comb = g.node("ShaderNodeCombineXYZ")
    g.link(sep, comb, src_socket="X", dst_socket="X")
    g.link(ry, comb, dst_socket="Y")
    g.link(rz, comb, dst_socket="Z")

    # Gentle, long-wavelength wander of the grain (stretched along the board), not wiggles.
    stretch = g.node("ShaderNodeMapping")
    stretch.inputs["Scale"].default_value = (0.25, 1.0, 1.0)
    g.link(comb, stretch)
    warp = g.node("ShaderNodeTexNoise", Scale=3.0, Detail=2.0, Roughness=0.5)
    g.link(stretch, warp)
    centred = g.node("ShaderNodeVectorMath", operation="SUBTRACT")
    g.link(warp, centred, src_socket="Color")
    centred.inputs[1].default_value = (0.5, 0.5, 0.5)
    warp_vec = g.node("ShaderNodeVectorMath", operation="SCALE")
    g.link(centred, warp_vec)
    warp_vec.inputs["Scale"].default_value = 0.012
    warped = g.node("ShaderNodeVectorMath", operation="ADD")
    g.link(comb, warped)
    g.link(warp_vec, warped, dst_socket=1)

    rings = g.node("ShaderNodeTexWave", wave_type="RINGS", rings_direction="X", wave_profile="SIN",
                   Scale=38.0, Distortion=0.8, Detail=2.0, **{"Detail Scale": 0.8, "Detail Roughness": 0.5})
    g.link(warped, rings)
    rings.inputs["Phase Offset"].default_value = 0.0
    g.link(g.math("MULTIPLY", rnd2.outputs["Value"], 30.0), rings, dst_socket="Phase Offset")

    # Late wood is darker: sharpen the ring profile a little.
    ring_val = g.math("POWER", rings.outputs["Fac"], 1.6)

    # Large-scale figure: tone drifts slowly along each board.
    drift = g.node("ShaderNodeTexNoise", Scale=2.2, Detail=2.0)
    g.link(tc, drift, src_socket="Object")

    tone = g.math("ADD", g.math("MULTIPLY", ring_val, 0.42), g.math("MULTIPLY", drift.outputs["Fac"], 0.58))
    color = g.ramp(tone, [
        (0.0, rgba(0.040, 0.019, 0.010)),
        (0.30, rgba(0.095, 0.047, 0.024)),
        (0.60, rgba(0.165, 0.086, 0.044)),
        (1.0, rgba(0.245, 0.135, 0.068)),
    ])

    # Per-board tone and warmth variation.
    hsv = g.node("ShaderNodeHueSaturation", Saturation=0.88)
    g.link(color, hsv, dst_socket="Color")
    g.link(g.math("ADD", 0.82, g.math("MULTIPLY", rnd1.outputs["Value"], 0.36)), hsv, dst_socket="Value")
    g.link(g.math("ADD", 0.49, g.math("MULTIPLY", rnd2.outputs["Value"], 0.02)), hsv, dst_socket="Hue")

    # Pores: long thin dashes along the grain.
    pore_map = g.node("ShaderNodeMapping")
    g.link(tc, pore_map, src_socket="Object")
    pore_map.inputs["Scale"].default_value = (18.0, 700.0, 700.0)
    pores = g.node("ShaderNodeTexNoise", Scale=1.0, Detail=1.0, Roughness=0.4)
    g.link(pore_map, pores)
    pore_mask = g.ramp(pores, [(0.0, rgba(1, 1, 1)), (0.30, rgba(1, 1, 1)), (0.36, rgba(0, 0, 0)), (1.0, rgba(0, 0, 0))])
    pore_mask = g.math("SUBTRACT", 1.0, pore_mask)  # 1 inside a pore

    darken = g.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    g.link(pore_mask, darken, dst_socket=0)
    g.link(hsv, darken, dst_socket=6)
    darken.inputs[7].default_value = rgba(0.55, 0.5, 0.48)

    # Faint glue line at each board joint.
    frac = g.math("FRACT", g.math("DIVIDE", sep.outputs["Y"], board_width_mm / 1000.0))
    edge = g.math("MINIMUM", frac, g.math("SUBTRACT", 1.0, frac))
    seam = g.math("LESS_THAN", edge, 0.0035)
    seamed = g.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    g.link(g.math("MULTIPLY", seam, 0.6), seamed, dst_socket=0)
    g.link(darken, seamed, dst_socket=6, src_socket=2)
    seamed.inputs[7].default_value = rgba(0.6, 0.55, 0.5)

    bsdf = g.bsdf(**{"Roughness": 0.40, "Coat Weight": 0.18, "Coat Roughness": 0.22, "Specular IOR Level": 0.5})
    g.link(seamed, bsdf, src_socket=2, dst_socket="Base Color")
    g.link(g.math("ADD", 0.38, g.math("MULTIPLY", pore_mask, 0.25)), bsdf, dst_socket="Roughness")

    bump_h = g.math("ADD", g.math("MULTIPLY", pore_mask, -1.0), g.math("MULTIPLY", ring_val, 0.25))
    bump = g.node("ShaderNodeBump", Strength=0.12, Distance=0.0004)
    g.link(bump_h, bump, dst_socket="Height")
    g.link(bump, bsdf, dst_socket="Normal")
    return mat


# --------------------------------------------------------------------------- metals


ALUMINUM_FINISHES = {
    # name: (F0 colour, roughness)
    "silver": ((0.80, 0.81, 0.82), 0.30),  # bead-blasted anodised, MacBook silver
    "space_gray": ((0.30, 0.30, 0.31), 0.32),
    "brushed": ((0.84, 0.85, 0.86), 0.22),  # monitor arm
    "black": ((0.035, 0.035, 0.037), 0.35),  # black anodised
}


def aluminum(finish: str = "silver"):
    """Anodised aluminium. Fine noise varies the roughness so highlights break up like the real
    bead-blasted surface instead of looking like chrome."""
    base, rough = ALUMINUM_FINISHES[finish]
    mat, g = _get(f"Aluminum_{finish}")
    if g is None:
        return mat
    bsdf = g.bsdf(**{"Base Color": rgba(*base), "Metallic": 1.0, "Roughness": rough})
    tc = g.node("ShaderNodeTexCoord")
    noise = g.node("ShaderNodeTexNoise", Scale=900.0, Detail=2.0)
    g.link(tc, noise, src_socket="Object")
    g.link(g.math("ADD", rough - 0.03, g.math("MULTIPLY", noise.outputs["Fac"], 0.06)), bsdf, dst_socket="Roughness")
    _micro_bump(g, bsdf, scale=2500.0, strength=0.03, coords=tc.outputs["Object"])
    return mat


def powder_coat(color=(0.012, 0.012, 0.013), name: str = "PowderCoat_Black"):
    """Satin powder-coated steel with a faint orange-peel texture."""
    mat, g = _get(name)
    if g is None:
        return mat
    bsdf = g.bsdf(**{"Base Color": rgba(*color), "Roughness": 0.42, "Specular IOR Level": 0.5})
    tc = g.node("ShaderNodeTexCoord")
    _micro_bump(g, bsdf, scale=1200.0, strength=0.05, distance=0.0003, coords=tc.outputs["Object"])
    return mat


def steel(name: str = "Steel_Polished", roughness: float = 0.15):
    mat, g = _get(name)
    if g is None:
        return mat
    g.bsdf(**{"Base Color": rgba(0.62, 0.62, 0.63), "Metallic": 1.0, "Roughness": roughness})
    return mat


# --------------------------------------------------------------------------- plastics & rubber


def plastic(name: str, color, roughness: float = 0.5, texture_scale: float = 3000.0, texture_strength: float = 0.04):
    """Moulded matte plastic (ABS/PC). A light micro-bump stands in for the mould texture."""
    mat, g = _get(name)
    if g is None:
        return mat
    bsdf = g.bsdf(**{"Base Color": rgba(*color), "Roughness": roughness, "Specular IOR Level": 0.5})
    tc = g.node("ShaderNodeTexCoord")
    _micro_bump(g, bsdf, scale=texture_scale, strength=texture_strength, coords=tc.outputs["Object"])
    return mat


def soft_touch(name: str, color, split_line_x_mm: float | None = None, split_from_y_mm: float = 0.0):
    """Rubberised soft-touch coating (mouse shell). An optional dark parting line along local X
    marks the gap between the two main buttons."""
    mat, g = _get(name)
    if g is None:
        return mat
    bsdf = g.bsdf(**{"Base Color": rgba(*color), "Roughness": 0.58, "Sheen Weight": 0.03, "Sheen Roughness": 0.4,
                     "Specular IOR Level": 0.4})
    tc = g.node("ShaderNodeTexCoord")
    _micro_bump(g, bsdf, scale=5000.0, strength=0.035, coords=tc.outputs["Object"])
    if split_line_x_mm is not None:
        sep = g.node("ShaderNodeSeparateXYZ")
        g.link(tc, sep, src_socket="Object")
        near = g.math("LESS_THAN", g.math("ABSOLUTE", g.math("SUBTRACT", sep.outputs["X"], split_line_x_mm / 1000)), 0.00035)
        front = g.math("GREATER_THAN", sep.outputs["Y"], split_from_y_mm / 1000)
        line = g.math("MULTIPLY", near, front)
        mix = g.node("ShaderNodeMix", data_type="RGBA")
        g.link(line, mix, dst_socket=0)
        mix.inputs[6].default_value = rgba(*color)
        mix.inputs[7].default_value = rgba(0.002, 0.002, 0.002)
        g.link(mix, bsdf, src_socket=2, dst_socket="Base Color")
    return mat


def rubber(name: str = "Rubber_Black"):
    mat, g = _get(name)
    if g is None:
        return mat
    g.bsdf(**{"Base Color": rgba(0.01, 0.01, 0.01), "Roughness": 0.85, "Specular IOR Level": 0.3})
    return mat


def cable_jacket(name: str = "Cable_Black", color=(0.012, 0.012, 0.012), roughness: float = 0.45):
    """TPE/PVC cable jacket: soft sheen, slightly glossy."""
    mat, g = _get(name)
    if g is None:
        return mat
    bsdf = g.bsdf(**{"Base Color": rgba(*color), "Roughness": roughness, "Specular IOR Level": 0.45,
                     "Coat Weight": 0.1, "Coat Roughness": 0.3})
    tc = g.node("ShaderNodeTexCoord")
    _micro_bump(g, bsdf, scale=4000.0, strength=0.03, coords=tc.outputs["Object"])
    return mat


def leather_mat(name: str = "DeskMat_Black"):
    """Black PU-leather desk mat: fine pebble grain from a Voronoi bump, satin sheen."""
    mat, g = _get(name)
    if g is None:
        return mat
    bsdf = g.bsdf(**{"Base Color": rgba(0.008, 0.008, 0.009), "Roughness": 0.6, "Specular IOR Level": 0.4,
                     "Sheen Weight": 0.04, "Sheen Roughness": 0.4})
    tc = g.node("ShaderNodeTexCoord")
    vor = g.node("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", Scale=1500.0)
    g.link(tc, vor, src_socket="Object")
    noise = g.node("ShaderNodeTexNoise", Scale=300.0, Detail=3.0)
    g.link(tc, noise, src_socket="Object")
    g.link(g.math("ADD", 0.56, g.math("MULTIPLY", noise.outputs["Fac"], 0.12)), bsdf, dst_socket="Roughness")
    bump = g.node("ShaderNodeBump", Strength=0.18, Distance=0.0002)
    g.link(vor, bump, src_socket="Distance", dst_socket="Height")
    g.link(bump, bsdf, dst_socket="Normal")
    return mat


# --------------------------------------------------------------------------- glass & displays


def glass_clear(name: str = "Glass_Window"):
    """Float glass. Shadow rays pass straight through (thin-glass trick), so daylight through the
    window is not blocked and no caustic noise appears; camera and reflection rays still see real
    glass refraction and Fresnel reflections."""
    mat, g = _get(name)
    if g is None:
        return mat
    glass = g.node("ShaderNodeBsdfGlass", IOR=1.52, Roughness=0.0)
    glass.inputs["Color"].default_value = rgba(0.96, 0.98, 0.97)
    transparent = g.node("ShaderNodeBsdfTransparent")
    lp = g.node("ShaderNodeLightPath")
    mix = g.node("ShaderNodeMixShader", x=300)
    g.link(lp, mix, src_socket="Is Shadow Ray", dst_socket=0)
    g.link(glass, mix, dst_socket=1)
    g.link(transparent, mix, dst_socket=2)
    g.link(mix, g.out)
    return mat


def glass_black(name: str = "Glass_Black"):
    """Black glass front of a display (bezel area): a deep black base under a perfectly smooth
    dielectric surface, so it mirrors the room the way a switched-off panel does."""
    mat, g = _get(name)
    if g is None:
        return mat
    g.bsdf(**{"Base Color": rgba(0.002, 0.002, 0.0025), "Roughness": 0.02, "Specular IOR Level": 0.5, "IOR": 1.52})
    return mat


def screen(name: str, brightness: float, palette: str = "dusk"):
    """Lit display under a glass cover. A procedural wallpaper (a soft dusk gradient bent by
    low-frequency noise, with faint dune lines) drives the emission; the glossy coat gives real
    reflections on top."""
    mat, g = _get(name)
    if g is None:
        return mat
    tc = g.node("ShaderNodeTexCoord")
    sep = g.node("ShaderNodeSeparateXYZ")
    g.link(tc, sep, src_socket="UV")
    blob = g.node("ShaderNodeTexNoise", Scale=1.4, Detail=1.5, Roughness=0.45, Distortion=0.4)
    g.link(tc, blob, src_socket="UV")
    dunes = g.node("ShaderNodeTexWave", wave_type="BANDS", bands_direction="DIAGONAL", wave_profile="SIN", Scale=2.2,
                   Distortion=2.0, Detail=1.0)
    g.link(tc, dunes, src_socket="UV")
    height = g.math("ADD", g.math("MULTIPLY", sep.outputs["Y"], 0.78), g.math("MULTIPLY", sep.outputs["X"], 0.12))
    height = g.math("ADD", height, g.math("MULTIPLY", g.math("SUBTRACT", blob.outputs["Fac"], 0.5), 0.45))
    height = g.math("ADD", height, g.math("MULTIPLY", dunes.outputs["Fac"], 0.05))
    palettes = {
        "dusk": [
            (0.0, rgba(0.006, 0.012, 0.050)),
            (0.32, rgba(0.020, 0.050, 0.170)),
            (0.55, rgba(0.120, 0.080, 0.250)),
            (0.75, rgba(0.560, 0.180, 0.220)),
            (1.0, rgba(0.980, 0.520, 0.260)),
        ],
    }
    col = g.ramp(height, palettes[palette], interpolation="EASE")
    bsdf = g.bsdf(**{"Base Color": rgba(0.0, 0.0, 0.0), "Roughness": 0.03, "Specular IOR Level": 0.5,
                     "Emission Strength": brightness})
    g.link(col, bsdf, dst_socket="Emission Color")
    return mat


def emission(name: str, color, strength: float):
    mat, g = _get(name)
    if g is None:
        return mat
    g.bsdf(**{"Base Color": rgba(0, 0, 0), "Emission Color": rgba(*color), "Emission Strength": strength})
    return mat


# --------------------------------------------------------------------------- room


def wall_paint(name: str = "Wall_Paint", color=(0.70, 0.68, 0.64)):
    """Warm white matte emulsion with a faint roller texture."""
    mat, g = _get(name)
    if g is None:
        return mat
    bsdf = g.bsdf(**{"Base Color": rgba(*color), "Roughness": 0.85, "Specular IOR Level": 0.3})
    tc = g.node("ShaderNodeTexCoord")
    _micro_bump(g, bsdf, scale=180.0, strength=0.04, distance=0.001, coords=tc.outputs["Object"])
    return mat


def microcement(name: str = "Floor_Microcement"):
    """Sealed light-grey microcement floor: soft trowel mottling and a satin sealer."""
    mat, g = _get(name)
    if g is None:
        return mat
    tc = g.node("ShaderNodeTexCoord")
    mottle = g.node("ShaderNodeTexNoise", Scale=1.6, Detail=8.0, Roughness=0.62)
    g.link(tc, mottle, src_socket="Object")
    col = g.ramp(mottle, [(0.3, rgba(0.30, 0.29, 0.27)), (0.7, rgba(0.42, 0.41, 0.385))])
    bsdf = g.bsdf(**{"Roughness": 0.45, "Specular IOR Level": 0.45})
    g.link(col, bsdf, dst_socket="Base Color")
    rough = g.node("ShaderNodeTexNoise", Scale=4.0, Detail=4.0)
    g.link(tc, rough, src_socket="Object")
    g.link(g.math("ADD", 0.36, g.math("MULTIPLY", rough.outputs["Fac"], 0.22)), bsdf, dst_socket="Roughness")
    _micro_bump(g, bsdf, scale=400.0, strength=0.05, distance=0.0008, coords=tc.outputs["Object"])
    return mat


def sheer_curtain(name: str = "Curtain_Sheer", transparency: float = 0.0):
    """Linen voile: mostly diffuse transmission (plus optional straight-through transparency),
    which is what turns hard sun into soft window light."""
    mat, g = _get(name)
    if g is None:
        return mat
    translucent = g.node("ShaderNodeBsdfTranslucent")
    translucent.inputs["Color"].default_value = rgba(0.85, 0.83, 0.78)
    diffuse = g.node("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = rgba(0.80, 0.78, 0.73)
    transparent = g.node("ShaderNodeBsdfTransparent")
    a = g.node("ShaderNodeMixShader", x=100)
    a.inputs[0].default_value = 0.45
    g.link(diffuse, a, dst_socket=1)
    g.link(translucent, a, dst_socket=2)
    b = g.node("ShaderNodeMixShader", x=300)
    b.inputs[0].default_value = transparency
    g.link(a, b, dst_socket=1)
    g.link(transparent, b, dst_socket=2)
    g.link(b, g.out)
    return mat


def speaker_grille(finish: str = "silver"):
    """Aluminium drilled with a regular grid of tiny speaker holes (Voronoi with zero randomness
    is a square grid; the cell-centre distance cuts round holes)."""
    base, rough = ALUMINUM_FINISHES[finish]
    mat, g = _get(f"SpeakerGrille_{finish}")
    if g is None:
        return mat
    tc = g.node("ShaderNodeTexCoord")
    vor = g.node("ShaderNodeTexVoronoi", Scale=1.0 / 0.0011, Randomness=0.0)
    g.link(tc, vor, src_socket="Object")
    hole = g.math("LESS_THAN", vor.outputs["Distance"], 0.28)
    col = g.node("ShaderNodeMix", data_type="RGBA")
    g.link(hole, col, dst_socket=0)
    col.inputs[6].default_value = rgba(*base)
    col.inputs[7].default_value = rgba(0.0, 0.0, 0.0)
    bsdf = g.bsdf(**{"Metallic": 1.0, "Roughness": rough})
    g.link(col, bsdf, src_socket=2, dst_socket="Base Color")
    g.link(g.math("SUBTRACT", 1.0, hole), bsdf, dst_socket="Metallic")
    return mat


def trackpad(finish: str = "silver"):
    """Etched glass trackpad, colour-matched to the aluminium around it."""
    base, _ = ALUMINUM_FINISHES[finish]
    mat, g = _get(f"Trackpad_{finish}")
    if g is None:
        return mat
    tone = tuple(c * 0.62 for c in base)
    g.bsdf(**{"Base Color": rgba(*tone), "Roughness": 0.30, "Specular IOR Level": 0.5, "Coat Weight": 0.3,
              "Coat Roughness": 0.25})
    return mat
