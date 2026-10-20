"""Single-monitor gas-spring arm (Ergotron LX / Humanscale style).

Parts, bottom to top: C-clamp gripping the desk's back edge, pole, horizontal lower arm that
swivels on the pole, elbow hub, gas-spring upper arm (parallelogram, so the head stays level),
swivel head, tilt knuckle and the VESA plate screwed to the monitor. Joint positions come from
:func:`desksetup.layout._solve_arm`, so changing the monitor height re-poses the arm.
"""

from __future__ import annotations

import math

import bmesh
from mathutils import Matrix, Vector

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout

LOWER_ARM_WIDTH = 46.0
LOWER_ARM_HEIGHT = 30.0
HUB_RADIUS = 24.0


def build(cfg: SceneConfig, lay: Layout, col, monitor_root):
    a, arm, desk = cfg.arm, lay.arm, lay.desk
    metal = mats.aluminum("brushed" if a.finish == "silver" else "black")
    caps = mats.plastic("Plastic_ArmCap", (0.012, 0.012, 0.013), 0.4)
    root = geo.empty("MonitorArm", col)

    # --- C-clamp: top plate, spine behind the desk edge, lower jaw, screw and pressure pad.
    cx, cy, cz = arm.clamp
    bm = bmesh.new()
    geo.rounded_box(bm, (72.0, 68.0, 12.0), 10.0, center=(0, 0, -6.0))
    plate = geo.mesh_object("Arm_ClampPlate", bm, col, metal, parent=root, location_mm=(cx, cy, cz))
    geo.bevel(plate, 2.5, segments=3)
    back = desk.back_y
    drop = (cz - desk.bottom_z) + 42.0
    bm = bmesh.new()
    geo.box(bm, (56.0, 9.0, drop), center=(0, 0, -drop / 2 + (cz - desk.top_z)))
    spine = geo.mesh_object("Arm_ClampSpine", bm, col, metal, parent=root, location_mm=(cx, back + 4.5, desk.top_z))
    geo.bevel(spine, 2.0, segments=3)
    jaw_z = desk.bottom_z - 38.0
    bm = bmesh.new()
    geo.box(bm, (56.0, 62.0, 9.0))
    jaw = geo.mesh_object("Arm_ClampJaw", bm, col, metal, parent=root, location_mm=(cx, back - 22.0, jaw_z))
    geo.bevel(jaw, 2.0, segments=3)
    screw_y = back - 36.0
    bm = bmesh.new()
    geo.cylinder(bm, 6.0, desk.bottom_z - jaw_z, center=(0, 0, (desk.bottom_z - jaw_z) / 2 - 4))
    geo.mesh_object("Arm_ClampScrew", bm, col, mats.steel(), parent=root, location_mm=(cx, screw_y, jaw_z))
    bm = bmesh.new()
    geo.cylinder(bm, 20.0, 5.0)
    pad = geo.mesh_object("Arm_ClampPad", bm, col, mats.rubber(), parent=root, location_mm=(cx, screw_y, desk.bottom_z - 2.5))
    geo.bevel(pad, 1.0, segments=2)
    bm = bmesh.new()
    _knurled_knob(bm, 17.0, 20.0)
    geo.mesh_object("Arm_ClampKnob", bm, col, caps, parent=root, location_mm=(cx, screw_y, jaw_z - 4.5 - 10.0))

    # --- Pole with a black top collar under the lower-arm hub.
    px, py, pz = arm.pole_top
    pole_len = pz - cz
    bm = bmesh.new()
    geo.cylinder(bm, a.pole_radius_mm, pole_len, center=(0, 0, pole_len / 2), segments=64)
    pole = geo.mesh_object("Arm_Pole", bm, col, metal, parent=root, location_mm=(cx, cy, cz))
    geo.bevel(pole, 1.0, segments=2)
    bm = bmesh.new()
    geo.cylinder(bm, a.pole_radius_mm + 3.0, 10.0, center=(0, 0, 5.0), segments=64)
    collar = geo.mesh_object("Arm_PoleCollar", bm, col, caps, parent=root, location_mm=(cx, cy, cz))
    geo.bevel(collar, 1.5, segments=2)

    # --- Lower arm (horizontal link) with hubs at the pole and the elbow.
    p0, e = Vector(arm.pole_top), Vector(arm.elbow)
    span = (e - p0).length
    yaw = math.degrees(math.atan2(e.y - p0.y, e.x - p0.x))
    mid = (p0 + e) / 2
    bm = bmesh.new()
    geo.prism(bm, geo.stadium(span + LOWER_ARM_WIDTH, LOWER_ARM_WIDTH, 14), -LOWER_ARM_HEIGHT / 2, LOWER_ARM_HEIGHT / 2)
    link = geo.mesh_object("Arm_LowerArm", bm, col, metal, parent=root, location_mm=tuple(mid), rotation_deg=(0, 0, yaw))
    geo.bevel(link, 3.0, segments=4)
    for name, centre in (("Arm_PoleHub", p0), ("Arm_ElbowHub", e)):
        bm = bmesh.new()
        geo.cylinder(bm, HUB_RADIUS, LOWER_ARM_HEIGHT + 8.0, segments=64)
        hub = geo.mesh_object(name, bm, col, metal, parent=root, location_mm=tuple(centre))
        geo.bevel(hub, 2.0, segments=3)
        bm = bmesh.new()
        geo.cylinder(bm, HUB_RADIUS - 4.0, 1.2, center=(0, 0, (LOWER_ARM_HEIGHT + 8.0) / 2 + 0.4), segments=64)
        geo.mesh_object(name + "Cap", bm, col, caps, parent=root, location_mm=tuple(centre))

    # --- Gas-spring upper arm from the elbow knuckle to the head knuckle.
    h = Vector(arm.head)
    _upper_arm(col, root, metal, caps, Vector(arm.elbow_knuckle), h)
    bm = bmesh.new()
    geo.cylinder(bm, 15.0, 26.0, center=(0, 0, 0), segments=48)
    riser = geo.mesh_object("Arm_ElbowRiser", bm, col, metal, parent=root,
                            location_mm=tuple(e + Vector((0, 0, LOWER_ARM_HEIGHT / 2 + 8.0))))
    geo.bevel(riser, 1.5, segments=2)

    # --- Head: vertical swivel, neck to the tilt knuckle, VESA plate on the monitor.
    bm = bmesh.new()
    geo.cylinder(bm, 17.0, 52.0, segments=48)
    head = geo.mesh_object("Arm_HeadSwivel", bm, col, metal, parent=root, location_mm=tuple(h))
    geo.bevel(head, 2.0, segments=3)

    mon = cfg.monitor
    back_y = mon.panel_thickness_mm + mon.rear_housing_depth_mm
    bm = bmesh.new()
    geo.rounded_box(bm, (a.vesa_mm + 16.0, a.vesa_mm + 16.0, 5.0), 8.0, matrix=geo.TO_XZ)
    vesa = geo.mesh_object("Arm_VESAPlate", bm, col, metal, parent=monitor_root, location_mm=(0, back_y + 2.5, 0))
    geo.bevel(vesa, 1.2, segments=2)
    for sx in (-1, 1):
        for sz in (-1, 1):
            bm = bmesh.new()
            geo.cylinder(bm, 4.2, 2.2, axis="Y", segments=24)
            geo.mesh_object("Arm_VESAScrew", bm, col, mats.steel(), parent=monitor_root,
                            location_mm=(sx * a.vesa_mm / 2, back_y + 6.0, sz * a.vesa_mm / 2))
    # Tilt knuckle: a horizontal barrel just behind the plate, and the neck back to the swivel.
    bm = bmesh.new()
    geo.cylinder(bm, 13.0, 60.0, axis="X", segments=48)
    knuckle = geo.mesh_object("Arm_TiltKnuckle", bm, col, metal, parent=monitor_root, location_mm=(0, back_y + 18.0, 0))
    geo.bevel(knuckle, 2.0, segments=3)
    tilt_world = Vector(lay.monitor.to_world((0, back_y + 18.0, 0)))
    neck_len = (h - tilt_world).length + 4.0
    bm = bmesh.new()
    geo.rounded_box(bm, (30.0, neck_len, 26.0), 6.0)
    neck = geo.mesh_object("Arm_HeadNeck", bm, col, metal, parent=root, location_mm=tuple((h + tilt_world) / 2))
    geo.bevel(neck, 2.5, segments=3)
    return root


def _upper_arm(col, root, metal, caps, start: Vector, end: Vector):
    """Tapered parallelogram housing between two knuckles, with a black cable-channel cover on its
    underside."""
    d = end - start
    length = d.length
    yaw = math.atan2(d.y, d.x)
    pitch = math.atan2(d.z, math.hypot(d.x, d.y))
    # Local frame: +X along the arm, +Z up across its section.
    orient = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(-pitch, 4, "Y")
    bm = bmesh.new()
    rings = []
    steps = 12
    for i in range(steps + 1):
        s = i / steps
        x = 6.0 + s * (length - 12.0)
        w = 44.0 - 8.0 * s
        hgt = 40.0 - 8.0 * s
        rings.append([(x, py, pz) for py, pz in _section(w, hgt)])
    geo.loft(bm, rings)
    body = geo.mesh_object("Arm_UpperArm", bm, col, metal, parent=root, location_mm=tuple(start))
    body.matrix_basis = Matrix.Translation(start * geo.MM) @ orient
    geo.sharpen(body, 40.0)

    bm = bmesh.new()
    geo.box(bm, (length - 70.0, 24.0, 3.0), center=(length / 2, 0, -17.0))
    cover = geo.mesh_object("Arm_CableCover", bm, col, caps, parent=root)
    cover.matrix_basis = Matrix.Translation(start * geo.MM) @ orient
    geo.bevel(cover, 1.0, segments=2)

    for name, centre in (("Arm_ElbowKnuckle", start), ("Arm_HeadKnuckle", end)):
        bm = bmesh.new()
        geo.cylinder(bm, 19.0, 50.0, axis="Y", segments=48)
        k = geo.mesh_object(name, bm, col, metal, parent=root)
        k.matrix_basis = Matrix.Translation(centre * geo.MM) @ Matrix.Rotation(yaw, 4, "Z")
        geo.bevel(k, 2.5, segments=3)
        for side in (-1, 1):
            bm = bmesh.new()
            geo.cylinder(bm, 12.0, 1.2, center=(0, side * 25.4, 0), axis="Y", segments=36)
            cap = geo.mesh_object(name + "Cap", bm, col, caps, parent=root)
            cap.matrix_basis = k.matrix_basis.copy()


def _section(width: float, height: float, n: int = 24):
    """Rounded-rectangle cross-section in the arm's local YZ plane."""
    return [(y, z) for y, z in geo.rounded_rect(width, height, min(width, height) * 0.38, n // 4)]


def _knurled_knob(bm, radius: float, height: float):
    verts = geo.cylinder(bm, radius, height, segments=48)
    for vtx in verts:
        ang = math.atan2(vtx.co.y, vtx.co.x)
        r = math.hypot(vtx.co.x, vtx.co.y)
        if r > 1e-6 and round(ang / (2 * math.pi) * 48) % 2:
            s = (radius - 1.2) / r
            vtx.co.x *= s
            vtx.co.y *= s
