"""Shared helpers: collections, cleanup, object creation, seeding, validation, build log."""

import math
import random
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT_COLL = "ATLAS-09"
SEED = 9009

# Build log: every Boolean / Weighted-Normal / validation problem lands here and is
# written into PROGRESS.md (auto section) at the end of a run.
LOG = []
MESH_CACHE = {}
_T0 = time.time()


def log(kind, msg, obj=None):
    entry = {"kind": kind, "msg": msg, "obj": obj}
    LOG.append(entry)
    print(f"[{time.time() - _T0:7.1f}s] {kind:8s} {obj or ''} {msg}")


def seed_all(seed=SEED):
    random.seed(seed)
    return random.Random(seed)


def rng(tag):
    """Deterministic per-subsystem RNG so editing one module does not reshuffle another."""
    h = 0
    for ch in tag:
        h = (h * 131 + ord(ch)) & 0xFFFFFFFF
    return random.Random(SEED ^ h)


# --------------------------------------------------------------------------- collections

def get_coll(name, parent=None):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(coll)
    return coll


def root_coll():
    return get_coll(ROOT_COLL)


def sub_coll(name):
    return get_coll(f"{ROOT_COLL}_{name}", root_coll())


def purge_generated():
    """Delete every generated collection (and its objects), then purge orphan data."""
    root = bpy.data.collections.get(ROOT_COLL)
    if root is not None:
        for ob in list(root.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)

        def _rm(c):
            for ch in list(c.children):
                _rm(ch)
            bpy.data.collections.remove(c)

        _rm(root)
    # Factory-startup leftovers are not part of the project.
    for name in ("Cube", "Light", "Camera"):
        ob = bpy.data.objects.get(name)
        if ob is not None and "bone" not in ob:
            bpy.data.objects.remove(ob, do_unlink=True)
    # Actions are kept alive by fake users, so the orphan purge alone would leave them behind.
    for act in list(bpy.data.actions):
        if act.get("atlas09") or act.name.split(".")[0] in ("Neutral", "Demo"):
            bpy.data.actions.remove(act)
    default = bpy.data.collections.get("Collection")
    if default is not None and not default.all_objects:
        bpy.data.collections.remove(default)
    for _ in range(4):
        bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    MESH_CACHE.clear()
    LOG.clear()


# --------------------------------------------------------------------------- objects

def link(ob, coll):
    coll.objects.link(ob)
    return ob


def mesh_from_bm(name, bm, smooth_angle=35.0):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    if smooth_angle is not None:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    return me


def new_mesh_obj(name, me, coll, mats=(), matrix=None):
    ob = bpy.data.objects.new(name, me)
    if mats and len(me.materials) == 0:
        for m in mats:
            me.materials.append(m)
    if matrix is not None:
        ob.matrix_world = matrix
    link(ob, coll)
    return ob


def cached_mesh(key, builder):
    """Linked-duplicate support: one mesh datablock per key, shared by every user."""
    me = MESH_CACHE.get(key)
    if me is None or me.name not in bpy.data.meshes:
        me = builder()
        MESH_CACHE[key] = me
    return me


def new_empty(name, coll, matrix=None, size=0.1, kind="PLAIN_AXES"):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = kind
    ob.empty_display_size = size
    if matrix is not None:
        ob.matrix_world = matrix
    link(ob, coll)
    return ob


# --------------------------------------------------------------------------- modifiers

def add_bevel(ob, width=0.008, segments=2, angle=40.0, harden=False):
    try:
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width = width
        m.segments = segments
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(angle)
        m.harden_normals = harden
        m.use_clamp_overlap = True
        return m
    except Exception as exc:  # pragma: no cover - logged, not fatal
        log("BEVEL", f"failed: {exc}", ob.name)


def add_weighted_normal(ob, weight=50):
    try:
        m = ob.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        m.weight = weight
        m.keep_sharp = True
        m.mode = "FACE_AREA"
        return m
    except Exception as exc:
        log("WNORMAL", f"failed: {exc}", ob.name)
        return None


def add_solidify(ob, thickness, offset=-1.0):
    m = ob.modifiers.new("Solidify", "SOLIDIFY")
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    return m


def finish_hard_surface(ob, bevel=0.0, wn=True):
    if bevel > 0:
        add_bevel(ob, bevel)
    if wn:
        add_weighted_normal(ob)


def apply_modifiers(ob):
    """Bake the evaluated mesh into the object's own data (no bpy.ops / context needed)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def boolean_cut(target, cutters, name="cut", solver="EXACT", fallback=None, min_keep=0.5):
    """Boolean DIFFERENCE with validation and fallback.

    1. Try the given solver, then FLOAT.
    2. Reject the result when it is empty, keeps less than ``min_keep`` of the volume, or adds
       non-manifold edges.
    3. On rejection run ``fallback(target)`` (a simpler cut) and log the failure.
    Cutter objects are always deleted afterwards.
    """
    before = mesh_stats_obj(target)
    ok = False
    for sv in (solver, "FLOAT") if solver != "FLOAT" else ("FLOAT",):
        try:
            mods = []
            for c in cutters:
                m = target.modifiers.new(f"Bool_{name}", "BOOLEAN")
                m.operation = "DIFFERENCE"
                m.object = c
                m.solver = sv
                mods.append(m)
            # Keep any non-boolean modifiers (bevel/WN) live: evaluate booleans only.
            saved = _stash_modifiers(target, keep="BOOLEAN")
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(target.evaluated_get(dg))
            target.modifiers.clear()
            after = mesh_stats_me(me)
            bad = (len(me.polygons) == 0
                   or after["non_manifold"] > before["non_manifold"] + 0
                   or after["volume"] < min_keep * before["volume"])
            if bad:
                nfaces = len(me.polygons)
                bpy.data.meshes.remove(me)
                _restore_modifiers(target, saved)
                log("BOOLEAN", f"{name}: solver {sv} rejected "
                    f"(faces={nfaces}, "
                    f"nm={after['non_manifold']} vs {before['non_manifold']}, "
                    f"vol={after['volume']:.4f} vs {before['volume']:.4f})", target.name)
                continue
            old = target.data
            target.data = me
            me.name = old.name
            for mtl in old.materials:
                if mtl.name not in [x.name for x in me.materials if x]:
                    me.materials.append(mtl)
            if old.users == 0:
                bpy.data.meshes.remove(old)
            _restore_modifiers(target, saved)
            ok = True
            break
        except Exception as exc:
            target.modifiers.clear()
            log("BOOLEAN", f"{name}: solver {sv} raised {exc!r}", target.name)
    for c in cutters:
        if c.name in bpy.data.objects:
            cme = c.data
            bpy.data.objects.remove(c, do_unlink=True)
            if cme is not None and cme.users == 0:
                bpy.data.meshes.remove(cme)
    if not ok:
        log("BOOLEAN", f"{name}: all solvers failed, using fallback", target.name)
        if fallback is not None:
            try:
                fallback(target)
            except Exception as exc:
                log("BOOLEAN", f"{name}: fallback raised {exc!r}", target.name)
    return ok


def _stash_modifiers(ob, keep):
    saved = []
    for m in list(ob.modifiers):
        if m.type != keep:
            props = {p.identifier: getattr(m, p.identifier) for p in m.bl_rna.properties
                     if not p.is_readonly and p.identifier not in ("name", "type")}
            saved.append((m.name, m.type, props))
            ob.modifiers.remove(m)
    return saved


def _restore_modifiers(ob, saved):
    for name, typ, props in saved:
        m = ob.modifiers.new(name, typ)
        for k, v in props.items():
            try:
                setattr(m, k, v)
            except Exception:
                pass


# --------------------------------------------------------------------------- validation

def mesh_stats_me(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    s = _bm_stats(bm)
    bm.free()
    return s


def mesh_stats_obj(ob, evaluated=True):
    if ob.type != "MESH":
        return {"non_manifold": 0, "zero_area": 0, "loose_verts": 0, "loose_edges": 0,
                "volume": 0.0, "faces": 0}
    if evaluated:
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        s = mesh_stats_me(me)
        ev.to_mesh_clear()
        return s
    return mesh_stats_me(ob.data)


def _bm_stats(bm):
    nm = sum(1 for e in bm.edges if not e.is_manifold and not e.is_wire)
    wire = sum(1 for e in bm.edges if e.is_wire)
    zero = sum(1 for f in bm.faces if f.calc_area() < 1e-12)
    loose_v = sum(1 for v in bm.verts if not v.link_edges)
    try:
        vol = abs(bm.calc_volume(signed=False))
    except Exception:
        vol = 0.0
    return {"non_manifold": nm, "zero_area": zero, "loose_verts": loose_v,
            "loose_edges": wire, "volume": vol, "faces": len(bm.faces)}


def validate_meshes(objs, label="", allow_open=()):
    """Mesh validity pass. Returns a summary dict; problems are logged."""
    dg = bpy.context.evaluated_depsgraph_get()
    problems = []
    checked = 0
    for ob in objs:
        if ob.type != "MESH":
            continue
        checked += 1
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        bm = bmesh.new()
        bm.from_mesh(me)
        s = _bm_stats(bm)
        bm.free()
        ev.to_mesh_clear()
        open_ok = any(ob.name.startswith(p) for p in allow_open)
        issues = []
        if s["non_manifold"] and not open_ok:
            issues.append(f"non-manifold edges={s['non_manifold']}")
        if s["zero_area"]:
            issues.append(f"zero-area faces={s['zero_area']}")
        if s["loose_verts"] or s["loose_edges"]:
            issues.append(f"loose verts/edges={s['loose_verts']}/{s['loose_edges']}")
        if issues:
            problems.append((ob.name, issues))
    for name, issues in problems:
        log("MESHCHK", "; ".join(issues), name)
    return {"checked": checked, "problems": problems}


def gn_instance_check(tol=0.02):
    """Every Geometry-Nodes instance must sit on its host object: its position has to fall inside the
    host's own (pre-modifier) world bounding box grown by ``tol``. Returns a list of offenders."""
    dg = bpy.context.evaluated_depsgraph_get()
    boxes = {}
    bad = []
    for inst in dg.object_instances:
        if not inst.is_instance or inst.parent is None:
            continue
        host = inst.parent.original
        if host.type != "MESH":
            continue
        if host.name not in boxes:
            # bound_box reflects the evaluated geometry (instances included), so use the raw mesh
            mw = host.matrix_world
            pts = [mw @ v.co for v in host.data.vertices]
            if not pts:
                continue
            boxes[host.name] = (Vector((min(q.x for q in pts), min(q.y for q in pts), min(q.z for q in pts))),
                                Vector((max(q.x for q in pts), max(q.y for q in pts), max(q.z for q in pts))))
        lo, hi = boxes[host.name]
        p = inst.matrix_world.translation
        if any(p[i] < lo[i] - tol or p[i] > hi[i] + tol for i in range(3)):
            bad.append(host.name)
    out = sorted(set(bad))
    for n in out:
        log("GNCHK", f"{bad.count(n)} instance(s) outside the host bounds", n)
    return out


def world_aabb(ob):
    mw = ob.matrix_world
    pts = [mw @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def connectivity_check(objs, anchor_names, tol=0.015):
    """Every visible part must touch (AABB within tol) a chain of parts reaching an anchor.

    Returns the list of objects that are not connected to any anchor ("floating").
    """
    import numpy as np

    objs = [o for o in objs if o.type in {"MESH", "CURVE", "FONT"} and not o.hide_render]
    if not objs:
        return []
    boxes = np.array([[*world_aabb(o)[0], *world_aabb(o)[1]] for o in objs])
    lo = boxes[:, :3] - tol
    hi = boxes[:, 3:] + tol
    n = len(objs)
    # pairwise overlap matrix (n <= few thousand: fine)
    ov = np.all((lo[:, None, :] <= hi[None, :, :]) & (hi[:, None, :] >= lo[None, :, :]), axis=2)
    seen = np.zeros(n, bool)
    stack = [i for i, o in enumerate(objs) if o.name in anchor_names]
    for i in stack:
        seen[i] = True
    while stack:
        i = stack.pop()
        nb = np.nonzero(ov[i] & ~seen)[0]
        seen[nb] = True
        stack.extend(nb.tolist())
    return [objs[i].name for i in range(n) if not seen[i]]


# --------------------------------------------------------------------------- math helpers

def frame(origin, z_axis, x_hint=Vector((1, 0, 0))):
    """Matrix whose local Z is ``z_axis`` and local X is as close to ``x_hint`` as possible."""
    z = Vector(z_axis).normalized()
    x = Vector(x_hint)
    x = (x - z * x.dot(z))
    if x.length < 1e-6:
        x = Vector((0, 1, 0)) - z * z.y
    x.normalize()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(origin)
    return m


def frame_y(origin, y_axis, x_hint=Vector((1, 0, 0))):
    """Matrix whose local Y is ``y_axis`` and local X is as close to ``x_hint`` as possible."""
    y = Vector(y_axis).normalized()
    x = Vector(x_hint)
    x = x - y * x.dot(y)
    if x.length < 1e-6:
        x = Vector((0, 0, 1)) - y * y.z
    x.normalize()
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(origin)
    return m


def look_matrix(origin, target, up=Vector((0, 0, 1))):
    """Camera/light style matrix: -Z looks at target, +Y roughly up."""
    d = (Vector(target) - Vector(origin)).normalized()
    z = -d
    x = Vector(up).cross(z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(origin)
    return m


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation(Vector((x, y, z)))


def R(angle_deg, axis):
    return Matrix.Rotation(math.radians(angle_deg), 4, axis)


def S(x, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))


def lerp(a, b, t):
    return a + (b - a) * t
