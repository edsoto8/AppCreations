"""Open 14-inch aluminium laptop (MacBook Pro proportions, no logos).

Base: unibody slab with a black keyboard well, flush keys, speaker grilles either side and a
large glass trackpad. Lid: aluminium shell hinged at the rear edge, black glass front with the
lit display and camera notch. The lid hangs from a hinge empty so its angle can be changed in
the .blend by rotating one object.
"""

from __future__ import annotations

import math

import bmesh
from mathutils import Matrix

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout
from . import keys

KEY_PITCH = 18.6
TOP_ROW = 0.7  # function row height in key units
KEYBOARD_BACK_MARGIN = 10.0
TOP_BEZEL = 6.0
PORT_FROM_BACK = 45.0  # left-side USB-C port, from the rear edge


def usb_port_local(cfg: SceneConfig) -> tuple[float, float, float]:
    """Left-side USB-C port centre in the laptop's local frame (origin = base bottom centre)."""
    lp = cfg.laptop
    return (-lp.width_mm / 2, lp.depth_mm / 2 - PORT_FROM_BACK, lp.base_thickness_mm * 0.45)


def build(cfg: SceneConfig, lay: Layout, col, screen_brightness: float):
    lp = cfg.laptop
    root = geo.empty("Laptop", col, location_mm=lay.laptop.base.location, rotation_deg=(0, 0, lay.laptop.base.yaw_deg))
    alu = mats.aluminum(lp.finish)
    black_alu = mats.aluminum("black")
    th = lp.base_thickness_mm

    bm = bmesh.new()
    geo.rounded_box(bm, (lp.width_mm, lp.depth_mm, th), lp.corner_radius_mm, center=(0, 0, th / 2), segments=10)
    base = geo.mesh_object("Laptop_Base", bm, col, alu, parent=root)
    geo.bevel(base, 1.6, segments=4)

    # Keyboard well, keys, grilles and trackpad on the deck.
    field_w = keys.ROW_UNITS * KEY_PITCH
    field_d = (TOP_ROW + 5) * KEY_PITCH
    kb_cy = lp.depth_mm / 2 - KEYBOARD_BACK_MARGIN - field_d / 2
    bm = bmesh.new()
    geo.rounded_box(bm, (field_w + 5, field_d + 5, 0.3), 3.0, center=(0, kb_cy, th - 0.1))
    geo.mesh_object("Laptop_KeyboardWell", bm, col, black_alu, parent=root)
    bm, _ = keys.keycaps(KEY_PITCH, 16.2, height=0.75, corner=2.0, top_row_scale=TOP_ROW, taper=0.15)
    caps = geo.mesh_object("Laptop_Keys", bm, col, mats.plastic("Plastic_LaptopKey", (0.010, 0.010, 0.011), 0.38, 5000, 0.02),
                           parent=root, location_mm=(0, kb_cy, th - 0.3))
    geo.bevel(caps, 0.25, segments=2, angle_deg=50)
    for sx in (-1, 1):
        bm = bmesh.new()
        geo.rounded_box(bm, (10.0, field_d, 0.2), 2.0, center=(sx * (field_w / 2 + 8.5), kb_cy, th))
        geo.mesh_object(f"Laptop_SpeakerGrille_{'L' if sx < 0 else 'R'}", bm, col, mats.speaker_grille(lp.finish), parent=root)
    tp_d = kb_cy - field_d / 2 - 8.0 - (-lp.depth_mm / 2 + 11.0)
    bm = bmesh.new()
    geo.rounded_box(bm, (140.0, tp_d, 0.2), 6.0, center=(0, -lp.depth_mm / 2 + 11.0 + tp_d / 2, th))
    geo.mesh_object("Laptop_Trackpad", bm, col, mats.trackpad(lp.finish), parent=root)

    # USB-C port on the left flank (where the dock cable plugs in).
    px, py, pz = usb_port_local(cfg)
    bm = bmesh.new()
    geo.rounded_box(bm, (8.6, 3.0, 2.0), 1.2, center=(0, 0, 0), matrix=geo.TO_YZ)
    geo.mesh_object("Laptop_USBC_Port", bm, col, mats.plastic("Plastic_Black", (0.006, 0.006, 0.006), 0.4), parent=root,
                    location_mm=(px + 0.6, py, pz))

    # Lid, hinged at the rear of the deck.
    hx, hy, hz = lay.laptop.hinge
    bx, by, bz = lay.laptop.base.location
    hinge = geo.empty("Laptop_Hinge", col, location_mm=(hx - bx, hy - by, hz - bz),
                      rotation_deg=(-lay.laptop.lid_angle_deg, 0, 0), parent=root)
    length = lp.depth_mm - 4.0
    t = lp.lid_thickness_mm
    bm = bmesh.new()
    geo.rounded_box(bm, (lp.width_mm, length, t), lp.corner_radius_mm, center=(0, -length / 2, t / 2), segments=10)
    lid = geo.mesh_object("Laptop_Lid", bm, col, alu, parent=hinge)
    geo.bevel(lid, 1.3, segments=3)

    bm = bmesh.new()
    geo.rounded_box(bm, (lp.width_mm - 1.4, length - 1.4, 0.5), lp.corner_radius_mm - 0.7, center=(0, -length / 2, 0.2),
                    segments=10)
    geo.mesh_object("Laptop_DisplayGlass", bm, col, mats.glass_black(), parent=hinge)

    chin = length - lp.display_height_mm - TOP_BEZEL
    flip = Matrix.Rotation(math.pi, 4, "X")  # face -Z (towards the keyboard when closed)
    centre_y = -(chin + lp.display_height_mm / 2)
    bm = geo.screen_plane(lp.display_width_mm, lp.display_height_mm, matrix=Matrix.Translation((0, centre_y, -0.06)) @ flip)
    geo.mesh_object("Laptop_Screen", bm, col, mats.screen("Screen_Laptop", screen_brightness), parent=hinge,
                    recalc_normals=False, smooth=False)
    bm = bmesh.new()
    geo.rounded_box(bm, (31.0, 7.0, 0.05), 2.0, center=(0, -(chin + lp.display_height_mm) + 3.0, -0.1))
    geo.mesh_object("Laptop_CameraNotch", bm, col, mats.glass_black(), parent=hinge)
    return root
