"""Shared palette materials (ASSET_CONTRACT.md "Palette").

Every model uses these materials by name so Godot sees the same `M_*` material names in every
file. Colours are given as sRGB hex (as in the contract) and converted to linear for the
Principled BSDF base colour, which is what the glTF exporter writes as `baseColorFactor`.
"""
import bpy

# name: (hex, roughness, metallic)
PALETTE = {
    "M_Grass": ("#6CC24A", 0.85, 0.0),
    "M_GrassDark": ("#3E9A3A", 0.85, 0.0),
    "M_Earth": ("#B5713F", 0.9, 0.0),
    "M_EarthDark": ("#8A5230", 0.9, 0.0),
    "M_Stone": ("#A89F94", 0.8, 0.0),
    "M_Wood": ("#9A6435", 0.8, 0.0),
    "M_WoodDark": ("#6B4226", 0.8, 0.0),
    "M_Leaf": ("#5DB84A", 0.8, 0.0),
    "M_Cloud": ("#FFFFFF", 1.0, 0.0),
    "M_Gold": ("#FFC53D", 0.3, 0.6),
    "M_GoldDark": ("#E09A1A", 0.45, 0.0),
    "M_Jacket": ("#23A6A6", 0.7, 0.0),
    "M_JacketTrim": ("#FFC93C", 0.6, 0.0),
    "M_Pack": ("#F2753A", 0.7, 0.0),
    "M_Scarf": ("#E8483B", 0.8, 0.0),
    "M_Pants": ("#2E3A6B", 0.8, 0.0),
    "M_Boot": ("#7A4A2A", 0.65, 0.0),
    "M_Sole": ("#3B2A20", 0.85, 0.0),
    "M_Skin": ("#F2C29B", 0.6, 0.0),
    "M_Hair": ("#4A2C1D", 0.6, 0.0),
    "M_EyeWhite": ("#FFFFFF", 0.45, 0.0),
    "M_EyeDark": ("#1E1A2E", 0.45, 0.0),
    "M_Blush": ("#F49A8C", 0.7, 0.0),
    "M_Bug": ("#8E4BB8", 0.55, 0.0),
    "M_BugSpot": ("#C08BE0", 0.6, 0.0),
    "M_Puff": ("#FF8FA3", 0.9, 0.0),
    "M_Wing": ("#E8F6FF", 0.3, 0.0),
    "M_FlowerWhite": ("#FFFFFF", 0.7, 0.0),
    "M_FlowerYellow": ("#FFD84A", 0.7, 0.0),
    "M_FlowerPink": ("#FF7AA8", 0.7, 0.0),
    "M_Banner": ("#F2753A", 0.75, 0.0),
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_str):
    h = hex_str.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def get_material(name):
    """Return the palette material `name`, creating it on first use (idempotent)."""
    if name not in PALETTE:
        raise KeyError(f"{name} is not a palette material")
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    hex_str, rough, metal = PALETTE[name]
    rgb = hex_to_linear(hex_str)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    mat.diffuse_color = (*rgb, 1.0)  # viewport / Workbench colour
    mat.roughness = rough
    mat.metallic = metal
    return mat
