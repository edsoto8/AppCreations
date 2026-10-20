"""Key layouts shared by the external keyboard and the laptop keyboard.

A layout is a list of rows; each row is a list of (width_units, height_units) keys. Heights below
one unit are half-height arrow keys, stacked where two of them share a slot.
"""

from __future__ import annotations

import bmesh
from mathutils import Matrix

from .. import geometry as geo

# Compact 75% Mac-style layout (MX Keys Mini / MacBook): every row is 14.5 units wide.
COMPACT_ROWS: list[list[float]] = [
    [1.5] + [1.0] * 13,  # esc, F1-F12, lock
    [1.0] * 13 + [1.5],  # ` 1-0 - = delete
    [1.5] + [1.0] * 13,  # tab q-p [ ] \
    [1.75] + [1.0] * 11 + [1.75],  # caps a-l ; ' return
    [2.25] + [1.0] * 10 + [2.25],  # shift z-/ shift
    [1.0, 1.0, 1.0, 1.5, 5.5, 1.5],  # fn ctrl opt cmd space cmd, then the arrow cluster
]
ARROW_UNITS = 3.0  # left, up/down stacked, right
ROW_UNITS = 14.5


def keycaps(pitch: float, size: float, height: float, corner: float, top_row_scale: float = 1.0,
            taper: float = 0.6):
    """Build all keycaps of the compact layout in one BMesh (millimetres, centred on the origin,
    keys standing on z=0). Returns the bmesh and the (width, depth) of the key field."""
    bm = bmesh.new()
    gap = pitch - size
    rows = len(COMPACT_ROWS)
    row_h = [pitch * (top_row_scale if r == 0 else 1.0) for r in range(rows)]
    depth = sum(row_h)
    width = ROW_UNITS * pitch
    y = depth / 2
    for r, row in enumerate(COMPACT_ROWS):
        rh = row_h[r]
        cy = y - rh / 2
        x = -width / 2
        for units in row:
            _cap(bm, x + units * pitch / 2, cy, units * pitch - gap, rh - gap, height, corner, taper)
            x += units * pitch
        if r == rows - 1:  # inverted-T arrows, MacBook style: half-height left/right, stacked up/down
            half = (rh - gap) / 2 - gap / 4
            for i in range(3):
                kx = x + (i + 0.5) * pitch
                if i == 1:
                    _cap(bm, kx, cy + rh / 4 - gap / 8, size, half, height, corner * 0.6, taper)
                _cap(bm, kx, cy - rh / 4 + gap / 8, size, half, height, corner * 0.6, taper)
        y -= rh
    return bm, (width, depth)


def _cap(bm, cx, cy, w, d, h, corner, taper):
    """One keycap; the top face is inset by ``taper`` mm on every side, like a sculpted cap."""
    outline = geo.rounded_rect(w, d, min(corner, w / 2.5, d / 2.5), 4)
    _, top = geo.prism(bm, outline, 0.0, h, matrix=Matrix.Translation((cx, cy, 0)))
    sx, sy = 1 - 2 * taper / w, 1 - 2 * taper / d
    for vtx in top.verts:
        vtx.co.x = cx + (vtx.co.x - cx) * sx
        vtx.co.y = cy + (vtx.co.y - cy) * sy
