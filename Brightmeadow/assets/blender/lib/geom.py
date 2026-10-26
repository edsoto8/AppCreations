"""Procedural geometry helpers built on bmesh (no bpy.ops, so they run headless anywhere).

Shapes are returned as standalone `bmesh.types.BMesh` objects in local coordinates. A
`MeshBuilder` merges many shapes into one mesh object, giving each shape a palette material and
(optionally) a bone for rigid skinning (vertex-group weight 1.0).

Coordinates are Blender's Z-up; the front of every model faces -Y.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector, noise
from mathutils.bvhtree import BVHTree

from palette import get_material

V = Vector


# --------------------------------------------------------------------------- basic utilities

def mat_trs(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Matrix from location, XYZ euler rotation in degrees, scale."""
    from mathutils import Euler
    e = Euler([math.radians(a) for a in rot], "XYZ")
    s = scale if hasattr(scale, "__len__") else (scale, scale, scale)
    return Matrix.LocRotScale(V(loc), e.to_quaternion(), V(s))


def transform(bm, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return bm


def deform(bm, fn):
    """Apply fn(co: Vector) -> Vector to every vertex."""
    for v in bm.verts:
        v.co = fn(v.co.copy())
    return bm


def copy_bm(bm):
    out = bm.copy()
    return out


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))) if e1 != e0 else (1.0 if x >= e1 else 0.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def set_smooth(bm, smooth=True):
    for f in bm.faces:
        f.smooth = smooth
    return bm


def mark_sharp(bm, angle_deg):
    """Mark edges whose dihedral angle exceeds angle_deg as sharp (split normals on export)."""
    lim = math.radians(angle_deg)
    bm.normal_update()
    for e in bm.edges:
        if len(e.link_faces) == 2:
            try:
                if e.calc_face_angle() > lim:
                    e.smooth = False
            except ValueError:
                pass
    return bm


def tri_count(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


def bounds(bm):
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    return V((min(xs), min(ys), min(zs))), V((max(xs), max(ys), max(zs)))


def noise_displace(bm, amp, scale, seed=0, along_normal=True):
    """Low-frequency Perlin displacement (deterministic: offset derived from seed)."""
    rnd = random.Random(seed)
    off = V((rnd.uniform(-100, 100), rnd.uniform(-100, 100), rnd.uniform(-100, 100)))
    bm.normal_update()
    moves = []
    for v in bm.verts:
        n = noise.noise(v.co * scale + off)
        d = v.normal if along_normal else V((0, 0, 1))
        moves.append(d * (n * amp))
    for v, m in zip(bm.verts, moves):
        v.co += m
    return bm


# --------------------------------------------------------------------------- primitive shapes

def quad_sphere(cuts=6):
    """Unit sphere made from a subdivided cube (even quads, subdivides nicely)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    if cuts > 0:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    q = math.pi / 4
    for v in bm.verts:
        c = v.co
        v.co = V((math.tan(c.x * q), math.tan(c.y * q), math.tan(c.z * q))).normalized()
    set_smooth(bm)
    return bm


def uv_sphere(segments=16, rings=10, radius=1.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    set_smooth(bm)
    return bm


def blob(radii=(1, 1, 1), center=(0, 0, 0), cuts=6, exponent=1.0, fn=None):
    """Ellipsoid / superellipsoid (exponent < 1 is boxier). Optional fn deforms the unit
    shape (applied before scaling, receives a unit-sphere coordinate)."""
    bm = quad_sphere(cuts)
    rx, ry, rz = radii
    c = V(center)
    for v in bm.verts:
        d = v.co
        if exponent != 1.0:
            d = V([math.copysign(abs(a) ** exponent, a) for a in d])
        if fn is not None:
            d = fn(d)
        v.co = c + V((d.x * rx, d.y * ry, d.z * rz))
    return bm


def lathe(profile, segments=16, center=(0, 0, 0), axis="Z", smooth=True, cap=True):
    """Revolve [(radius, height), ...] around an axis. Radius 0 makes a pole vertex.
    If the ends have radius > 0 and cap=True they are closed with an n-gon."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, h))])
        else:
            ring = []
            for k in range(segments):
                a = 2 * math.pi * k / segments
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), h)))
            rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for k in range(segments):
                bm.faces.new((a[0], b[(k + 1) % segments], b[k]))
        elif len(b) == 1:
            for k in range(segments):
                bm.faces.new((a[k], a[(k + 1) % segments], b[0]))
        else:
            for k in range(segments):
                k2 = (k + 1) % segments
                bm.faces.new((a[k], a[k2], b[k2], b[k]))
    if cap:
        if len(rings[0]) > 1:
            bm.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    set_smooth(bm, smooth)
    rot = {"Z": Matrix.Identity(4),
           "Y": Matrix.Rotation(math.radians(-90), 4, "X"),   # +Z -> -Y (faces the camera)
           "X": Matrix.Rotation(math.radians(90), 4, "Y")}[axis]
    transform(bm, Matrix.Translation(V(center)) @ rot)
    return bm


def _catmull(points, values, samples):
    """Catmull-Rom resample of points (and per-point scalar/tuple values)."""
    pts = [V(p) for p in points]
    n = len(pts)
    if n < 2:
        raise ValueError("need >= 2 points")
    ext = [pts[0] + (pts[0] - pts[1])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    outp, outv = [], []
    for i in range(n - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        for s in range(samples):
            t = s / samples
            t2, t3 = t * t, t * t * t
            p = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                       + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            outp.append(p)
            outv.append(_lerp_val(values[i], values[i + 1], t))
    outp.append(pts[-1])
    outv.append(values[-1])
    return outp, outv


def _lerp_val(a, b, t):
    if isinstance(a, (tuple, list)):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return a + (b - a) * t


def tube(points, radii, segments=12, samples=4, caps=("round", "round"), up=(0, 0, 1),
         ellipse=(1.0, 1.0), cap_rings=3, cap_scale=1.0, smooth=True, twist=None):
    """Sweep a (possibly elliptical) circle along a Catmull-Rom spline through `points`.

    radii: one radius per control point (float), or (rx, ry) tuples for elliptical sections.
    ellipse: global section scale along (N, B) where N is the frame normal closest to `up`.
    caps: 'round' (hemispherical dome), 'flat' (n-gon), 'point' (cone tip) or None (open).
    """
    tw = twist if twist is not None else [0.0] * len(points)
    rvals = [(r[0], r[1], a) if isinstance(r, (tuple, list)) else (r, r, a)
             for r, a in zip(radii, tw)]
    P, R = _catmull(points, rvals, samples) if len(points) > 2 or samples > 1 else (
        [V(p) for p in points], rvals)
    n = len(P)
    T = []
    for i in range(n):
        a = P[max(i - 1, 0)]
        b = P[min(i + 1, n - 1)]
        T.append((b - a).normalized())
    upv = V(up)
    N0 = upv - T[0] * upv.dot(T[0])
    if N0.length < 1e-5:
        N0 = V((1, 0, 0)) - T[0] * T[0].x
    N = [N0.normalized()]
    for i in range(1, n):
        q = T[i - 1].rotation_difference(T[i])
        N.append((q @ N[-1]).normalized())
    N = [(Quaternion(T[i], math.radians(R[i][2])) @ N[i]).normalized() for i in range(n)]
    bm = bmesh.new()
    rings = []
    for i in range(n):
        Bv = T[i].cross(N[i]).normalized()
        rx, ry = R[i][0], R[i][1]
        ring = []
        for k in range(segments):
            a = 2 * math.pi * k / segments
            off = N[i] * (math.cos(a) * rx * ellipse[0]) + Bv * (math.sin(a) * ry * ellipse[1])
            ring.append(bm.verts.new(P[i] + off))
        rings.append(ring)
    for i in range(n - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(segments):
            k2 = (k + 1) % segments
            bm.faces.new((a[k], a[k2], b[k2], b[k]))

    def add_cap(idx, direction, kind):
        ring = rings[idx]
        c = P[idx]
        rx, ry = R[idx][0], R[idx][1]
        if kind is None:
            return
        if kind == "flat":
            f = bm.faces.new(ring if direction > 0 else list(reversed(ring)))
            return
        Tn = T[idx] * direction
        Bv = T[idx].cross(N[idx]).normalized()
        prev = ring
        steps = cap_rings if kind == "round" else 1
        rmean = (rx * ellipse[0] + ry * ellipse[1]) * 0.5
        for s in range(1, steps + 1):
            ang = (math.pi / 2) * s / steps
            if s == steps:
                tip_len = rmean * cap_scale if kind == "round" else rmean * cap_scale
                tip = bm.verts.new(c + Tn * tip_len)
                for k in range(segments):
                    k2 = (k + 1) % segments
                    if direction > 0:
                        bm.faces.new((prev[k], prev[k2], tip))
                    else:
                        bm.faces.new((prev[k2], prev[k], tip))
                break
            cr = math.cos(ang)
            cz = math.sin(ang) * rmean * cap_scale
            ring2 = []
            for k in range(segments):
                a = 2 * math.pi * k / segments
                off = N[idx] * (math.cos(a) * rx * ellipse[0] * cr) + Bv * (
                    math.sin(a) * ry * ellipse[1] * cr)
                ring2.append(bm.verts.new(c + Tn * cz + off))
            for k in range(segments):
                k2 = (k + 1) % segments
                if direction > 0:
                    bm.faces.new((prev[k], prev[k2], ring2[k2], ring2[k]))
                else:
                    bm.faces.new((prev[k2], prev[k], ring2[k], ring2[k2]))
            prev = ring2

    add_cap(0, -1, caps[0])
    add_cap(n - 1, 1, caps[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    set_smooth(bm, smooth)
    return bm


def torus(major, minor, segments=24, ring_segments=8, center=(0, 0, 0), minor_z=None,
          major_y=None):
    """Torus around Z. minor_z squashes the tube vertically; major_y makes an elliptical ring."""
    bm = bmesh.new()
    mz = minor if minor_z is None else minor_z
    my = major if major_y is None else major_y
    rings = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for j in range(ring_segments):
            b = 2 * math.pi * j / ring_segments
            r = minor * math.cos(b)
            ring.append(bm.verts.new((ca * (major + r), sa * (my + r), mz * math.sin(b))))
        rings.append(ring)
    for i in range(segments):
        a, b2 = rings[i], rings[(i + 1) % segments]
        for j in range(ring_segments):
            j2 = (j + 1) % ring_segments
            bm.faces.new((a[j], b2[j], b2[j2], a[j2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    set_smooth(bm)
    transform(bm, Matrix.Translation(V(center)))
    return bm


def loft(sections, segments=24, caps=(True, True), samples=3):
    """Loft superellipse rings. sections: [(center(x,y,z), rx, ry, exponent), ...] stacked
    along Z (each ring lies in a horizontal plane). Catmull-Rom smoothed between sections."""
    centers = [V(s[0]) for s in sections]
    vals = [(s[1], s[2], s[3]) for s in sections]
    P, R = _catmull(centers, vals, samples)
    bm = bmesh.new()
    rings = []
    for c, (rx, ry, e) in zip(P, R):
        ring = []
        for k in range(segments):
            a = 2 * math.pi * k / segments - math.pi / 2   # start at front (-Y)
            ca, sa = math.cos(a), math.sin(a)
            x = math.copysign(abs(ca) ** e, ca) * rx
            y = math.copysign(abs(sa) ** e, sa) * ry
            ring.append(bm.verts.new((c.x + x, c.y + y, c.z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(segments):
            k2 = (k + 1) % segments
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    if caps[0]:
        bm.faces.new(list(reversed(rings[0])))
    if caps[1]:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    set_smooth(bm)
    return bm


def extrude_shape(pts2d, depth, center_z=True):
    """Extrude a closed 2D polygon [(x, y), ...] (counter-clockwise) along +Z."""
    bm = bmesh.new()
    z0 = -depth / 2 if center_z else 0.0
    bot = [bm.verts.new((x, y, z0)) for x, y in pts2d]
    top = [bm.verts.new((x, y, z0 + depth)) for x, y in pts2d]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    set_smooth(bm, False)
    return bm


def box(size, center=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    transform(bm, Matrix.Translation(V(center)) @ Matrix.Diagonal(V((*size, 1.0))))
    set_smooth(bm, False)
    return bm


def cylinder(radius, depth, segments=16, center=(0, 0, 0), radius2=None):
    r2 = radius if radius2 is None else radius2
    bm = lathe([(radius, -depth / 2), (r2, depth / 2)], segments=segments, smooth=True)
    transform(bm, Matrix.Translation(V(center)))
    return bm


# --------------------------------------------------------------------------- modifiers

def apply_modifiers(bm, mods):
    """Run Blender modifiers on a bmesh and return a new bmesh with the result.
    mods: [(type, {attr: value}), ...] e.g. [("BEVEL", {"width": 0.02, "segments": 3})]."""
    me = bpy.data.meshes.new("_tmp_mod")
    bm.to_mesh(me)
    ob = bpy.data.objects.new("_tmp_mod", me)
    bpy.context.scene.collection.objects.link(ob)
    for kind, kw in mods:
        m = ob.modifiers.new(kind.lower(), kind)
        for k, v in kw.items():
            setattr(m, k, v)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = ob.evaluated_get(dg)
    me2 = bpy.data.meshes.new_from_object(ev)
    out = bmesh.new()
    out.from_mesh(me2)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(me2)
    return out


def bevel(bm, width, segments=3, angle=30.0, profile=0.5):
    return apply_modifiers(bm, [("BEVEL", {"width": width, "segments": segments,
                                           "limit_method": "ANGLE",
                                           "angle_limit": math.radians(angle),
                                           "profile": profile})])


def subdivide(bm, levels=2):
    out = apply_modifiers(bm, [("SUBSURF", {"levels": levels, "render_levels": levels})])
    set_smooth(out)
    return out


# --------------------------------------------------------------------------- surface queries

class Surface:
    """Ray-cast helper over a bmesh (used to stick eyes, straps, hair onto curved shapes)."""

    def __init__(self, bm):
        bm.normal_update()
        self.tree = BVHTree.FromBMesh(bm)

    def hit(self, origin, direction, dist=200.0):
        loc, nrm, _i, _d = self.tree.ray_cast(V(origin), V(direction).normalized(), dist)
        return loc, nrm

    def front(self, x, z, y_from=-5.0):
        """First hit when looking along +Y from the front at (x, z)."""
        return self.hit((x, y_from, z), (0, 1, 0))

    def radial(self, center, direction):
        """Hit from far outside back towards `center` along -direction."""
        d = V(direction).normalized()
        c = V(center)
        return self.hit(c + d * 5.0, -d)


def orient_to(normal, up=(0, 0, 1)):
    """Rotation matrix whose local -Y axis points along `normal` (front-facing decals)."""
    n = V(normal).normalized()
    fwd = -n                     # local +Y points into the surface
    upv = V(up)
    x = fwd.cross(upv)
    if x.length < 1e-5:
        x = V((1, 0, 0))
    x.normalize()
    z = x.cross(fwd).normalized()
    m = Matrix((x, fwd, z)).transposed()
    return m.to_4x4()


# --------------------------------------------------------------------------- mesh builder

class MeshBuilder:
    """Accumulates parts into one mesh with palette materials and rigid-skin vertex groups."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.deform = self.bm.verts.layers.deform.verify()
        self.mats = []
        self.groups = []
        self.log = []   # (material, bone, triangles) per added part, for budget tuning

    def _mat_index(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def add(self, part, mat, bone=None, matrix=None, smooth=None, sharp=None):
        """Merge `part` (BMesh). mat: palette name, or list mapping the part's material
        indices to palette names. bone: vertex group (weight 1.0). sharp: angle (deg) above
        which edges are marked sharp. smooth: force face smoothing on/off."""
        if matrix is not None:
            transform(part, matrix)
        if smooth is not None:
            set_smooth(part, smooth)
        if sharp is not None:
            mark_sharp(part, sharp)
        mats = mat if isinstance(mat, (list, tuple)) else [mat]
        idx = [self._mat_index(m) for m in mats]
        self.log.append((mats[0], bone if isinstance(bone, str) or bone is None else "weights",
                         tri_count(part)))
        gidx = None
        weight_fn = None
        if callable(bone):
            weight_fn = bone
        elif bone is not None:
            gidx = self._group_index(bone)
        vmap = {}
        for v in part.verts:
            nv = self.bm.verts.new(v.co)
            if gidx is not None:
                nv[self.deform][gidx] = 1.0
            elif weight_fn is not None:
                ws = {b: w for b, w in weight_fn(v.co).items() if w > 1e-4}
                tot = sum(ws.values()) or 1.0
                for b, w in ws.items():
                    nv[self.deform][self._group_index(b)] = w / tot
            vmap[v] = nv
        for f in part.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue  # duplicate face; skip
            nf.material_index = idx[min(f.material_index, len(idx) - 1)]
            nf.smooth = f.smooth
        for e in part.edges:
            if not e.smooth:
                ne = self.bm.edges.get((vmap[e.verts[0]], vmap[e.verts[1]]))
                if ne is not None:
                    ne.smooth = False
        part.free()
        return self

    def _group_index(self, bone):
        if bone not in self.groups:
            self.groups.append(bone)
        return self.groups.index(bone)

    def triangles(self):
        return tri_count(self.bm)

    def to_object(self, collection, weighted_normals=True):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(get_material(m))
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        for g in self.groups:
            ob.vertex_groups.new(name=g)
        if weighted_normals:
            wn = ob.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            wn.keep_sharp = True
            wn.weight = 50
        return ob
