"""Compact low-profile wireless keyboard (Logitech MX Keys Mini proportions).

A wedge-shaped graphite body, slightly thicker at the back, carrying 80 low-profile keycaps on a
deck tilted to match the wedge.
"""

from __future__ import annotations

import math

import bmesh

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout
from . import keys


def build(cfg: SceneConfig, lay: Layout, col):
    k = cfg.keyboard
    root = geo.empty("Keyboard", col, location_mm=lay.keyboard.location, rotation_deg=(0, 0, lay.keyboard.yaw_deg))

    def top_z(_x, y):
        return k.front_height_mm + (y + k.depth_mm / 2) / k.depth_mm * (k.back_height_mm - k.front_height_mm)

    bm = bmesh.new()
    geo.prism(bm, geo.rounded_rect(k.width_mm, k.depth_mm, 7.0, 8), 0.0, 0.0, top_z_fn=top_z)
    body = geo.mesh_object("Keyboard_Body", bm, col, mats.plastic("Plastic_Graphite", (0.042, 0.043, 0.047), 0.48),
                           parent=root)
    geo.bevel(body, 2.2, segments=4)

    tilt = math.degrees(math.atan2(k.back_height_mm - k.front_height_mm, k.depth_mm))
    mid = (k.front_height_mm + k.back_height_mm) / 2
    deck = geo.empty("Keyboard_Deck", col, location_mm=(0, -1.0, mid - 1.2), rotation_deg=(tilt, 0, 0), parent=root)
    bm, _ = keys.keycaps(k.key_pitch_mm, k.key_size_mm, height=4.2, corner=3.2)
    caps = geo.mesh_object("Keyboard_Keycaps", bm, col, mats.plastic("Plastic_Keycap", (0.028, 0.028, 0.031), 0.42, 4000.0, 0.03),
                           parent=deck)
    geo.bevel(caps, 0.7, segments=2, angle_deg=50)

    return root
