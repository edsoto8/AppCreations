"""Procedural geometry toolkit for Project AEGIS.

Everything the dragon is made of comes from a handful of reusable builders:

* ``Part``     - accumulates lofts, sweeps, lathes, boxes and bolts into ONE multi-material
                 mesh object (a mechanical assembly), finished with Bevel + WeightedNormal modifiers.
* ``plate``    - a single curved armor plate (open surface + Solidify + Bevel + WeightedNormal).
* helpers      - interpolation tables, Catmull-Rom splines, superellipse sections.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))


def V(*a):
    return Vector(a)


def se(c, e):
    """Superellipse shaping of a cos/sin value. e=2 -> circle, >2 boxier, <2 peaked."""
    return math.copysign(abs(c) ** (2.0 / e), c)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def table(tab, x):
    """Smoothly interpolate a table [(x, v0, v1, ...), ...] -> tuple of values at x."""
    if x <= tab[0][0]:
        return tab[0][1:]
    if x >= tab[-1][0]:
        return tab[-1][1:]
    for a, b in zip(tab, tab[1:]):
        if a[0] <= x <= b[0]:
            t = smooth((x - a[0]) / (b[0] - a[0]))
            return tuple(lerp(u, v, t) for u, v in zip(a[1:], b[1:]))


def catmull(pts, n=8):
    """Catmull-Rom spline through pts, n samples per span."""
    pts = [Vector(p) for p in pts]
    if len(pts) < 3:
        return [pts[0].lerp(pts[-1], i / n) for i in range(n + 1)]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1].copy())
    return out


def frame(d, up=Z):
    """3x3 matrix with +Y along d and +Z as close to `up` as possible."""
    y = Vector(d).normalized()
    x = y.cross(up)
    if x.length < 1e-6:
        x = y.cross(X)
    x.normalize()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed()


def frame4(origin, d, up=Z):
    m = frame(d, up).to_4x4()
    m.translation = Vector(origin)
    return m


class Part:
    """A multi-material mesh assembly built from reusable primitives."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.M = Matrix.Identity(4)

    # -- plumbing ---------------------------------------------------------------------------
    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def at(self, m):
        """Set the local construction frame (4x4). Returns self for chaining."""
        self.M = m.copy()
        return self

    def _v(self, p):
        return self.bm.verts.new(self.M @ Vector(p))

    def grid(self, rows, mat, closed=False, cap=False):
        mi = self.slot(mat)
        vr = [[self._v(p) for p in r] for r in rows]
        n = len(vr[0])
        for i in range(len(vr) - 1):
            for j in range(n if closed else n - 1):
                try:
                    f = self.bm.faces.new((vr[i][j], vr[i][(j + 1) % n], vr[i + 1][(j + 1) % n], vr[i + 1][j]))
                    f.material_index = mi
                    f.smooth = True
                except ValueError:
                    pass
        if cap and closed:
            for r in (vr[0], vr[-1]):
                f = self.bm.faces.new(r)
                f.material_index = mi
                f.smooth = True
        return self

    # -- primitives -------------------------------------------------------------------------
    def sweep(self, pts, radii, mat, n=12, up=None, exp=2.0, cap=True, phase=0.0):
        """Sweep a (super)elliptic section along a polyline.

        radii: one value or a list; each entry is r or (r_up, r_side).
        """
        pts = [Vector(p) for p in pts]
        if not isinstance(radii, (list, tuple)) or (len(radii) == 2 and len(pts) != 2):
            radii = [radii] * len(pts)
        if len(radii) != len(pts):
            radii = [radii[0]] * len(pts)
        t0 = (pts[1] - pts[0]).normalized()
        up = Vector(up) if up is not None else (Z if abs(t0.z) < 0.9 else X)
        nrm = up - t0 * up.dot(t0)
        if nrm.length < 1e-6:
            nrm = t0.orthogonal()
        nrm.normalize()
        rows = []
        for i, p in enumerate(pts):
            a = pts[max(i - 1, 0)]
            b = pts[min(i + 1, len(pts) - 1)]
            t = (b - a).normalized()
            nrm = (nrm - t * nrm.dot(t)).normalized()
            bn = t.cross(nrm)
            r = radii[i]
            ru, rs = r if isinstance(r, (tuple, list)) else (r, r)
            row = []
            for k in range(n):
                ang = phase + 2 * math.pi * k / n
                row.append(p + nrm * (ru * se(math.cos(ang), exp)) + bn * (rs * se(math.sin(ang), exp)))
            rows.append(row)
        return self.grid(rows, mat, closed=True, cap=cap)

    def lathe(self, a, d, profile, mat, n=20, up=Z):
        """Revolve profile [(t, r), ...] about the axis starting at `a` along direction `d`."""
        m = frame(d, up)
        a = Vector(a)
        rows = []
        for t, r in profile:
            rows.append([a + m @ Vector((r * math.cos(2 * math.pi * k / n), t, r * math.sin(2 * math.pi * k / n)))
                         for k in range(n)])
        return self.grid(rows, mat, closed=True)

    def cyl(self, a, b, r, mat, n=16):
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        return self.lathe(a, b - a, [(0, 0), (0, r), (L, r), (L, 0)], mat, n)

    def ball(self, c, r, mat, n=16, d=Z):
        prof = [(-r * math.cos(math.pi * i / 8), r * math.sin(math.pi * i / 8)) for i in range(9)]
        return self.lathe(Vector(c), d, prof, mat, n)

    def ring(self, c, d, R, r, mat, n=32, m=8, exp=2.0):
        """Torus (optionally square-ish section) centered at c with axis d."""
        prof = []
        for i in range(m + 1):
            a = 2 * math.pi * i / m
            prof.append((r * se(math.sin(a), exp), R + r * se(math.cos(a), exp)))
        return self.lathe(Vector(c), d, prof, mat, n)

    def box(self, c, size, mat, rot=None):
        rot = rot or Matrix.Identity(3)
        c = Vector(c)
        sx, sy, sz = (s / 2 for s in size)
        rows = []
        for y in (-sy, sy):
            rows.append([c + rot @ Vector((x, y, z)) for x, z in ((-sx, -sz), (sx, -sz), (sx, sz), (-sx, sz))])
        return self.grid(rows, mat, closed=True, cap=True)

    def beam(self, a, b, w, h, mat, up=Z, taper=1.0):
        """Rectangular beam from a to b (w across, h along `up`)."""
        return self._beam(a, b, w, h, mat, up, taper)

    def _beam(self, a, b, w, h, mat, up, taper):
        a, b = Vector(a), Vector(b)
        m = frame(b - a, up)
        rows = []
        for p, s in ((a, 1.0), (b, taper)):
            rows.append([p + m @ Vector((x * w / 2 * s, 0, z * h / 2 * s)) for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        return self.grid(rows, mat, closed=True, cap=True)

    def bolt(self, p, nrm, r, mat, h=None):
        h = h or r * 0.7
        p = Vector(p)
        self.lathe(p - Vector(nrm).normalized() * r * 0.3, nrm,
                   [(0, r * 1.45), (r * 0.3 + h * 0.25, r * 1.45), (r * 0.3 + h * 0.25, r)], mat, 12)
        return self.lathe(p, nrm, [(h * 0.2, r), (h, r), (h, 0)], mat, 6)

    def joint(self, c, axis, r, w, mat_body, mat_cap, mat_bolt=None, nb=6):
        """Hinge drum: chrome barrel across `axis` with stepped caps and a bolt circle."""
        c = Vector(c)
        ax = Vector(axis).normalized()
        a = c - ax * w / 2
        self.lathe(a, ax, [(0, 0), (0, r * 0.55), (-0.0, r * 0.55), (0.0, r * 0.8), (w * 0.12, r), (w * 0.88, r),
                           (w, r * 0.8), (w, r * 0.55), (w, 0)], mat_body, 24)
        for s in (-1, 1):
            e = c + ax * s * w / 2
            self.lathe(e, ax * s, [(0, r * 0.5), (w * 0.08, r * 0.5), (w * 0.1, r * 0.28), (w * 0.16, r * 0.28),
                                   (w * 0.16, 0)], mat_cap, 20)
            if mat_bolt:
                m = frame(ax * s)
                for k in range(nb):
                    ang = 2 * math.pi * k / nb
                    self.bolt(e + m @ Vector((math.cos(ang), 0, math.sin(ang))) * r * 0.68, ax * s, r * 0.07, mat_bolt)
        return self

    # -- finishing --------------------------------------------------------------------------
    def finish(self, coll, bevel=0.008, segments=2):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        coll.objects.link(ob)
        if bevel:
            add_bevel(ob, bevel, segments)
        return ob


def add_bevel(ob, width, segments=2):
    b = ob.modifiers.new("Bevel", 'BEVEL')
    b.width = width
    b.segments = segments
    b.limit_method = 'ANGLE'
    b.angle_limit = math.radians(35)
    w = ob.modifiers.new("WeightedNormal", 'WEIGHTED_NORMAL')
    w.keep_sharp = False
    w.weight = 80


def plate(name, fn, ns, nt, mat, coll, thick=0.03, bevel=0.009):
    """Curved armor plate. fn(s, t) -> point with s (across) and t (along) in [0, 1]."""
    p = Part(name)
    rows = [[fn(i / (ns - 1), j / (nt - 1)) for i in range(ns)] for j in range(nt)]
    p.grid(rows, mat)
    ob = p.finish(coll, bevel=0)
    s = ob.modifiers.new("Solidify", 'SOLIDIFY')
    s.thickness = thick
    s.offset = 0.0
    add_bevel(ob, min(bevel, thick * 0.4))
    return ob


def shell_fn(pt, y0, y1, a0, a1, lift=0.0, base=0.0, point=0.0, notch=0.0, pexp=2.0, round_corner=0.0):
    """Plate patch on a surface field pt(y, angle, offset).

    lift  - how far the trailing edge rises off the surface (overlap, like scales)
    point - trailing edge extends by this much at the plate centerline (chevron)
    notch - leading edge is pulled back by this much at the centerline
    """
    def fn(s, t):
        c = 1.0 - abs(2 * s - 1) ** pexp
        ya = y0 + notch * c
        yb = y1 + point * c
        y = lerp(ya, yb, t)
        a = lerp(a0, a1, s)
        if round_corner:
            # pinch the plate width toward the trailing edge
            k = 1 - round_corner * smooth((t - 0.6) / 0.4)
            a = lerp((a0 + a1) / 2, a, k)
        return pt(y, a, base + lift * t * t)
    return fn


def get_coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c
