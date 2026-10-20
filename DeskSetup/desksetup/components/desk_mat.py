"""Minimal black PU-leather desk mat."""

from __future__ import annotations

import bmesh

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout


def build(cfg: SceneConfig, lay: Layout, col):
    m = cfg.mat
    bm = bmesh.new()
    geo.rounded_box(bm, (m.width_mm, m.depth_mm, m.thickness_mm), m.corner_radius_mm, center=(0, 0, m.thickness_mm / 2),
                    segments=8)
    mat = geo.mesh_object("DeskMat", bm, col, mats.leather_mat(), location_mm=lay.mat.location)
    geo.bevel(mat, 1.0, segments=3)
    return mat
