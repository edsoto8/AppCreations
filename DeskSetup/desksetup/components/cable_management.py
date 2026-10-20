"""Cable management: desk grommet, under-desk tray with the hidden dock and power strip, wall
outlet, and every cable routed between them.

Routes, all hidden from the front view:

* laptop USB-C -> across the desk -> grommet -> tray -> dock
* monitor USB-C and power -> service loop behind the monitor -> along the underside of the arm
  -> down the pole -> behind the desk's back edge -> into the tray -> dock / power strip
* dock power -> power strip, inside the tray
* power strip mains -> over the tray's back lip -> drops behind the desk -> wall outlet
"""

from __future__ import annotations

import math

import bmesh
from mathutils import Vector

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout
from . import dock as dock_mod
from .laptop import usb_port_local

TRAY_WALL = 1.5
TRAY_HANG = 20.0  # tray lip below the desk underside (hangs from the stretcher)


def grommet_xy(cfg: SceneConfig, lay: Layout) -> tuple[float, float]:
    c = cfg.cables
    return (c.grommet_x_mm, lay.desk.back_y - c.grommet_from_back_edge_mm)


def build(cfg: SceneConfig, lay: Layout, col):
    c, desk = cfg.cables, lay.desk
    root = geo.empty("CableManagement", col)
    black = mats.plastic("Plastic_GrommetBlack", (0.010, 0.010, 0.011), 0.45)
    jacket = mats.cable_jacket()

    gx, gy = grommet_xy(cfg, lay)
    _grommet(col, root, black, (gx, gy, desk.top_z), c.grommet_diameter_mm / 2, desk.top_z - desk.bottom_z)

    # --- Tray hanging from the stretcher, dock and power strip inside it.
    tray_top = desk.bottom_z - TRAY_HANG
    tray_bottom = tray_top - c.tray_height_mm
    tray_y = desk.back_y - 30.0 - c.tray_depth_mm / 2
    _tray(col, root, (c.tray_x_mm, tray_y, tray_bottom), c.tray_width_mm, c.tray_depth_mm, c.tray_height_mm)
    floor = tray_bottom + TRAY_WALL
    x0 = c.tray_x_mm - c.tray_width_mm / 2 + TRAY_WALL
    strip_c = (x0 + 8.0 + dock_mod.STRIP_SIZE[0] / 2, tray_y, floor)
    _, strip = dock_mod.build_power_strip(col, strip_c)
    dock_c = (strip_c[0] + dock_mod.STRIP_SIZE[0] / 2 + 25.0 + dock_mod.DOCK_SIZE[0] / 2, tray_y, floor)
    _, dock = dock_mod.build_dock(col, dock_c)
    dock_top = floor + dock_mod.DOCK_SIZE[2]
    strip_top = floor + dock_mod.STRIP_SIZE[2]
    tray_back_in = tray_y + c.tray_depth_mm / 2 - TRAY_WALL - 6.0
    tray_right_in = c.tray_x_mm + c.tray_width_mm / 2 - TRAY_WALL

    # --- Laptop -> grommet -> dock.
    lp = lay.laptop.base.location
    px, py, pz = (a + b for a, b in zip(lp, usb_port_local(cfg)))
    r = c.usb_c_radius_mm
    plug_end = _usb_c_plug(col, root, (px, py, pz), Vector((-1, 0, 0)))
    t = desk.top_z + r
    u1 = dock["usbc1"]
    route = [
        plug_end, (px - 30, py + 4, t + 1.5), (px - 52, py + 30, t), (gx - 6, py + 85, t), (gx - 2, gy - 45, t),
        (gx, gy - 22, t + 0.5), (gx, gy - 16, desk.top_z - 12), (gx + 2, gy - 12, desk.bottom_z - 30),
        (gx + 6, gy - 8, dock_top + r + 10), (gx + 30, tray_y - 14, dock_top + r),
        (u1[0] + 10, u1[1] - 14, dock_top + r - 2), (u1[0] + 24, u1[1] - 6, u1[2] + 3), _into(u1, (1, 0, 0), 14.0),
    ]
    geo.tube_curve("Cable_Laptop_USBC", route, r, col, jacket, parent=root)
    _usb_c_plug(col, root, u1, Vector((1, 0, 0)))

    # --- Monitor -> arm -> desk edge -> tray.
    arm = lay.arm
    mon = cfg.monitor
    housing_low = (0.03 / 2 - 0.295) * mon.height_mm
    port_y = mon.panel_thickness_mm + mon.rear_housing_depth_mm * 0.45
    head, knuckle, elbow, pole = map(Vector, (arm.head, arm.elbow_knuckle, arm.elbow, arm.pole_top))
    gas = head - knuckle
    clamp = Vector(arm.clamp)
    back = desk.back_y
    for name, dx, radius, target, axis in (
        ("Cable_Monitor_USBC", -6.0, r, dock["usbc2"], (1, 0, 0)),
        ("Cable_Monitor_Power", 6.0, c.power_radius_mm, strip["outlets"][2], (0, 0, 1)),
    ):
        off = Vector((dx, 0, 0))
        port = Vector(lay.monitor.to_world((dx - 30.0, port_y, housing_low + 1.0)))
        start = _plug(col, root, name + "_Plug", port, Vector(lay.monitor.to_world((dx - 30.0, port_y, housing_low - 10)))
                      - port, (11.0, 7.0, 18.0) if radius == r else (16.0, 12.0, 22.0), black)
        pts = [
            start,
            port + Vector((0, 8, -55)) + off * 0.5,  # service loop behind the monitor
            head + Vector((0, 4, -48)) + off,
            knuckle + gas * 0.75 + Vector((0, 0, -27)) + off,
            knuckle + gas * 0.40 + Vector((0, 0, -27)) + off,
            knuckle + gas * 0.08 + Vector((0, 0, -30)) + off,
            elbow + Vector((0, 0, -24)) + off,
            (elbow + pole) / 2 + Vector((0, 0, -21)) + off,
            pole + Vector((dx * 0.6, 30, -24)),
            Vector((clamp.x + dx * 0.8, clamp.y + 24, clamp.z + 70)),
            Vector((clamp.x + dx * 0.8, clamp.y + 26, clamp.z + 26)),
            Vector((clamp.x + dx - 4, back + 15, desk.top_z - 6)),
            Vector((clamp.x - 45 + dx, back + 14 + dx * 0.3, desk.bottom_z - 20)),
            Vector((tray_right_in - 20, back - 2, desk.bottom_z - 9 + dx * 0.2)),
            Vector((tray_right_in - 24, tray_back_in, tray_top - 30)),
            Vector((tray_right_in - 30, tray_back_in + dx * 0.4, floor + radius + 4)),
        ]
        if axis == (1, 0, 0):  # into the dock's end ports
            pts += [Vector((tray_right_in - 32, target[1] + 10, floor + radius + 4)),
                    Vector(_into(target, axis, 14.0))]
            geo.tube_curve(name, [tuple(p) for p in pts], radius, col, jacket, parent=root)
            _usb_c_plug(col, root, target, Vector(axis))
        else:  # along the back of the tray, down into a power-strip outlet
            pts += [Vector((dock_c[0], tray_back_in, floor + radius)),
                    Vector((target[0] + 40, tray_back_in - 2, strip_top + 24)), Vector(_into(target, axis, 60.0)),
                    Vector(_into(target, axis, 24.0))]
            geo.tube_curve(name, [tuple(p) for p in pts], radius, col, jacket, parent=root)
            _plug(col, root, name + "_StripPlug", Vector(target), Vector(axis), (30.0, 22.0, 24.0), black)

    # Cable clips on the pole.
    for zf in (0.35, 0.75):
        bm = bmesh.new()
        geo.rounded_box(bm, (24.0, 14.0, 10.0), 5.0)
        geo.mesh_object("Arm_CableClip", bm, col, black, parent=root,
                        location_mm=(clamp.x, clamp.y + cfg.arm.pole_radius_mm + 6.0, clamp.z + (pole.z - clamp.z) * zf - 25))

    # --- Dock power -> strip outlet, inside the tray.
    dc = dock["dc"]
    o4 = strip["outlets"][3]
    pr = c.power_radius_mm * 0.8
    geo.tube_curve("Cable_Dock_Power", [
        _into(dc, (0, 1, 0), 16.0), (dc[0] - 8, dc[1] + 20, dc[2] + 10), (dc[0] - 50, tray_back_in - 12, strip_top + 14),
        _into(o4, (0, 0, 1), 60.0), _into(o4, (0, 0, 1), 24.0),
    ], pr, col, jacket, parent=root)
    _plug(col, root, "Cable_Dock_DCPlug", Vector(dc), Vector((0, 1, 0)), (9.0, 9.0, 16.0), black)
    _plug(col, root, "Cable_Dock_StripPlug", Vector(o4), Vector((0, 0, 1)), (30.0, 22.0, 24.0), black)

    # --- Strip mains -> over the tray lip -> drops behind the left leg -> wall outlet.
    wall_y = lay.wall_y
    ox, oz = c.outlet_x_mm, c.outlet_height_mm
    outlet_plug = _wall_outlet(col, root, (ox, wall_y, oz), black)
    m0 = strip["mains"]
    pr = c.power_radius_mm
    geo.tube_curve("Cable_Mains", [
        _into(m0, (-1, 0, 0), 4.0), (m0[0] - 2, m0[1] + 18, m0[2] + 16),
        (m0[0] + 2, tray_back_in - 2, tray_top - 12), (m0[0], tray_back_in + 14, tray_top + 5),
        (m0[0] - 14, back + 28, tray_top - 60), (ox + 4, wall_y - 30, 450), (ox + 2, wall_y - 40, oz + 110),
        (ox, wall_y - 38, oz + 66), tuple(outlet_plug),
    ], pr, col, jacket, parent=root)
    _plug(col, root, "Cable_Mains_Plug", Vector(m0) + Vector((10, 0, 0)), Vector((-1, 0, 0)), (24.0, 24.0, 6.0), black)
    return root


def _into(port, axis, depth):
    """Point ``depth`` mm out from a port along its outward ``axis``."""
    return tuple(p + a * depth for p, a in zip(port, axis))


def _plug(col, parent, name, port: Vector, outward: Vector, size, material):
    """A connector overmould sitting on ``port`` and sticking out along ``outward``; returns the
    point where the cable leaves it."""
    w, d, length = size
    out = Vector(outward).normalized()
    bm = bmesh.new()
    geo.rounded_box(bm, (w, d, length), min(w, d) * 0.35, center=(0, 0, length / 2), matrix=geo.align_matrix(out))
    obj = geo.mesh_object(name, bm, col, material, parent=parent, location_mm=tuple(port))
    geo.bevel(obj, min(w, d) * 0.12, segments=2)
    end = Vector(port) + out * length
    return tuple(end)


def _usb_c_plug(col, parent, port, outward: Vector):
    """USB-C plug: aluminium shell, black strain-relief boot."""
    out = Vector(outward).normalized()
    p = Vector(port)
    _plug(col, parent, "Cable_USBC_Shell", p, out, (12.0, 6.6, 14.0), mats.aluminum("space_gray"))
    return _plug(col, parent, "Cable_USBC_Boot", p + out * 13.5, out, (7.0, 5.0, 8.0), mats.cable_jacket())


def _grommet(col, parent, material, top_center, radius, thickness):
    x, y, z = top_center
    bm = bmesh.new()
    outer = geo.rounded_rect(2 * (radius + 5.0), 2 * (radius + 5.0), radius + 5.0, 16)
    inner = geo.rounded_rect(2 * (radius - 1.5), 2 * (radius - 1.5), radius - 1.5, 16)
    geo.frame_ring(bm, outer, inner, 1.6)
    flange = geo.mesh_object("Grommet_Flange", bm, col, material, parent=parent, location_mm=(x, y, z + 0.8))
    geo.bevel(flange, 0.6, segments=2)
    bm = bmesh.new()
    outer = geo.rounded_rect(2 * radius - 0.4, 2 * radius - 0.4, radius - 0.2, 16)
    inner = geo.rounded_rect(2 * radius - 3.4, 2 * radius - 3.4, radius - 1.7, 16)
    geo.frame_ring(bm, outer, inner, thickness)
    geo.mesh_object("Grommet_Sleeve", bm, col, material, parent=parent, location_mm=(x, y, z - thickness / 2))
    # Cap with a cable notch facing the user.
    rc = radius - 2.0
    half_notch = 7.0
    a0 = math.asin(half_notch / rc)
    outline = []
    steps = 48
    for i in range(steps + 1):
        a = -math.pi / 2 + a0 + (2 * math.pi - 2 * a0) * i / steps
        outline.append((rc * math.cos(a), rc * math.sin(a)))
    notch_depth = 14.0
    outline += [(-half_notch, -rc + notch_depth), (half_notch, -rc + notch_depth)]
    bm = bmesh.new()
    geo.prism(bm, outline, -1.0, 1.0)
    cap = geo.mesh_object("Grommet_Cap", bm, col, material, parent=parent, location_mm=(x, y, z + 0.6))
    geo.bevel(cap, 0.5, segments=2)


def _tray(col, parent, bottom_center, width, depth, height):
    """Open-top steel cable tray (U-channel along X) with two hanger brackets."""
    t = TRAY_WALL
    hd = depth / 2
    profile = [(-hd, height), (-hd, 0.0), (hd, 0.0), (hd, height), (hd - t, height), (hd - t, t), (-hd + t, t),
               (-hd + t, height)]
    bm = bmesh.new()
    geo.prism(bm, profile, -width / 2, width / 2, matrix=geo.TO_YZ)
    steel = mats.powder_coat()
    tray = geo.mesh_object("CableTray", bm, col, steel, parent=parent, location_mm=bottom_center)
    geo.bevel(tray, 0.6, segments=2, angle_deg=60)
    x, y, z = bottom_center
    for sx in (-1, 1):
        bm = bmesh.new()
        geo.box(bm, (30.0, 40.0, TRAY_HANG + 6.0), center=(0, 0, (TRAY_HANG + 6.0) / 2 - 6.0))
        geo.mesh_object("CableTray_Hanger", bm, col, steel, parent=parent,
                        location_mm=(x + sx * (width / 2 - 60.0), y + hd - 38.0, z + height))


def _wall_outlet(col, parent, center, material):
    """Duplex wall outlet on the back wall with a plug in the top socket; returns the point where
    the plug's cable leaves it."""
    x, wall_y, z = center
    white = mats.plastic("Plastic_OutletWhite", (0.72, 0.71, 0.68), 0.35)
    bm = bmesh.new()
    geo.rounded_box(bm, (70.0, 115.0, 6.0), 4.0, matrix=geo.TO_XZ)
    plate = geo.mesh_object("WallOutlet_Plate", bm, col, white, parent=parent, location_mm=(x, wall_y - 3.0, z))
    geo.bevel(plate, 1.5, segments=2)
    for dz in (-22.0, 22.0):
        bm = bmesh.new()
        geo.rounded_box(bm, (38.0, 32.0, 3.0), 5.0, matrix=geo.TO_XZ)
        geo.mesh_object("WallOutlet_Socket", bm, col, white, parent=parent, location_mm=(x, wall_y - 7.0, z + dz))
    plug_face = Vector((x, wall_y - 8.5, z + 22.0))
    return _plug(col, parent, "WallOutlet_Plug", plug_face, Vector((0, -1, 0.15)), (34.0, 30.0, 26.0), material)
