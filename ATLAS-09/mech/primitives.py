"""Parameterized geometry generators.

Two layers:
* ``bm_*`` builders add one shape to a target bmesh (with a transform and a material slot), so a
  part can be composed of several shapes and still be one object.
* Assembly generators (bolts, vents, fans, pistons, hinges, bearings, fins, weld seams, panels)
  create finished, named objects and tag each with the bone it rides on (``ob["bone"]``).
  ``rig.py`` parents every tagged object, so part modules never deal with parenting.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import utils as U

TAU = math.tau
I4 = Matrix.Identity(4)


# =========================================================================== bmesh layer

def _append(dst, src, m, mat):
    bmesh.ops.transform(src, matrix=m, verts=src.verts)
    vmap = {v: dst.verts.new(v.co) for v in src.verts}
    for f in src.faces:
        try:
            nf = dst.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            continue
        nf.material_index = mat
        nf.smooth = f.smooth
    src.free()


def _bevel_sharp(tb, offset, segs=2, angle=30.0, profile=0.5):
    if offset <= 0:
        return
    lim = math.radians(angle)
    edges = [e for e in tb.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > lim]
    if edges:
        bmesh.ops.bevel(tb, geom=edges, offset=offset, offset_type="OFFSET", segments=segs,
                        profile=profile, affect="EDGES", clamp_overlap=True)


def bm_box(bm, sx, sy, sz, m=I4, bevel=0.0, segs=2, mat=0):
    tb = bmesh.new()
    bmesh.ops.create_cube(tb, size=1.0)
    bmesh.ops.scale(tb, vec=(sx, sy, sz), verts=tb.verts)
    _bevel_sharp(tb, min(bevel, 0.45 * min(sx, sy, sz)), segs)
    _append(bm, tb, m, mat)


def bm_cyl(bm, r, h, m=I4, segs=24, bevel=0.0, bsegs=2, r_top=None, mat=0, caps=True):
    """Cylinder/cone along local Z, centred on the origin."""
    tb = bmesh.new()
    bmesh.ops.create_cone(tb, cap_ends=caps, cap_tris=False, segments=segs, radius1=r,
                          radius2=r if r_top is None else r_top, depth=h)
    off = min(bevel, 0.3 * h, 0.3 * r)
    if off > 0 and caps:
        bm_ = tb
        bm_.normal_update()
        rims = [e for e in bm_.edges if len(e.link_faces) == 2
                and sum(abs(f.normal.z) > 0.99 for f in e.link_faces) == 1]
        bmesh.ops.bevel(bm_, geom=rims, offset=off, offset_type="OFFSET", segments=bsegs, profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    _append(bm, tb, m, mat)


def bm_lathe(bm, prof, m=I4, segs=32, mat=0, a0=0.0, a1=TAU):
    """Revolve a (radius, z) profile about local Z. Radius 0 at an end makes a pole."""
    tb = bmesh.new()
    full = abs((a1 - a0) - TAU) < 1e-6
    n = segs if full else segs + 1
    angs = [a0 + (a1 - a0) * i / segs for i in range(n)]
    rings = []
    for r, z in prof:
        if r < 1e-7:
            rings.append([tb.verts.new((0.0, 0.0, z))])
        else:
            rings.append([tb.verts.new((r * math.cos(a), r * math.sin(a), z)) for a in angs])
    for ra, rb in zip(rings, rings[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        rng_n = n if full else n - 1
        for i in range(rng_n):
            j = (i + 1) % n
            if len(ra) == 1:
                tb.faces.new((ra[0], rb[i], rb[j]))
            elif len(rb) == 1:
                tb.faces.new((ra[i], rb[0], ra[j]))
            else:
                tb.faces.new((ra[i], rb[i], rb[j], ra[j]))
    if full:
        if len(rings[0]) > 1:
            tb.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            tb.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    for f in tb.faces:
        f.smooth = True
    _append(bm, tb, m, mat)


def bm_tube(bm, ro, ri, h, m=I4, segs=32, bevel=0.0, mat=0):
    """Hollow cylinder (ring) along Z, centred."""
    c = min(bevel, 0.3 * (ro - ri), 0.3 * h)
    z0, z1 = -h / 2, h / 2
    if c > 0:
        prof = [(ri + c, z0), (ro - c, z0), (ro, z0 + c), (ro, z1 - c), (ro - c, z1),
                (ri + c, z1), (ri, z1 - c), (ri, z0 + c), (ri + c, z0)]
    else:
        prof = [(ri, z0), (ro, z0), (ro, z1), (ri, z1), (ri, z0)]
    _ring_profile(bm, prof[:-1], m, segs, mat)


def _ring_profile(bm, prof, m, segs, mat, smooth=False):
    """Closed (r, z) loop revolved into a torus-like solid."""
    tb = bmesh.new()
    rings = []
    for r, z in prof:
        rings.append([tb.verts.new((r * math.cos(TAU * i / segs), r * math.sin(TAU * i / segs), z))
                      for i in range(segs)])
    k = len(rings)
    for a in range(k):
        ra, rb = rings[a], rings[(a + 1) % k]
        for i in range(segs):
            j = (i + 1) % segs
            f = tb.faces.new((ra[i], ra[j], rb[j], rb[i]))
            f.smooth = smooth
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    _append(bm, tb, m, mat)


def bm_torus(bm, R, r, m=I4, segs=32, rsegs=12, mat=0):
    prof = [(R + r * math.cos(TAU * i / rsegs), r * math.sin(TAU * i / rsegs)) for i in range(rsegs)]
    _ring_profile(bm, prof, m, segs, mat, smooth=True)


def bm_sphere(bm, r, m=I4, segs=24, rings=12, mat=0):
    tb = bmesh.new()
    bmesh.ops.create_uvsphere(tb, u_segments=segs, v_segments=rings, radius=r)
    for f in tb.faces:
        f.smooth = True
    _append(bm, tb, m, mat)


def bm_prism(bm, pts, h, m=I4, bevel=0.0, segs=2, mat=0, cuts_x=(), cuts_y=(), bend=None, cuts_z=(),
             warp=None):
    """Extrude a 2D polygon (local XY, CCW) along Z from -h/2..h/2.

    ``cuts_x`` / ``cuts_y`` add bisecting loops so the piece can be bent afterwards;
    ``bend`` = (axis, radius) wraps the piece around an axis (see ``bend_verts``).
    """
    tb = bmesh.new()
    bot = [tb.verts.new((x, y, -h / 2)) for x, y in pts]
    top = [tb.verts.new((x, y, h / 2)) for x, y in pts]
    tb.faces.new(list(reversed(bot)))
    tb.faces.new(top)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        tb.faces.new((bot[i], bot[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    _bevel_sharp(tb, min(bevel, 0.45 * h), segs)
    for x in cuts_x:
        geom = list(tb.verts) + list(tb.edges) + list(tb.faces)
        bmesh.ops.bisect_plane(tb, geom=geom, plane_co=(x, 0, 0), plane_no=(1, 0, 0))
    for y in cuts_y:
        geom = list(tb.verts) + list(tb.edges) + list(tb.faces)
        bmesh.ops.bisect_plane(tb, geom=geom, plane_co=(0, y, 0), plane_no=(0, 1, 0))
    for z in cuts_z:
        geom = list(tb.verts) + list(tb.edges) + list(tb.faces)
        bmesh.ops.bisect_plane(tb, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1))
    if bend:
        bend_verts(tb.verts, *bend)
    if warp:
        for v in tb.verts:
            v.co = warp(v.co.copy())
    _append(bm, tb, m, mat)


def bend_verts(verts, axis, radius):
    """Wrap geometry: axis 'Y' bends X-extent around a Y-parallel axis at z=-radius
    (the piece bulges toward +Z). axis 'X' bends the Y-extent likewise."""
    for v in verts:
        x, y, z = v.co
        if axis == "Y":
            th = x / radius
            v.co = ((radius + z) * math.sin(th), y, (radius + z) * math.cos(th) - radius)
        else:
            th = y / radius
            v.co = (x, (radius + z) * math.sin(th), (radius + z) * math.cos(th) - radius)


def bm_beam(bm, p0, p1, w, d, bevel=0.0, mat=0, x_hint=Vector((1, 0, 0))):
    """Box beam from p0 to p1 (w along local X, d along local Y)."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    m = U.frame((p0 + p1) / 2, p1 - p0, x_hint)
    bm_box(bm, w, d, L, m, bevel=bevel, mat=mat)


def bm_rod(bm, p0, p1, r, segs=16, mat=0, bevel=0.0, x_hint=Vector((1, 0, 0))):
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    m = U.frame((p0 + p1) / 2, p1 - p0, x_hint)
    bm_cyl(bm, r, L, m, segs=segs, mat=mat, bevel=bevel)


def gear_profile(r_root, r_tip, teeth):
    pts = []
    for i in range(teeth):
        a = TAU * i / teeth
        da = TAU / teeth
        pts += [(r_root, a), (r_root, a + 0.10 * da), (r_tip, a + 0.28 * da),
                (r_tip, a + 0.52 * da), (r_root, a + 0.70 * da)]
    return [(r * math.cos(a), r * math.sin(a)) for r, a in pts]


def bm_gear(bm, r, teeth, h, m=I4, tooth=None, mat=0, bevel=0.002):
    tooth = tooth or 0.12 * r
    land = 0.24 * math.tau * r / teeth          # tooth tip width
    bm_prism(bm, gear_profile(r - tooth, r, teeth), h, m, bevel=min(bevel, 0.2 * land), segs=1, mat=mat)


def annular_sector(r0, r1, a0, a1, n=16):
    """2D outline of a ring segment (CCW)."""
    outer = [(r1 * math.cos(a0 + (a1 - a0) * i / n), r1 * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    inner = [(r0 * math.cos(a1 - (a1 - a0) * i / n), r0 * math.sin(a1 - (a1 - a0) * i / n)) for i in range(n + 1)]
    return outer + inner


def poly_chamfer_rect(w, h, c, cx=0.0, cy=0.0):
    """Rectangle with 45-degree chamfered corners; c may be a 4-tuple (bl, br, tr, tl)."""
    cs = c if isinstance(c, (tuple, list)) else (c, c, c, c)
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    bl, br, tr, tl = cs
    pts = []
    pts += [(x0 + bl, y0)] if bl else [(x0, y0)]
    pts += [(x1 - br, y0), (x1, y0 + br)] if br else [(x1, y0)]
    pts += [(x1, y1 - tr), (x1 - tr, y1)] if tr else [(x1, y1)]
    pts += [(x0 + tl, y1), (x0, y1 - tl)] if tl else [(x0, y1)]
    if bl:
        pts.append((x0, y0 + bl))
    return pts


def poly_rounded_rect(w, h, r, seg=4, cx=0.0, cy=0.0):
    pts = []
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    for (ox, oy, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                         (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + ox + r * math.cos(a), cy + oy + r * math.sin(a)))
    return pts


def poly_circle(r, n=24, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(TAU * i / n), cy + r * math.sin(TAU * i / n)) for i in range(n)]


# =========================================================================== object layer

def make(name, coll, mats, builder, matrix=None, bone=None, bevel=0.0, wn=True, smooth=35.0,
         key=None):
    """Build an object from a ``builder(bm)`` callback.

    ``key`` shares the mesh between objects (linked duplicates).
    """
    def _build():
        bm = bmesh.new()
        builder(bm)
        return U.mesh_from_bm(name if key is None else f"SH_{key}", bm, smooth)

    me = U.cached_mesh(key, _build) if key else _build()
    ob = U.new_mesh_obj(name, me, coll, mats, matrix)
    if bevel > 0:
        U.add_bevel(ob, bevel)
    if wn:
        U.add_weighted_normal(ob)
    if bone:
        ob["bone"] = bone
    return ob


class Kit:
    """Bundles the materials dict and the target collection/bone for a subsystem."""

    def __init__(self, mats, coll, bone=None, fast_coll=None):
        self.M = mats
        self.coll = coll
        self.bone = bone
        self.fast = fast_coll or coll

    def at(self, bone):
        return Kit(self.M, self.coll, bone, self.fast)

    def m(self, *names):
        return [self.M[n] for n in names]


# --------------------------------------------------------------------------- fasteners

def _bolt_mesh(kind):
    def build():
        bm = bmesh.new()
        if kind == "hex":
            # washer + hex head + chamfered crown, all in a 1-unit scale (r_head = 1)
            bm_cyl(bm, 1.45, 0.25, U.T(z=0.125), segs=16, bevel=0.06, mat=0)
            bm_cyl(bm, 1.0, 0.65, U.T(z=0.25 + 0.325), segs=6, bevel=0.1, mat=0)
            bm_cyl(bm, 0.72, 0.12, U.T(z=0.96), segs=12, r_top=0.55, mat=0)
        elif kind == "socket":
            bm_lathe(bm, [(0, 0), (1.1, 0), (1.1, 0.5), (0.95, 0.68), (0.5, 0.68),
                          (0.5, 0.45), (0, 0.45)], segs=16)
        elif kind == "rivet":
            bm_lathe(bm, [(0, 0), (1.0, 0), (0.95, 0.18), (0.7, 0.38), (0.35, 0.47), (0, 0.5)],
                     segs=12)
        me = U.mesh_from_bm(f"SH_Bolt_{kind}", bm, 40)
        return me
    return build


def bolt(kit, name, matrix, size=0.012, kind="hex", mat="bolt"):
    """One fastener, as a linked duplicate of a shared mesh. Local +Z is the head axis."""
    me = U.cached_mesh(f"bolt_{kind}", _bolt_mesh(kind))
    ob = bpy.data.objects.new(name, me)
    if len(me.materials) == 0:
        me.materials.append(kit.M[mat])
    ob.matrix_world = matrix @ U.S(size)
    kit.fast.objects.link(ob)
    ob["bone"] = kit.bone or ""
    ob["fastener"] = True
    return ob


def bolt_ring(kit, prefix, matrix, radius, count, size=0.012, kind="hex", phase=0.0):
    out = []
    for i in range(count):
        a = TAU * i / count + phase
        out.append(bolt(kit, f"{prefix}_Bolt_{i:02d}",
                        matrix @ U.T(radius * math.cos(a), radius * math.sin(a), 0) @ U.R(math.degrees(a), "Z"),
                        size, kind))
    return out


def bolt_line(kit, prefix, p0, p1, normal, count, size=0.012, kind="hex", x_hint=None):
    out = []
    p0, p1 = Vector(p0), Vector(p1)
    for i in range(count):
        t = 0.5 if count == 1 else i / (count - 1)
        p = p0.lerp(p1, t)
        out.append(bolt(kit, f"{prefix}_Bolt_{i:02d}", U.frame(p, normal, x_hint or (p1 - p0)), size, kind))
    return out


# --------------------------------------------------------------------------- vents / fins

def vent(kit, prefix, matrix, w, h, slats=7, depth=0.04, angle=35.0, frame_mat="steel_dark",
         slat_mat="steel_dark"):
    """Louvred vent: a frame object + one slat with an Array modifier. Local Z is outward."""
    t = 0.022

    def frame_b(bm):
        outer = poly_chamfer_rect(w, h, 0.02)
        bm_prism(bm, poly_chamfer_rect(w, t, 0.0, cy=h / 2 - t / 2), depth, U.T(z=depth / 2), bevel=0.003)
        bm_prism(bm, poly_chamfer_rect(w, t, 0.0, cy=-h / 2 + t / 2), depth, U.T(z=depth / 2), bevel=0.003)
        bm_prism(bm, poly_chamfer_rect(t, h - 2 * t, 0.0, cx=w / 2 - t / 2), depth, U.T(z=depth / 2), bevel=0.003)
        bm_prism(bm, poly_chamfer_rect(t, h - 2 * t, 0.0, cx=-w / 2 + t / 2), depth, U.T(z=depth / 2), bevel=0.003)
        bm_box(bm, w - 2 * t, h - 2 * t, 0.006, U.T(z=0.004), mat=1)   # dark back plate
        del outer

    fr = make(f"{prefix}_Vent_Frame", kit.coll, kit.m(frame_mat, "rubber"), frame_b, matrix, kit.bone)
    pitch = (h - 2 * t) / slats
    sl_h = pitch * 1.25

    def slat_b(bm):
        bm_box(bm, w - 2 * t - 0.004, sl_h, 0.006,
               U.T(z=depth * 0.55) @ U.R(angle, "X"), bevel=0.002, segs=1)

    sl = make(f"{prefix}_Vent_Slats", kit.coll, kit.m(slat_mat), slat_b,
              matrix @ U.T(y=-h / 2 + t + pitch / 2), kit.bone, wn=False)
    arr = sl.modifiers.new("Array", "ARRAY")
    arr.count = slats
    arr.use_relative_offset = False
    arr.use_constant_offset = True
    arr.constant_offset_displace = (0, pitch, 0)
    return [fr, sl]


def fin_stack(kit, prefix, matrix, w, h, depth, count, gap, mat="titanium"):
    """Cooling fins: one fin plate + Array modifier along local X."""
    t = 0.006

    def b(bm):
        bm_prism(bm, poly_chamfer_rect(t, h, (0, 0, 0.0, 0.0)), depth, U.T(z=depth / 2))
    ob = make(f"{prefix}_CoolingFins", kit.coll, kit.m(mat), b,
              matrix @ U.T(x=-(count - 1) * gap / 2), kit.bone, wn=False)
    a = ob.modifiers.new("Array", "ARRAY")
    a.count = count
    a.use_relative_offset = False
    a.use_constant_offset = True
    a.constant_offset_displace = (gap, 0, 0)
    U.add_bevel(ob, 0.0015, 1)
    return ob


# --------------------------------------------------------------------------- fans

def fan(kit, prefix, matrix, r, depth=0.06, blades=9):
    """Shrouded cooling fan (local Z out of the housing). Housing, rotor, guard: 3 objects."""
    def house(bm):
        bm_tube(bm, r + 0.03, r + 0.004, depth, U.T(z=depth / 2), segs=40, bevel=0.006)
        for i in range(3):  # stator struts behind rotor
            a = 90 + 120 * i
            bm_box(bm, r, 0.018, 0.012, U.T(z=0.018) @ U.R(a, "Z") @ U.T(x=r / 2), mat=0)
        bm_cyl(bm, 0.28 * r, 0.03, U.T(z=0.02), segs=24, mat=0)
    hs = make(f"{prefix}_Fan_Housing", kit.coll, kit.m("steel_dark"), house, matrix, kit.bone)
    # square mounting plate with a bored opening: validated boolean, fallback keeps the solid plate
    mp = make(f"{prefix}_Fan_MountPlate", kit.coll, kit.m("steel_dark"),
              lambda bm: bm_box(bm, 2 * r + 0.08, 2 * r + 0.08, 0.012, U.T(z=0.006), bevel=0.004),
              matrix, kit.bone)
    cutter = make(f"{prefix}_Fan_Cutter", kit.coll, kit.m("steel_dark"),
                  lambda bm: bm_cyl(bm, r + 0.012, 0.05, segs=40), matrix, None, wn=False)
    U.boolean_cut(mp, [cutter], f"{prefix}_fan_bore", min_keep=0.3)
    backing = make(f"{prefix}_Fan_Backing", kit.coll, kit.m("rubber"),
                   lambda bm: bm_cyl(bm, r + 0.014, 0.004, U.T(z=-0.004), segs=40), matrix, kit.bone, wn=False)

    def rotor(bm):
        bm_cyl(bm, 0.26 * r, depth * 0.6, U.T(z=depth * 0.5), segs=24, bevel=0.006, mat=0)
        for i in range(blades):
            a = 360 * i / blades
            bl = U.R(a, "Z") @ U.T(x=0.62 * r, z=depth * 0.5) @ U.R(32, "X")
            bm_prism(bm, [(-0.36 * r, -0.03 * r), (0.34 * r, -0.07 * r), (0.36 * r, 0.10 * r),
                          (-0.34 * r, 0.05 * r)], 0.004, bl, mat=0)
    ro = make(f"{prefix}_Fan_Rotor", kit.coll, kit.m("titanium"), rotor, matrix, kit.bone)

    def guard(bm):
        for rr in (0.4 * r, 0.7 * r, r):
            bm_torus(bm, rr, 0.004, U.T(z=depth + 0.004), segs=40, rsegs=6)
        for i in range(8):
            a = 360 * i / 8
            bm_box(bm, r * 0.96, 0.008, 0.008, U.T(z=depth + 0.004) @ U.R(a, "Z") @ U.T(x=r * 0.5))
    gd = make(f"{prefix}_Fan_Guard", kit.coll, kit.m("steel_dark"), guard, matrix, kit.bone, wn=False)
    return [hs, mp, backing, ro, gd]


# --------------------------------------------------------------------------- joints

def bearing(kit, prefix, matrix, r_out, r_in, h, bolts=10, bolt_size=0.011):
    """Slewing bearing: outer race, inner race, grease seal, bolt circle. Local Z = axis."""
    def outer(bm):
        bm_tube(bm, r_out, (r_out + r_in) / 2 + 0.004, h, segs=48, bevel=0.006)
    def inner(bm):
        bm_tube(bm, (r_out + r_in) / 2, r_in, h * 1.15, segs=48, bevel=0.006)
    def seal(bm):
        bm_torus(bm, (r_out + r_in) / 2 + 0.002, 0.006, U.T(z=h / 2), segs=48, rsegs=8)
    a = make(f"{prefix}_Bearing_Outer", kit.coll, kit.m("steel_dark"), outer, matrix, kit.bone)
    b = make(f"{prefix}_Bearing_Inner", kit.coll, kit.m("titanium"), inner, matrix, kit.bone)
    c = make(f"{prefix}_Bearing_Seal", kit.coll, kit.m("grease"), seal, matrix, kit.bone, wn=False)
    bolts_ = bolt_ring(kit, prefix, matrix @ U.T(z=h / 2), (r_out + (r_out + r_in) / 2) / 2, bolts, bolt_size)
    return [a, b, c] + bolts_


# prism local XY -> world (Y, Z), prism Z -> world X (cyclic permutation, det +1)
M_YZ = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def lug_outline(d, h, n=10):
    """Lug plate outline in (y, z): rectangle down to -h with a semicircular nose at the pin."""
    pts = [(-d / 2, -h), (d / 2, -h)]
    pts += [(d / 2 * math.cos(math.pi * i / n), d / 2 * math.sin(math.pi * i / n)) for i in range(n + 1)]
    return pts


def hinge(kit, prefix, matrix, gap, r_pin, plate_h, plate_d, plate_t=0.03, mat="steel_dark"):
    """Clevis hinge: two lug plates either side of ``gap`` along local X, pin along X.

    Origin = hinge axis centre. Plates extend toward local -Z (into the parent part).
    """
    def lugs(bm):
        for sx in (1, -1):
            x = sx * (gap / 2 + plate_t / 2)
            bm_prism(bm, lug_outline(plate_d, plate_h), plate_t, U.T(x=x) @ M_YZ, bevel=0.004)
    lg = make(f"{prefix}_Hinge_Lugs", kit.coll, kit.m(mat), lugs, matrix, kit.bone)

    def pin(bm):
        L = gap + 2 * plate_t + 0.03
        bm_cyl(bm, r_pin, L, U.R(90, "Y"), segs=20, bevel=0.003, mat=0)
        for sx in (1, -1):
            bm_cyl(bm, r_pin * 1.5, 0.012, U.T(x=sx * (L / 2 - 0.004)) @ U.R(90, "Y"), segs=20, bevel=0.003, mat=0)
    pn = make(f"{prefix}_Hinge_Pin", kit.coll, kit.m("chrome"), pin, matrix, kit.bone)
    return [lg, pn]


def joint_drum(kit, prefix, matrix, r, w, mat="steel_joint", gear_mat="gear", teeth=28, grease=True):
    """Actuator drum around a joint axis (local X): housing + exposed ring gear + end caps."""
    def drum(bm):
        bm_cyl(bm, r, w, U.R(90, "Y"), segs=40, bevel=0.012)
    d = make(f"{prefix}_Drum", kit.coll, kit.m(mat), drum, matrix, kit.bone)

    def gear(bm):
        for sx in (1, -1):
            bm_gear(bm, r * 1.06, teeth, 0.035, U.T(x=sx * (w / 2 + 0.018)) @ U.R(90, "Y"), mat=0)
    g = make(f"{prefix}_RingGears", kit.coll, kit.m(gear_mat), gear, matrix, kit.bone)

    def caps(bm):
        for sx in (1, -1):
            bm_lathe(bm, [(0, 0.03), (0.42 * r, 0.03), (0.6 * r, 0.012), (0.66 * r, 0.0), (0.6 * r, -0.01),
                          (0, -0.01)],
                     U.T(x=sx * (w / 2 + 0.036)) @ U.R(90 * sx, "Y"), segs=32)
    c = make(f"{prefix}_EndCaps", kit.coll, kit.m("titanium"), caps, matrix, kit.bone)
    out = [d, g, c]
    for sx in (1, -1):
        out += bolt_ring(kit, f"{prefix}_Cap{'L' if sx > 0 else 'R'}",
                         matrix @ U.T(x=sx * (w / 2 + 0.05)) @ U.R(90 * sx, "Y"), 0.48 * r, 8, 0.009, "socket")
    if grease:
        def gr(bm):
            for sx in (1, -1):
                bm_torus(bm, r * 0.9, 0.008, U.T(x=sx * (w / 2 + 0.002)) @ U.R(90, "Y"), segs=40, rsegs=6)
        out.append(make(f"{prefix}_GreaseRing", kit.coll, kit.m("grease"), gr, matrix, kit.bone, wn=False))
    return out


# --------------------------------------------------------------------------- hydraulics

def piston(kit, prefix, p_base, p_end, bone_base, bone_end, r_barrel=0.05, r_rod=None,
           barrel_frac=0.58, coll_rig=None, color="steel_dark", rod_frac=0.62):
    """Hydraulic cylinder that follows joint motion.

    Two empties (``*_Anchor_Base`` on ``bone_base``, ``*_Anchor_Rod`` on ``bone_end``) carry the
    barrel and rod; each part gets a Damped Track constraint aimed at the other anchor, so
    the assembly telescopes and swivels as the joint moves. Geometry runs along local +Y.
    """
    p_base, p_end = Vector(p_base), Vector(p_end)
    d = p_end - p_base
    L = d.length
    r_rod = r_rod or r_barrel * 0.48
    lb = L * barrel_frac
    # Telescoping range: the rod never pokes out of the barrel's base while the pin distance
    # stays >= rod_frac * L, and stays engaged up to (barrel_frac + rod_frac) * L.
    lr = L * rod_frac
    rig_coll = coll_rig or kit.coll
    # local +Y points along the piston (Damped Track TRACK_Y), local X ~ joint axis
    m_base = U.frame_y(p_base, d, Vector((1, 0, 0)))
    me_ = U.frame_y(p_end, -d, Vector((1, 0, 0)))
    ea = U.new_empty(f"{prefix}_Anchor_Base", rig_coll, m_base, 0.05)
    eb = U.new_empty(f"{prefix}_Anchor_Rod", rig_coll, me_, 0.05)
    ea["bone"] = bone_base
    eb["bone"] = bone_end

    def barrel(bm):
        rb = r_barrel
        # clevis eye at the base
        bm_cyl(bm, rb * 0.95, rb * 1.3, U.R(90, "Y"), segs=24, bevel=0.006, mat=1)
        bm_box(bm, rb * 1.1, rb * 1.6, rb * 1.2, U.T(y=rb * 0.8), bevel=0.006, mat=1)
        # barrel body with end caps and gland
        bm_lathe(bm, [(0, rb * 1.3), (rb * 1.12, rb * 1.3), (rb * 1.18, rb * 1.45), (rb * 1.18, rb * 2.2),
                      (rb, rb * 2.3), (rb, lb - rb * 0.9), (rb * 1.16, lb - rb * 0.8),
                      (rb * 1.16, lb - rb * 0.1), (rb * 0.92, lb), (r_rod * 1.15, lb), (r_rod * 1.15, lb + rb * 0.25),
                      (0, lb + rb * 0.25)], U.R(-90, "X"), segs=28, mat=0)
        # hydraulic ports + tie rods
        for y in (rb * 1.9, lb - rb * 0.45):
            bm_cyl(bm, rb * 0.28, rb * 0.6, U.T(y=y, z=rb * 1.2), segs=12, bevel=0.003, mat=1)
            bm_cyl(bm, rb * 0.36, rb * 0.18, U.T(y=y, z=rb * 1.5), segs=6, mat=1)
        for i in range(4):
            a = TAU * (i + 0.5) / 4
            x, z = rb * 1.06 * math.cos(a), rb * 1.06 * math.sin(a)
            bm_rod(bm, (x, rb * 1.4, z), (x, lb - rb * 0.85, z), rb * 0.085, segs=8, mat=1)
    ob_b = make(f"{prefix}_Cylinder", kit.coll, kit.m(color, "titanium"), barrel, m_base)

    def rod(bm):
        rr = r_rod
        bm_cyl(bm, rr * 1.7, rr * 2.1, U.R(90, "Y"), segs=24, bevel=0.005, mat=1)   # rod eye
        bm_lathe(bm, [(0, 0.0), (rr * 1.25, rr * 0.4), (rr * 1.25, rr * 1.6), (rr, rr * 1.9),
                      (rr, lr), (0, lr)], U.R(-90, "X"), segs=24, mat=0)
    ob_r = make(f"{prefix}_Rod", kit.coll, kit.m("chrome", "titanium"), rod, me_)

    for ob, anchor, target in ((ob_b, ea, eb), (ob_r, eb, ea)):
        ob.parent = anchor
        ob.matrix_parent_inverse = anchor.matrix_world.inverted()
        c = ob.constraints.new("DAMPED_TRACK")
        c.target = target
        c.track_axis = "TRACK_Y"
    ob_b["piston"] = prefix
    ob_r["piston"] = prefix
    return {"cyl": ob_b, "rod": ob_r, "anchor_base": ea, "anchor_rod": eb, "length": L}


def mount_lug(kit, name, p, axis_dir, r=0.04, w=0.08, mat="steel_dark", base_dir=None, base_len=0.06):
    """Pillow-block lug that carries a piston pin. Pin axis = ``axis_dir``."""
    m = U.frame(p, axis_dir, Vector((0, 0, 1)))

    def b(bm):
        bm_cyl(bm, r, w, segs=24, bevel=0.006)
        bm_cyl(bm, r * 0.45, w + 0.03, segs=16, mat=1)
        if base_dir is not None:
            bd = m.to_3x3().inverted() @ Vector(base_dir).normalized()
            bm_beam(bm, (0, 0, 0), bd * (r + base_len), r * 1.5, w * 0.9, bevel=0.006,
                    x_hint=Vector((0, 0, 1)).cross(bd) if abs(bd.z) < 0.9 else Vector((1, 0, 0)))
    return make(name, kit.coll, kit.m(mat, "chrome"), b, m, kit.bone)


# --------------------------------------------------------------------------- seams / panels

def weld_seam(kit, name, pts, r=0.006, mat="weld"):
    """Weld bead along a polyline: one bead mesh, Array (fit curve) + Curve modifier."""
    cu = bpy.data.curves.new(f"{name}_Path", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (*q, 1.0)
    path = bpy.data.objects.new(f"{name}_Path", cu)
    kit.coll.objects.link(path)
    path.hide_render = True
    path.hide_viewport = True
    path["bone"] = kit.bone or ""

    def bead(bm):
        bm_sphere(bm, r, U.S(1.4, 1.0, 0.55), segs=8, rings=5)
    ob = make(name, kit.coll, kit.m(mat), bead, None, kit.bone, wn=False)
    ob.location = (0, 0, 0)
    a = ob.modifiers.new("Array", "ARRAY")
    a.fit_type = "FIT_CURVE"
    a.curve = path
    a.relative_offset_displace = (0.62, 0, 0)
    c = ob.modifiers.new("Curve", "CURVE")
    c.object = path
    c.deform_axis = "POS_X"
    ob["helper_path"] = path.name
    return ob


def armor_plate(kit, name, pts, thick, matrix, mats=("armor",), bevel=0.012, cuts_x=(), cuts_y=(),
                bend=None, extra=None):
    """Armor panel from a 2D outline, chamfered, optionally wrapped, with bevel + weighted normals."""
    def b(bm):
        bm_prism(bm, pts, thick, U.T(z=thick / 2), bevel=bevel, segs=3, cuts_x=cuts_x, cuts_y=cuts_y, bend=bend)
        if extra:
            extra(bm)
    ob = make(name, kit.coll, kit.m(*mats), b, matrix, kit.bone)
    return ob


# --------------------------------------------------------------------------- orientation helpers

def _cols(x, y, z):
    return Matrix((x, y, z)).transposed().to_4x4()


# Plate frames: local Z is the plate normal, local Y is "up" on the plate.
ORIENT = {
    "+X": _cols((0, 1, 0), (0, 0, 1), (1, 0, 0)),     # outline x -> +Y (back)
    "-X": _cols((0, -1, 0), (0, 0, 1), (-1, 0, 0)),   # outline x -> -Y (front)
    "-Y": _cols((1, 0, 0), (0, 0, 1), (0, -1, 0)),    # front-facing
    "+Y": _cols((-1, 0, 0), (0, 0, 1), (0, 1, 0)),    # back-facing
    "+Z": Matrix.Identity(4),
    "-Z": _cols((1, 0, 0), (0, -1, 0), (0, 0, -1)),
}


def side_orient(s):
    """Outward-facing plate frame for side sign s (+1 = left/+X)."""
    return ORIENT["+X"] if s > 0 else ORIENT["-X"]


def outline_side(pts, s):
    """Keep a side-plate outline's front/back meaning on both sides (see ORIENT +X/-X)."""
    if s > 0:
        return list(pts)
    return [(-x, y) for x, y in reversed(pts)]


def flip_outline_x(pts):
    return [(-x, y) for x, y in reversed(pts)]


# --------------------------------------------------------------------------- shorthand parts

def box_obj(kit, name, size, m, mat="steel_dark", bevel=0.01, wn=True, segs=2):
    return make(name, kit.coll, kit.m(mat), lambda bm: bm_box(bm, *size, bevel=bevel, segs=segs), m,
                kit.bone, wn=wn)


def cyl_obj(kit, name, r, h, m, mat="steel_dark", segs=32, bevel=0.006, r_top=None):
    return make(name, kit.coll, kit.m(mat),
                lambda bm: bm_cyl(bm, r, h, segs=segs, bevel=bevel, r_top=r_top), m, kit.bone)


def prism_obj(kit, name, pts, h, m, mat="steel_dark", bevel=0.008, **kw):
    return make(name, kit.coll, kit.m(mat),
                lambda bm: bm_prism(bm, pts, h, U.T(z=h / 2), bevel=bevel, segs=2, **kw), m, kit.bone)


def beam_obj(kit, name, p0, p1, w, d, mat="steel_dark", bevel=0.01, x_hint=Vector((1, 0, 0))):
    return make(name, kit.coll, kit.m(mat),
                lambda bm: bm_beam(bm, p0, p1, w, d, bevel=bevel, x_hint=x_hint), None, kit.bone)


# --------------------------------------------------------------------------- springs / shocks

def bm_helix(bm, R, r_wire, length, turns, m=I4, seg_turn=24, ring=8, mat=0, axis="Y"):
    """Coil spring along local +Y (0..length), closed-ground ends."""
    tb = bmesh.new()
    n = int(turns * seg_turn)
    rings = []
    for i in range(n + 1):
        t = i / n
        a = TAU * turns * t
        c = Vector((R * math.cos(a), length * t, R * math.sin(a)))
        tang = Vector((-R * math.sin(a) * TAU * turns, length, R * math.cos(a) * TAU * turns)).normalized()
        nrm = Vector((math.cos(a), 0, math.sin(a)))
        bin_ = tang.cross(nrm).normalized()
        nrm = bin_.cross(tang).normalized()
        rings.append([tb.verts.new(c + r_wire * (math.cos(TAU * k / ring) * nrm + math.sin(TAU * k / ring) * bin_))
                      for k in range(ring)])
    for ra, rb in zip(rings, rings[1:]):
        for k in range(ring):
            f = tb.faces.new((ra[k], ra[(k + 1) % ring], rb[(k + 1) % ring], rb[k]))
            f.smooth = True
    tb.faces.new(list(reversed(rings[0])))
    tb.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    _append(bm, tb, m, mat)


def coilover(kit, prefix, p_base, p_end, bone_base, bone_end, r_spring=0.055, coll_rig=None):
    """Shock absorber: damper (a small piston pair) + coil spring that stretches between the
    two anchors with a Stretch To constraint."""
    pis = piston(kit, prefix, p_base, p_end, bone_base, bone_end, r_barrel=r_spring * 0.55,
                 barrel_frac=0.55, coll_rig=coll_rig, color="titanium")
    L = pis["length"]
    ea, eb = pis["anchor_base"], pis["anchor_rod"]
    s0, s1 = 0.12 * L, 0.86 * L

    def spring(bm):
        bm_helix(bm, r_spring, r_spring * 0.16, s1 - s0, 7.5, U.T(y=s0), seg_turn=20, ring=8)
        # spring seats
        for y in (s0, s1):
            bm_cyl(bm, r_spring * 1.25, 0.012, U.T(y=y) @ U.R(-90, "X"), segs=24, bevel=0.003, mat=0)
    sp = make(f"{prefix}_Spring", kit.coll, kit.m("spring"), spring, ea.matrix_world)
    sp.parent = ea
    sp.matrix_parent_inverse = ea.matrix_world.inverted()
    c = sp.constraints.new("STRETCH_TO")
    c.target = eb
    c.rest_length = L
    c.volume = "NO_VOLUME"
    c.keep_axis = "PLANE_X"
    sp["piston"] = prefix
    pis["spring"] = sp
    return pis


# --------------------------------------------------------------------------- geometry nodes

def _gn_group(name, build):
    ng = bpy.data.node_groups.get(name)
    if ng is not None:
        return ng
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    build(ng)
    return ng


def _gn_rivet_row(ng):
    """Geometry + rivets instanced on a straight row (Mesh Line -> Instance on Points)."""
    it = ng.interface
    for nm, kind in (("Start", "NodeSocketVector"), ("End", "NodeSocketVector"), ("Count", "NodeSocketInt"),
                     ("Size", "NodeSocketFloat"), ("Rotation", "NodeSocketVector"), ("Rivet", "NodeSocketObject")):
        it.new_socket(name=nm, in_out="INPUT", socket_type=kind)
    N = ng.nodes
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    line = N.new("GeometryNodeMeshLine")
    line.mode = "END_POINTS"
    oi = N.new("GeometryNodeObjectInfo")
    oi.transform_space = "ORIGINAL"
    inst = N.new("GeometryNodeInstanceOnPoints")
    rot = N.new("FunctionNodeEulerToRotation") if hasattr(bpy.types, "FunctionNodeEulerToRotation") else None
    join = N.new("GeometryNodeJoinGeometry")
    L = ng.links.new
    L(gi.outputs["Count"], line.inputs["Count"])
    L(gi.outputs["Start"], line.inputs["Start Location"])
    L(gi.outputs["End"], line.inputs["Offset"])
    L(gi.outputs["Rivet"], oi.inputs["Object"])
    L(line.outputs["Mesh"], inst.inputs["Points"])
    L(oi.outputs["Geometry"], inst.inputs["Instance"])
    L(gi.outputs["Size"], inst.inputs["Scale"])
    if rot is not None:
        L(gi.outputs["Rotation"], rot.inputs["Euler"])
        L(rot.outputs["Rotation"], inst.inputs["Rotation"])
    else:
        L(gi.outputs["Rotation"], inst.inputs["Rotation"])
    L(gi.outputs["Geometry"], join.inputs["Geometry"])
    L(inst.outputs["Instances"], join.inputs["Geometry"])
    L(join.outputs["Geometry"], go.inputs["Geometry"])


def _gn_tread(ng):
    """Anti-slip tread: a grid of points on the plate top, alternating +-45 degree lozenges."""
    it = ng.interface
    for nm, kind in (("Size X", "NodeSocketFloat"), ("Size Y", "NodeSocketFloat"), ("Pitch", "NodeSocketFloat"),
                     ("Height", "NodeSocketFloat"), ("Lozenge", "NodeSocketObject")):
        it.new_socket(name=nm, in_out="INPUT", socket_type=kind)
    N = ng.nodes
    L = ng.links.new
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    grid = N.new("GeometryNodeMeshGrid")
    # vertices = size / pitch + 1 (integer)
    vx, vy = N.new("ShaderNodeMath"), N.new("ShaderNodeMath")
    for v, nm in ((vx, "Size X"), (vy, "Size Y")):
        v.operation = "DIVIDE"
        L(gi.outputs[nm], v.inputs[0])
        L(gi.outputs["Pitch"], v.inputs[1])
    L(gi.outputs["Size X"], grid.inputs["Size X"])
    L(gi.outputs["Size Y"], grid.inputs["Size Y"])
    L(vx.outputs[0], grid.inputs["Vertices X"])
    L(vy.outputs[0], grid.inputs["Vertices Y"])
    pos = N.new("GeometryNodeSetPosition")
    off = N.new("ShaderNodeCombineXYZ")
    L(gi.outputs["Height"], off.inputs["Z"])
    L(grid.outputs["Mesh"], pos.inputs["Geometry"])
    L(off.outputs["Vector"], pos.inputs["Offset"])
    idx = N.new("GeometryNodeInputIndex")
    mod = N.new("ShaderNodeMath")
    mod.operation = "FLOORED_MODULO"
    mod.inputs[1].default_value = 2.0
    L(idx.outputs["Index"], mod.inputs[0])
    ang = N.new("ShaderNodeMapRange")
    ang.inputs[3].default_value = 0.785
    ang.inputs[4].default_value = -0.785
    L(mod.outputs[0], ang.inputs[0])
    eul = N.new("ShaderNodeCombineXYZ")
    L(ang.outputs[0], eul.inputs["Z"])
    oi = N.new("GeometryNodeObjectInfo")
    oi.transform_space = "ORIGINAL"
    L(gi.outputs["Lozenge"], oi.inputs["Object"])
    inst = N.new("GeometryNodeInstanceOnPoints")
    L(pos.outputs["Geometry"], inst.inputs["Points"])
    L(oi.outputs["Geometry"], inst.inputs["Instance"])
    if hasattr(bpy.types, "FunctionNodeEulerToRotation"):
        e2r = N.new("FunctionNodeEulerToRotation")
        L(eul.outputs["Vector"], e2r.inputs["Euler"])
        L(e2r.outputs["Rotation"], inst.inputs["Rotation"])
    else:
        L(eul.outputs["Vector"], inst.inputs["Rotation"])
    join = N.new("GeometryNodeJoinGeometry")
    L(gi.outputs["Geometry"], join.inputs["Geometry"])
    L(inst.outputs["Instances"], join.inputs["Geometry"])
    L(join.outputs["Geometry"], go.inputs["Geometry"])


def _gn_source(kit, name, builder, mat):
    """Hidden prototype object referenced by Object Info nodes (kept out of renders/counts)."""
    ob = bpy.data.objects.get(name)
    if ob is None:
        bm = bmesh.new()
        builder(bm)
        me = U.mesh_from_bm(name, bm, 40)
        me.materials.append(kit.M[mat])
        ob = bpy.data.objects.new(name, me)
        U.sub_coll("Rig").objects.link(ob)
        ob.hide_render = True
        ob.hide_viewport = True
        ob["gn_source"] = True
    return ob


def _set_inputs(mod, ng, values):
    """Set modifier inputs by interface name (Blender 5.x ``properties.inputs`` API, with the
    older ``mod[identifier]`` ID-property API as fallback)."""
    props = getattr(getattr(mod, "properties", None), "inputs", None)
    for item in ng.interface.items_tree:
        if getattr(item, "in_out", "") == "INPUT" and item.name in values:
            v = values[item.name]
            slot = getattr(props, item.identifier, None) if props is not None else None
            if slot is not None:
                slot.value = v
            else:
                mod[item.identifier] = v


def gn_rivet_row(kit, ob, start, end, count, size=0.01, rotation=(0.0, 0.0, 0.0)):
    """Add a Geometry Nodes rivet row to ``ob`` (positions in the object's local space)."""
    try:
        ng = _gn_group("ATLAS_GN_RivetRow", _gn_rivet_row)
        src = _gn_source(kit, "GN_Proto_Rivet",
                         lambda bm: bm_lathe(bm, [(0, 0), (1.0, 0), (0.95, 0.18), (0.7, 0.38), (0.35, 0.47),
                                                  (0, 0.5)], segs=12), "bolt")
        if ob.data.materials and kit.M["bolt"].name not in [m.name for m in ob.data.materials if m]:
            ob.data.materials.append(kit.M["bolt"])
        m = ob.modifiers.new("GN_RivetRow", "NODES")
        m.node_group = ng
        _set_inputs(m, ng, {"Start": Vector(start), "End": Vector(end) - Vector(start), "Count": count,
                            "Size": size, "Rotation": Vector(rotation), "Rivet": src})
        ob["gn_rivets"] = ob.get("gn_rivets", 0) + count
        return m
    except Exception as exc:
        U.log("GN", f"rivet row failed: {exc!r}", ob.name)


def gn_tread(kit, ob, sx, sy, pitch=0.035, height=0.0):
    """Add a Geometry Nodes anti-slip lozenge tread on the object's local XY plane at z=height."""
    try:
        ng = _gn_group("ATLAS_GN_Tread", _gn_tread)
        src = _gn_source(kit, "GN_Proto_Lozenge",
                         lambda bm: bm_box(bm, 0.022, 0.006, 0.006, U.T(z=0.002), bevel=0.0025, segs=1), "steel_dark")
        m = ob.modifiers.new("GN_Tread", "NODES")
        m.node_group = ng
        _set_inputs(m, ng, {"Size X": sx, "Size Y": sy, "Pitch": pitch, "Height": height, "Lozenge": src})
        return m
    except Exception as exc:
        U.log("GN", f"tread failed: {exc!r}", ob.name)


def add_subsurf(ob, levels=1, render=2):
    m = ob.modifiers.new("Subdivision", "SUBSURF")
    m.levels = levels
    m.render_levels = render
    return m
