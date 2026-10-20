"""Walnut desk top on two black steel loop-leg frames, with optional rear stretcher."""

from __future__ import annotations

import bmesh

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout


def build(cfg: SceneConfig, lay: Layout, col, grommet_xy=None):
    d, dl = cfg.desk, lay.desk
    root = geo.empty("Desk", col)

    bm = bmesh.new()
    geo.rounded_box(bm, (d.width_mm, d.depth_mm, d.top_thickness_mm), d.corner_radius_mm, segments=6)
    top = geo.mesh_object("Desk_Top", bm, col, mats.walnut(d.board_width_mm), parent=root,
                          location_mm=(0, 0, dl.top_z - d.top_thickness_mm / 2))
    if grommet_xy is not None:
        _cut_hole(top, col, grommet_xy, cfg.cables.grommet_diameter_mm / 2, d.top_thickness_mm)
    geo.bevel(top, d.edge_radius_mm, segments=4)

    steel = mats.powder_coat()
    frame_d = d.depth_mm - 2 * d.leg_inset_y_mm
    frame_h = dl.bottom_z - d.leveler_height_mm
    t, w = d.leg_tube_depth_mm, d.leg_tube_width_mm
    x_leg = dl.half_width - d.leg_inset_x_mm - w / 2
    for side, sx in (("L", -1), ("R", 1)):
        bm = bmesh.new()
        outer = geo.rounded_rect(frame_d, frame_h, 0.0)
        inner = geo.rounded_rect(frame_d - 2 * t, frame_h - 2 * t, 0.0)
        geo.frame_ring(bm, outer, inner, w, matrix=geo.TO_YZ)
        leg = geo.mesh_object(f"Desk_Leg_{side}", bm, col, steel, parent=root,
                              location_mm=(sx * x_leg, 0, d.leveler_height_mm + frame_h / 2))
        geo.bevel(leg, 1.5, segments=3)

        # Levelling glides under each end of the foot rail.
        for sy in (-1, 1):
            bm = bmesh.new()
            geo.cylinder(bm, 11.0, d.leveler_height_mm - 2.0, center=(0, 0, (d.leveler_height_mm - 2.0) / 2), segments=32)
            geo.cylinder(bm, 4.0, 2.0, center=(0, 0, d.leveler_height_mm - 1.0), segments=16)
            glide = geo.mesh_object(f"Desk_Glide_{side}{'F' if sy < 0 else 'B'}", bm, col, mats.rubber(), parent=root,
                                    location_mm=(sx * x_leg, sy * (frame_d / 2 - t / 2), 0))
            geo.bevel(glide, 1.0, segments=2)

    if d.crossbar:
        bm = bmesh.new()
        span = 2 * (x_leg - w / 2)
        geo.box(bm, (span, 40.0, 20.0))
        bar = geo.mesh_object("Desk_Stretcher", bm, col, steel, parent=root,
                              location_mm=(0, frame_d / 2 - t / 2, dl.bottom_z - 10.0 - 0.01))
        geo.bevel(bar, 1.5, segments=3)
    return root


def _cut_hole(top, col, xy, radius, thickness):
    bm = bmesh.new()
    geo.cylinder(bm, radius, thickness * 3, segments=64)
    cutter = geo.mesh_object("Desk_GrommetCutter", bm, col, parent=top, smooth=False)
    cutter.location = geo.v((xy[0], xy[1], 0))
    cutter.hide_render = True
    cutter.hide_viewport = True
    cutter.display_type = "WIRE"
    mod = top.modifiers.new("GrommetHole", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
