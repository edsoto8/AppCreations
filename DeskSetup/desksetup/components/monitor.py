"""27-inch 16:9 display with thin uniform bezels and a slim chin.

Local frame: X across the screen, +Y into the monitor (away from the user), Z up, origin at the
centre of the front face. The root empty carries the tilt, so the whole display tilts about its
face like it would on a real tilt head.
"""

from __future__ import annotations

import math

import bmesh
from mathutils import Matrix

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout, screen_center_local


def build(cfg: SceneConfig, lay: Layout, col, screen_brightness: float):
    m = cfg.monitor
    root = geo.empty("Monitor", col, location_mm=lay.monitor.face_center, rotation_deg=(-lay.monitor.tilt_deg, 0, 0))
    t = m.panel_thickness_mm
    housing = mats.plastic("Plastic_MonitorBlack", (0.018, 0.018, 0.020), 0.45, 2500.0, 0.05)

    bm = bmesh.new()
    geo.prism(bm, geo.rounded_rect(m.width_mm, m.height_mm, m.corner_radius_mm, 8), 0.6, t, matrix=geo.TO_XZ)
    shell = geo.mesh_object("Monitor_Panel", bm, col, housing, parent=root)
    geo.bevel(shell, 1.5, segments=3)

    bm = bmesh.new()
    geo.prism(bm, geo.rounded_rect(m.width_mm - 1.0, m.height_mm - 1.0, m.corner_radius_mm - 0.5, 8), 0.0, 1.4,
              matrix=geo.TO_XZ)
    glass = geo.mesh_object("Monitor_FrontGlass", bm, col, mats.glass_black(), parent=root)
    geo.bevel(glass, 0.3, segments=2)

    zc = screen_center_local(cfg)[2]
    bm = geo.screen_plane(m.active_width_mm, m.active_height_mm,
                          matrix=Matrix.Translation((0, -0.05, zc)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    geo.mesh_object("Monitor_Screen", bm, col, mats.screen("Screen_Monitor", screen_brightness), parent=root,
                    recalc_normals=False, smooth=False)

    # Rear housing: tapered, heavily rounded bulge holding electronics and the VESA mount.
    hw, hh = m.width_mm * 0.62, m.height_mm * 0.59
    hz = (0.62 - 0.56) / 2 * m.height_mm / 2
    bm = bmesh.new()
    geo.prism(bm, geo.rounded_rect(hw, hh, 45.0, 12), t - 1.0, t + m.rear_housing_depth_mm, top_scale=0.80,
              matrix=Matrix.Translation((0, 0, hz)) @ geo.TO_XZ)
    rear = geo.mesh_object("Monitor_RearHousing", bm, col, housing, parent=root)
    geo.bevel(rear, 7.0, segments=6, angle_deg=25)

    # Status LED under the chin, bottom right.
    bm = bmesh.new()
    geo.cylinder(bm, 0.8, 0.3, segments=12)
    geo.mesh_object("Monitor_LED", bm, col, mats.emission("LED_White", (1.0, 0.98, 0.95), 4.0), parent=root,
                    location_mm=(m.width_mm / 2 - 40.0, 4.0, -m.height_mm / 2 - 0.02))
    return root
