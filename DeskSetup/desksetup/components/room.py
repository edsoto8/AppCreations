"""The room around the desk: microcement floor, painted walls with baseboards, a tall window in
the left wall with black aluminium frames and float glass, and a sheer curtain that turns the
daylight soft. The ceiling and front wall are hidden from cameras but still bounce light, like
the rest of a real room behind the photographer.
"""

from __future__ import annotations

import math
import random

import bmesh

from .. import geometry as geo
from .. import materials as mats
from ..config import SceneConfig
from ..layout import Layout

WALL = 120.0
FRONT_Y = -4600.0


def build(cfg: SceneConfig, lay: Layout, col):
    r = cfg.room
    root = geo.empty("Room", col)
    paint = mats.wall_paint()
    trim = mats.plastic("Paint_Trim", (0.72, 0.70, 0.66), 0.35, 400.0, 0.01)
    wall_y = lay.wall_y
    x0, x1, h = r.left_wall_x_mm, r.right_wall_x_mm, r.ceiling_height_mm

    def slab(name, lo, hi, material, camera=True):
        bm = bmesh.new()
        size = tuple(b - a for a, b in zip(lo, hi))
        centre = tuple((a + b) / 2 for a, b in zip(lo, hi))
        geo.box(bm, size, center=centre)
        obj = geo.mesh_object(name, bm, col, material, parent=root, smooth=False)
        obj.visible_camera = camera
        return obj

    slab("Room_Floor", (x0, FRONT_Y, -30.0), (x1, wall_y, 0.0), mats.microcement())
    slab("Room_BackWall", (x0 - WALL, wall_y, 0.0), (x1 + WALL, wall_y + WALL, h), paint)
    slab("Room_RightWall", (x1, FRONT_Y, 0.0), (x1 + WALL, wall_y, h), paint)
    slab("Room_FrontWall", (x0 - WALL, FRONT_Y - WALL, 0.0), (x1 + WALL, FRONT_Y, h), paint, camera=False)
    slab("Room_Ceiling", (x0 - WALL, FRONT_Y - WALL, h), (x1 + WALL, wall_y + WALL, h + WALL), paint, camera=False)

    # Left wall with a window opening.
    wy0, wy1 = r.window_center_y_mm - r.window_width_mm / 2, r.window_center_y_mm + r.window_width_mm / 2
    wz0, wz1 = r.window_sill_mm, r.window_sill_mm + r.window_height_mm
    lx = (x0 - WALL, x0)
    slab("Room_LeftWall_Below", (lx[0], FRONT_Y, 0.0), (lx[1], wall_y, wz0), paint)
    slab("Room_LeftWall_Above", (lx[0], FRONT_Y, wz1), (lx[1], wall_y, h), paint)
    slab("Room_LeftWall_Front", (lx[0], FRONT_Y, wz0), (lx[1], wy0, wz1), paint)
    slab("Room_LeftWall_Back", (lx[0], wy1, wz0), (lx[1], wall_y, wz1), paint)

    # Baseboards.
    bh = r.baseboard_height_mm
    for name, lo, hi in (
        ("Room_Baseboard_Back", (x0, wall_y - 12.0, 0.0), (x1, wall_y, bh)),
        ("Room_Baseboard_Left", (x0, FRONT_Y, 0.0), (x0 + 12.0, wall_y - 12.0, bh)),
        ("Room_Baseboard_Right", (x1 - 12.0, FRONT_Y, 0.0), (x1, wall_y - 12.0, bh)),
    ):
        b = slab(name, lo, hi, trim)
        geo.bevel(b, 1.5, segments=2)

    _window(col, root, (lx[0], lx[1]), (wy0, wy1), (wz0, wz1), trim)
    _curtain(col, root, x0 + 95.0, (wy0 - 280.0, wy1 + 280.0), (20.0, h - 45.0))
    return root


def _window(col, root, xs, ys, zs, trim):
    frame = mats.powder_coat((0.02, 0.02, 0.021), "PowderCoat_WindowFrame")
    glass = mats.glass_clear()
    prof, depth = 48.0, 60.0
    xc = (xs[0] + xs[1]) / 2
    ym = (ys[0] + ys[1]) / 2
    pieces = [
        ((xc, ym, zs[0] + prof / 2), (depth, ys[1] - ys[0], prof)),
        ((xc, ym, zs[1] - prof / 2), (depth, ys[1] - ys[0], prof)),
        ((xc, ys[0] + prof / 2, (zs[0] + zs[1]) / 2), (depth, prof, zs[1] - zs[0])),
        ((xc, ys[1] - prof / 2, (zs[0] + zs[1]) / 2), (depth, prof, zs[1] - zs[0])),
        ((xc, ym, (zs[0] + zs[1]) / 2), (depth, prof * 0.8, zs[1] - zs[0])),  # mullion
    ]
    for i, (c, s) in enumerate(pieces):
        bm = bmesh.new()
        geo.box(bm, s, center=c)
        obj = geo.mesh_object(f"Window_Frame{i}", bm, col, frame, parent=root, smooth=False)
        geo.bevel(obj, 1.0, segments=2)
    bm = bmesh.new()
    geo.box(bm, (6.0, ys[1] - ys[0] - prof, zs[1] - zs[0] - prof), center=(xc, ym, (zs[0] + zs[1]) / 2))
    geo.mesh_object("Window_Glass", bm, col, glass, parent=root, smooth=False)
    bm = bmesh.new()
    geo.box(bm, (xs[1] - xs[0] + 45.0, ys[1] - ys[0] + 60.0, 28.0), center=(xc + 22.5, ym, zs[0] - 14.0))
    sill = geo.mesh_object("Window_Sill", bm, col, trim, parent=root, smooth=False)
    geo.bevel(sill, 2.0, segments=2)


def _curtain(col, root, x, ys, zs):
    """Sheer curtain hanging in soft vertical folds from a slim black rod."""
    rnd = random.Random(7)
    n = 360
    phases = [rnd.uniform(0, math.tau) for _ in range(3)]
    bm = bmesh.new()
    rows = []
    for z in (zs[0], zs[0] + (zs[1] - zs[0]) * 0.5, zs[1]):
        row = []
        for i in range(n + 1):
            y = ys[0] + (ys[1] - ys[0]) * i / n
            fold = (
                22.0 * math.sin(y / 70.0 + phases[0])
                + 9.0 * math.sin(y / 31.0 + phases[1])
                + 5.0 * math.sin(y / 13.0 + phases[2]) * (1.0 - (z - zs[0]) / (zs[1] - zs[0]))
            )
            row.append(bm.verts.new((x + fold, y, z)))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    curtain = geo.mesh_object("Window_Curtain", bm, col, mats.sheer_curtain(), parent=root, recalc_normals=False)
    curtain.visible_shadow = True
    bm = bmesh.new()
    geo.cylinder(bm, 9.0, ys[1] - ys[0] + 120.0, center=(x, (ys[0] + ys[1]) / 2, zs[1] + 22.0), axis="Y", segments=24)
    geo.mesh_object("Window_CurtainRod", bm, col, mats.powder_coat(), parent=root)
