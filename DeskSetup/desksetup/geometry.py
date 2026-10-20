"""Mesh and object helpers shared by every component.

Convention: every length passed to these helpers is in **millimetres**. They convert to Blender
metres (1 BU = 1 m, which keeps Cycles' light units physical) at the point where vertex
coordinates, locations, modifier widths and curve radii are written.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

MM = 0.001

# Maps an outline drawn in local XY onto the world YZ plane, extruding along world X
# (local X -> Y, local Y -> Z, local Z -> X).
TO_YZ = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
# Maps an outline drawn in local XY onto the world XZ plane (local Y -> -Z), extruding along +Y.
TO_XZ = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def m(value_mm: float) -> float:
    return value_mm * MM


def v(xyz_mm: Sequence[float]) -> Vector:
    return Vector(xyz_mm) * MM


# --------------------------------------------------------------------------- collections/objects


def collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if col.name not in parent.children:
        parent.children.link(col)
    return col


def empty(name: str, col: bpy.types.Collection, location_mm=(0, 0, 0), rotation_deg=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.05
    col.objects.link(obj)
    place(obj, location_mm, rotation_deg, parent)
    return obj


def place(obj, location_mm=(0, 0, 0), rotation_deg=(0, 0, 0), parent=None):
    if parent is not None:
        obj.parent = parent
    obj.location = v(location_mm)
    obj.rotation_euler = Euler([math.radians(a) for a in rotation_deg], "XYZ")
    return obj


def mesh_object(name: str, bm: bmesh.types.BMesh, col, material=None, parent=None, location_mm=(0, 0, 0),
                rotation_deg=(0, 0, 0), smooth: bool = True, recalc_normals: bool = True):
    """Write ``bm`` (built in millimetres) to a new mesh object. Closed solids get outward normals
    recalculated; pass ``recalc_normals=False`` for open sheets whose facing matters."""
    if recalc_normals:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform(Matrix.Scale(MM, 4))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    if material is not None:
        for mat in material if isinstance(material, (list, tuple)) else [material]:
            me.materials.append(mat)
    place(obj, location_mm, rotation_deg, parent)
    return obj


def bevel(obj, width_mm: float, segments: int = 3, angle_deg: float = 35.0, harden: bool = True):
    """Rounded edges on every edge sharper than ``angle_deg``, with hardened normals so the large
    flat faces next to a bevel shade cleanly."""
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = m(width_mm)
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle_deg)
    mod.harden_normals = harden
    mod.use_clamp_overlap = True
    return mod


def subsurf(obj, levels: int = 2):
    mod = obj.modifiers.new("Subdivision", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    return mod


def sharpen(obj, angle_deg: float = 40.0):
    """Mark edges sharper than ``angle_deg`` as sharp (smooth shading elsewhere)."""
    obj.data.set_sharp_from_angle(angle=math.radians(angle_deg))


# --------------------------------------------------------------------------- 2D outlines


def rounded_rect(width: float, depth: float, radius: float, segments: int = 8) -> list[tuple[float, float]]:
    """Counter-clockwise rounded rectangle centred on the origin."""
    r = max(0.0, min(radius, width / 2 - 1e-4, depth / 2 - 1e-4))
    hw, hd = width / 2 - r, depth / 2 - r
    pts: list[tuple[float, float]] = []
    corners = ((hw, hd, 0.0), (-hw, hd, 90.0), (-hw, -hd, 180.0), (hw, -hd, 270.0))
    for cx, cy, start in corners:
        if r == 0:
            pts.append((cx, cy))
            continue
        for i in range(segments + 1):
            a = math.radians(start + 90.0 * i / segments)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def stadium(length: float, width: float, segments: int = 10) -> list[tuple[float, float]]:
    """Slot shape along X: a rectangle with semicircular ends (``length`` is end to end)."""
    return rounded_rect(length, width, width / 2, segments)


# --------------------------------------------------------------------------- solids


def prism(bm, outline: Sequence[tuple[float, float]], z0: float, z1: float, top_scale: float = 1.0,
          top_z_fn=None, matrix: Matrix | None = None):
    """Extrude a closed CCW outline from ``z0`` to ``z1``. ``top_z_fn(x, y)`` can bend the top
    (wedges); ``top_scale`` tapers it. Returns (bottom_face, top_face)."""
    bottom = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = []
    for x, y in outline:
        tz = top_z_fn(x, y) if top_z_fn else z1
        top.append(bm.verts.new((x * top_scale, y * top_scale, tz)))
    n = len(outline)
    fb = bm.faces.new(list(reversed(bottom)))
    ft = bm.faces.new(top)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=bottom + top)
    return fb, ft


def rounded_box(bm, size: Sequence[float], corner_radius: float, center=(0, 0, 0), segments: int = 8,
                matrix: Matrix | None = None):
    """Box with rounded vertical corners (plan view); edges get softened by a bevel modifier."""
    w, d, h = size
    outline = rounded_rect(w, d, corner_radius, segments)
    mat = Matrix.Translation(Vector(center))
    if matrix is not None:
        mat = matrix @ mat
    return prism(bm, outline, -h / 2, h / 2, matrix=mat)


def box(bm, size: Sequence[float], center=(0, 0, 0), matrix: Matrix | None = None):
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    mat = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*size, 1.0))
    if matrix is not None:
        mat = matrix @ mat
    bmesh.ops.transform(bm, matrix=mat, verts=verts)
    return verts


def cylinder(bm, radius: float, depth: float, center=(0, 0, 0), axis: str = "Z", segments: int = 48,
             radius_top: float | None = None, matrix: Matrix | None = None):
    res = bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius,
        radius2=radius if radius_top is None else radius_top, depth=depth,
    )
    rot = {"Z": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    mat = Matrix.Translation(Vector(center)) @ rot
    if matrix is not None:
        mat = matrix @ mat
    bmesh.ops.transform(bm, matrix=mat, verts=res["verts"])
    return res["verts"]


def frame_ring(bm, outer: Sequence[tuple[float, float]], inner: Sequence[tuple[float, float]], thickness: float,
               matrix: Matrix | None = None):
    """A flat ring (outer outline with an inner hole, equal vertex counts) extruded along Z."""
    assert len(outer) == len(inner)
    n = len(outer)
    layers = []
    for z in (-thickness / 2, thickness / 2):
        layers.append(([bm.verts.new((x, y, z)) for x, y in outer], [bm.verts.new((x, y, z)) for x, y in inner]))
    (o0, i0), (o1, i1) = layers
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((o0[j], o0[k], i0[k], i0[j]))  # bottom
        bm.faces.new((o1[k], o1[j], i1[j], i1[k]))  # top
        bm.faces.new((o0[k], o0[j], o1[j], o1[k]))  # outer wall
        bm.faces.new((i0[j], i0[k], i1[k], i1[j]))  # inner wall
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=o0 + i0 + o1 + i1)


def loft(bm, rings: Sequence[Sequence[tuple[float, float, float]]], cap_start: bool = True, cap_end: bool = True,
         closed: bool = True):
    """Skin a sequence of equal-length vertex rings into a surface."""
    vrings = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(vrings[0])
    for a, b in zip(vrings, vrings[1:]):
        for k in range(n if closed else n - 1):
            j = (k + 1) % n
            bm.faces.new((a[k], a[j], b[j], b[k]))
    if cap_start:
        bm.faces.new(list(reversed(vrings[0])))
    if cap_end:
        bm.faces.new(vrings[-1])
    return vrings


def screen_plane(width: float, height: float, center=(0, 0, 0), matrix: Matrix | None = None):
    """A UV-mapped rectangle in local XY facing +Z (UV 0..1 left->right, bottom->top)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    corners = [(-width / 2, -height / 2), (width / 2, -height / 2), (width / 2, height / 2), (-width / 2, height / 2)]
    verts = [bm.verts.new((center[0] + x, center[1] + y, center[2])) for x, y in corners]
    face = bm.faces.new(verts)
    for loop, (x, y) in zip(face.loops, corners):
        loop[uv].uv = (x / width + 0.5, y / height + 0.5)
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=verts)
    return bm


# --------------------------------------------------------------------------- curves


def tube_curve(name: str, points_mm: Iterable[Sequence[float]], radius_mm: float, col, material=None,
               resolution: int = 16, parent=None):
    """A smooth cable: Bezier curve through ``points_mm`` with automatic handles and a round
    profile of ``radius_mm``."""
    pts = [v(p) for p in points_mm]
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.resolution_u = resolution
    cu.render_resolution_u = resolution
    cu.bevel_depth = m(radius_mm)
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, cu)
    col.objects.link(obj)
    if material is not None:
        cu.materials.append(material)
    if parent is not None:
        obj.parent = parent
    return obj


def look_rotation(direction: Vector, up: str = "Z", track: str = "-Z") -> Euler:
    return direction.to_track_quat(track, up).to_euler()


def align_matrix(direction: Sequence[float]) -> Matrix:
    """Rotation taking +Z onto ``direction``."""
    d = Vector(direction).normalized()
    return d.to_track_quat("Z", "X" if abs(d.y) > 0.99 else "Y").to_matrix().to_4x4()
