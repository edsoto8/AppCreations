"""Surface details: stencilled labels / serial numbers, status LEDs, panel-line inserts."""

import bpy

from . import primitives as P
from . import utils as U


def label(kit, name, text, matrix, size=0.04, mat="decal_white", depth=0.0008):
    """Stencil text lying on a surface (local +Z out of the surface, reads along local +X)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = text
    cu.size = size
    cu.extrude = depth
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.offset = 0.0
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(kit.M[mat])
    ob.matrix_world = matrix @ U.T(z=depth + 0.0015)
    kit.coll.objects.link(ob)
    ob["bone"] = kit.bone or ""
    ob["decal"] = True
    return ob


def led(kit, name, matrix, mat="led_green", r=0.012):
    """Status LED: steel bezel + emissive dome. Local +Z out of the surface."""
    def b(bm):
        P.bm_tube(bm, r * 1.6, r * 0.95, r * 0.8, U.T(z=r * 0.4), segs=16, bevel=r * 0.15, mat=0)
        P.bm_lathe(bm, [(0, r * 0.95), (r * 0.6, r * 0.85), (r * 0.95, r * 0.5), (r * 0.95, 0.0), (0, 0.0)],
                   segs=16, mat=1)
    return P.make(name, kit.coll, kit.m("steel_dark", mat), b, matrix, kit.bone, wn=False)


def led_strip(kit, name, matrix, length, count=6, mat="emit_blue", w=0.012):
    """Recessed light bar: housing + emissive insert. Local X along the strip, +Z outward."""
    def b(bm):
        P.bm_box(bm, length + 0.02, w * 2.2, 0.012, U.T(z=0.006), bevel=0.003, mat=0)
        P.bm_box(bm, length, w, 0.008, U.T(z=0.011), bevel=0.002, mat=1)
    return P.make(name, kit.coll, kit.m("steel_dark", mat), b, matrix, kit.bone, wn=False)


def access_panel(kit, name, matrix, w, h, mat="armor_dark", handle=True):
    """Bolted access hatch: inset plate, recessed handle, four corner screws. Local +Z outward."""
    def b(bm):
        P.bm_prism(bm, P.poly_chamfer_rect(w, h, min(w, h) * 0.12), 0.012, U.T(z=0.006), bevel=0.003, mat=0)
        if handle:
            P.bm_box(bm, w * 0.36, 0.022, 0.012, U.T(y=-h * 0.28, z=0.012), bevel=0.003, mat=1)
            for sx in (-1, 1):
                P.bm_box(bm, 0.012, 0.022, 0.022, U.T(x=sx * w * 0.17, y=-h * 0.28, z=0.015), bevel=0.002, mat=1)
    ob = P.make(name, kit.coll, kit.m(mat, "titanium"), b, matrix, kit.bone)
    out = [ob]
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        out.append(P.bolt(kit, f"{name}_Screw_{i}", matrix @ U.T(sx * (w / 2 - 0.022), sy * (h / 2 - 0.022), 0.012),
                          0.007, "socket"))
    return out
