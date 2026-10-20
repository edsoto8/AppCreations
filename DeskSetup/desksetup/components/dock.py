"""Thunderbolt/USB-C dock and a slim power strip, both hidden in the under-desk tray.

Each builder returns the root object plus the world positions of its ports, so the cable router
can plug into them.
"""

from __future__ import annotations

import bmesh

from .. import geometry as geo
from .. import materials as mats

DOCK_SIZE = (150.0, 60.0, 24.0)
STRIP_SIZE = (260.0, 50.0, 38.0)


def build_dock(col, center_bottom, name: str = "Dock"):
    """Aluminium dock lying flat. Ports: three USB-C on the +X end, DC-in on the +Y side."""
    w, d, h = DOCK_SIZE
    x, y, z = center_bottom
    root = geo.empty(name, col, location_mm=center_bottom)
    bm = bmesh.new()
    geo.rounded_box(bm, DOCK_SIZE, 7.0, center=(0, 0, h / 2), segments=8)
    body = geo.mesh_object(f"{name}_Body", bm, col, mats.aluminum("space_gray"), parent=root)
    geo.bevel(body, 2.0, segments=3)
    black = mats.plastic("Plastic_Black", (0.006, 0.006, 0.006), 0.4)
    ports = {}
    for i, py in enumerate((-16.0, 0.0, 16.0)):
        bm = bmesh.new()
        geo.rounded_box(bm, (8.6, 3.2, 1.0), 1.4, matrix=geo.TO_YZ)
        geo.mesh_object(f"{name}_USBC{i + 1}", bm, col, black, parent=root, location_mm=(w / 2 + 0.2, py, h / 2))
        ports[f"usbc{i + 1}"] = (x + w / 2, y + py, z + h / 2)
    bm = bmesh.new()
    geo.cylinder(bm, 3.2, 1.0, axis="Y", segments=24)
    geo.mesh_object(f"{name}_DCIn", bm, col, black, parent=root, location_mm=(-w / 2 + 22.0, d / 2 + 0.2, h / 2))
    ports["dc"] = (x - w / 2 + 22.0, y + d / 2, z + h / 2)
    bm = bmesh.new()
    geo.cylinder(bm, 0.9, 0.4, axis="Y", segments=12)
    geo.mesh_object(f"{name}_LED", bm, col, mats.emission("LED_White", (1.0, 0.98, 0.95), 4.0), parent=root,
                    location_mm=(w / 2 - 14.0, -d / 2 - 0.1, h / 2))
    return root, ports


def build_power_strip(col, center_bottom, name: str = "PowerStrip"):
    """Black four-outlet strip. Outlets on top along X; the mains lead leaves the -X end."""
    w, d, h = STRIP_SIZE
    x, y, z = center_bottom
    root = geo.empty(name, col, location_mm=center_bottom)
    bm = bmesh.new()
    geo.rounded_box(bm, STRIP_SIZE, 8.0, center=(0, 0, h / 2), segments=8)
    body = geo.mesh_object(f"{name}_Body", bm, col, mats.plastic("Plastic_Strip", (0.02, 0.02, 0.021), 0.5), parent=root)
    geo.bevel(body, 3.0, segments=3)
    face = mats.plastic("Plastic_StripFace", (0.012, 0.012, 0.013), 0.35)
    black = mats.plastic("Plastic_Black", (0.006, 0.006, 0.006), 0.4)
    outlets = []
    for i in range(4):
        ox = -w / 2 + 45.0 + i * 52.0
        bm = bmesh.new()
        geo.rounded_box(bm, (38.0, 36.0, 0.8), 6.0, center=(0, 0, 0.4))
        geo.mesh_object(f"{name}_Outlet{i + 1}", bm, col, face, parent=root, location_mm=(ox, 0, h))
        for sx in (-6.0, 6.0):
            bm = bmesh.new()
            geo.box(bm, (2.0, 7.0, 0.4), center=(sx, 3.0, 0.9))
            geo.mesh_object(f"{name}_Slot", bm, col, black, parent=root, location_mm=(ox, 0, h))
        outlets.append((x + ox, y, z + h + 0.8))
    bm = bmesh.new()
    geo.rounded_box(bm, (14.0, 22.0, 3.0), 3.0)
    geo.mesh_object(f"{name}_Switch", bm, col, mats.plastic("Plastic_SwitchRed", (0.25, 0.012, 0.01), 0.3), parent=root,
                    location_mm=(w / 2 - 18.0, 0, h + 0.6))
    return root, {"outlets": outlets, "mains": (x - w / 2, y, z + h / 2)}
