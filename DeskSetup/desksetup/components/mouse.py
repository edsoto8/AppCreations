"""Right-handed ergonomic mouse (Logitech MX Master proportions).

The shell is a superellipsoid deformed into a sculpted shape: a hump behind the middle, a palm
that slopes down to the right, a narrower nose and a thumb rest flaring out on the left. Details:
knurled steel scroll wheel in a dark slot, a parting line between the two main buttons (in the
material), a mode button behind the wheel and a thumb wheel with two thumb buttons.
"""

from __future__ import annotations

import math

import bmesh

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout

WHEEL_X = -4.0
WHEEL_Y = 22.0


def _se(t: float, e: float) -> float:
    return math.copysign(abs(t) ** e, t)


def shell_point(cfg_len: float, cfg_w: float, cfg_h: float, phi: float, theta: float) -> tuple[float, float, float]:
    """Point on the mouse shell. ``phi`` runs from the top (0) to the rim (pi/2)."""
    a, b, c = cfg_w * 0.41, cfg_len / 2, cfg_h
    sp, cp = math.sin(phi), math.cos(phi)
    x = a * _se(sp, 0.72) * _se(math.cos(theta), 0.82)
    y = b * _se(sp, 0.72) * _se(math.sin(theta), 0.9)
    zn = _se(cp, 0.72)  # 0 at the rim, 1 at the top
    u = (y / b + 1) / 2  # 0 = back, 1 = nose
    hump = 0.50 + 0.50 * math.sin(math.pi * min(1.0, max(0.0, u)) ** 0.8)
    tilt = 1.0 - 0.24 * (x / a)  # left (thumb side) higher than the right
    z = c * zn * hump * tilt
    x *= 1.0 - 0.20 * u**2 - (0.08 * u if x > 0 else 0.0)  # nose narrows, more so on the right
    if x < 0:  # thumb rest
        g = math.exp(-(((u - 0.42) / 0.24) ** 2))
        low = max(0.0, 1.0 - zn / 0.55) ** 1.5
        x -= cfg_w * 0.17 * g * low * min(1.0, -math.cos(theta) * 1.6)
    return (x, y, z)


def build(cfg: SceneConfig, lay: Layout, col):
    ms = cfg.mouse
    root = geo.empty("Mouse", col, location_mm=lay.mouse.location, rotation_deg=(0, 0, lay.mouse.yaw_deg))

    n_theta, n_phi = 112, 44
    bm = bmesh.new()
    top = bm.verts.new((0.0, 0.0, 0.0))
    pts = []
    rings = []
    for i in range(1, n_phi + 1):
        phi = (math.pi / 2) * (i / n_phi) ** 0.85
        ring = []
        for j in range(n_theta):
            theta = 2 * math.pi * j / n_theta
            p = shell_point(ms.length_mm, ms.width_mm, ms.height_mm, phi, theta)
            pts.append(p)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    top.co = shell_point(ms.length_mm, ms.width_mm, ms.height_mm, 0.0, 0.0)
    for j in range(n_theta):
        k = (j + 1) % n_theta
        bm.faces.new((top, rings[0][j], rings[0][k]))
    for ra, rb in zip(rings, rings[1:]):
        for j in range(n_theta):
            k = (j + 1) % n_theta
            bm.faces.new((ra[j], rb[j], rb[k], ra[k]))
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shell_mat = mats.soft_touch("SoftTouch_Graphite", (0.030, 0.030, 0.033), split_line_x_mm=WHEEL_X,
                                split_from_y_mm=WHEEL_Y)
    shell = geo.mesh_object("Mouse_Shell", bm, col, shell_mat, parent=root)
    geo.sharpen(shell, 50.0)

    def surface_z(x: float, y: float) -> float:
        near = [p[2] for p in pts if (p[0] - x) ** 2 + (p[1] - y) ** 2 < 25.0]
        return max(near) if near else ms.height_mm * 0.7

    # Scroll wheel: knurled steel (alternating radii), sitting in a dark slot.
    wz = surface_z(WHEEL_X, WHEEL_Y)
    bm = bmesh.new()
    _knurled_wheel(bm, 10.0, 7.0, 0.35, 90)
    wheel = geo.mesh_object("Mouse_ScrollWheel", bm, col, mats.steel("Steel_Brushed", 0.32), parent=root,
                            location_mm=(WHEEL_X, WHEEL_Y, wz - 6.0))
    geo.sharpen(wheel, 30.0)
    bm = bmesh.new()
    geo.rounded_box(bm, (9.5, 19.0, 6.0), 4.5, center=(0, -2.0, 0))
    slot = geo.mesh_object("Mouse_WheelSlot", bm, col, mats.plastic("Plastic_Black", (0.006, 0.006, 0.006), 0.4), parent=root,
                           location_mm=(WHEEL_X, WHEEL_Y, wz - 3.4))
    geo.bevel(slot, 1.0, segments=2)

    # Mode-shift button behind the wheel.
    bz = surface_z(WHEEL_X, WHEEL_Y - 24)
    bm = bmesh.new()
    geo.rounded_box(bm, (8.0, 6.0, 2.0), 2.5)
    btn = geo.mesh_object("Mouse_ModeButton", bm, col, mats.plastic("Plastic_Black", (0.006, 0.006, 0.006), 0.4), parent=root,
                          location_mm=(WHEEL_X, WHEEL_Y - 24, bz - 0.4), rotation_deg=(-8, 0, 0))
    geo.bevel(btn, 0.6, segments=2)

    # Thumb wheel and two thumb buttons on the left flank.
    left_x = min(p[0] for p in pts if abs(p[1] - 8) < 4 and 20 < p[2] < 26)
    bm = bmesh.new()
    _knurled_wheel(bm, 7.0, 3.5, 0.25, 60)
    thumb = geo.mesh_object("Mouse_ThumbWheel", bm, col, mats.plastic("Plastic_ThumbWheel", (0.10, 0.10, 0.105), 0.35),
                            parent=root, location_mm=(left_x + 3.2, 8.0, 23.0), rotation_deg=(0, 72, 90))
    geo.sharpen(thumb, 30.0)
    for i, yb in enumerate((-8.0, -21.0)):
        lx = min(p[0] for p in pts if abs(p[1] - yb) < 4 and 19 < p[2] < 25)
        bm = bmesh.new()
        geo.rounded_box(bm, (11.0, 5.0, 2.0), 2.0, matrix=geo.TO_YZ)
        tb = geo.mesh_object(f"Mouse_ThumbButton{i + 1}", bm, col, shell_mat, parent=root,
                             location_mm=(lx + 0.4, yb, 21.5), rotation_deg=(0, 0, 4))
        geo.bevel(tb, 0.7, segments=2)
    return root


def _knurled_wheel(bm, radius: float, width: float, knurl: float, segments: int):
    """Wheel along local X with a ridged rim (every other rim vertex pushed in)."""
    verts = geo.cylinder(bm, radius, width, axis="X", segments=segments)
    for vtx in verts:
        r = math.hypot(vtx.co.y, vtx.co.z)
        if r < 1e-6:
            continue
        ang = math.atan2(vtx.co.z, vtx.co.y)
        idx = round(ang / (2 * math.pi) * segments)
        if idx % 2:
            s = (radius - knurl) / r
            vtx.co.y *= s
            vtx.co.z *= s
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(abs(e.verts[0].co.x) - width / 2) < 1e-4
                               and abs(abs(e.verts[1].co.x) - width / 2) < 1e-4],
                    offset=0.6, segments=2, affect="EDGES", profile=0.5)
