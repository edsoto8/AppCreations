"""Milestone 6: industrial hangar, maintenance platform, scale references, lighting, volumetrics, cameras."""
from math import cos, pi, radians, sin

import bpy
from mathutils import Matrix, Vector

from . import materials as mt
from . import render
from .geo import Part, V, X, Y, Z, add_bevel, frame, get_coll, lerp

FLOOR_Z = -0.4
W, Y0, Y1, H = 36.0, -44.0, 36.0, 24.0     # half width, front, back, height


def _floor_mat():
    mat, nt = mt._new("ENV_Floor")
    co = mt._n(nt, 'ShaderNodeTexCoord').outputs['Object']
    p = mt._n(nt, 'ShaderNodeBsdfPrincipled')
    br = mt._n(nt, 'ShaderNodeTexBrick')
    br.offset = 0.0
    br.inputs['Scale'].default_value = 0.25
    br.inputs['Mortar Size'].default_value = 0.006
    br.inputs['Brick Width'].default_value = 1.0
    br.inputs['Row Height'].default_value = 1.0
    nt.links.new(co, br.inputs['Vector'])
    big = mt._noise(nt, co, 0.35, 6.0, 0.65)
    fine = mt._noise(nt, co, 6.0, 5.0, 0.6)
    col = mt._mixc(nt, mt._maprange(nt, big, 0.3, 0.7, 0.0, 1.0), (0.018, 0.02, 0.024, 1), (0.05, 0.052, 0.058, 1))
    col = mt._mixc(nt, br.outputs['Fac'], col, (0.004, 0.004, 0.005, 1))
    nt.links.new(col, p.inputs['Base Color'])
    r = mt._math(nt, 'ADD', mt._maprange(nt, big, 0.35, 0.7, 0.06, 0.3), mt._maprange(nt, fine, 0.4, 0.7, 0.0, 0.08))
    nt.links.new(mt._math(nt, 'ADD', r, mt._math(nt, 'MULTIPLY', br.outputs['Fac'], 0.4)), p.inputs['Roughness'])
    p.inputs['Metallic'].default_value = 0.0
    p.inputs['Specular IOR Level'].default_value = 0.8
    bump = mt._n(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.25
    nt.links.new(mt._math(nt, 'SUBTRACT', mt._math(nt, 'MULTIPLY', fine, 0.15), br.outputs['Fac']), bump.inputs['Height'])
    nt.links.new(bump.outputs[0], p.inputs['Normal'])
    mt._out(nt, p.outputs[0])
    return mat


def _hazard_mat():
    mat, nt = mt._new("ENV_Hazard")
    co = mt._n(nt, 'ShaderNodeTexCoord').outputs['Object']
    grad = mt._n(nt, 'ShaderNodeTexGradient', gradient_type='RADIAL')
    nt.links.new(co, grad.inputs[0])
    st = mt._math(nt, 'FRACT', mt._math(nt, 'MULTIPLY', grad.outputs['Fac'], 72.0))
    p = mt._n(nt, 'ShaderNodeBsdfPrincipled')
    nt.links.new(mt._mixc(nt, mt._math(nt, 'GREATER_THAN', st, 0.5), (0.9, 0.55, 0.02, 1), (0.01, 0.01, 0.01, 1)), p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.45
    mt._out(nt, p.outputs[0])
    return mat


def person(p, base, facing, mats, h=1.8, arm_up=False):
    """Stylised technician for scale (1.8 m)."""
    suit, vis, skin, dark = mats
    f = frame(facing)
    def P(x, y, z):
        return Vector(base) + f @ V(x, y, z) * (h / 1.8)
    for s in (-1, 1):
        p.sweep([P(s * 0.1, 0.0, 0.92), P(s * 0.11, 0.02, 0.5), P(s * 0.11, 0.0, 0.08)], [0.085, 0.07, 0.055], suit, 8)
        p.sweep([P(s * 0.11, -0.03, 0.05), P(s * 0.11, 0.16, 0.04)], (0.045, 0.055), dark, 8, exp=3.0)
        if arm_up and s == 1:
            p.sweep([P(s * 0.21, 0, 1.42), P(s * 0.3, 0.14, 1.6), P(s * 0.27, 0.3, 1.86)], [0.055, 0.047, 0.04], suit, 8)
        else:
            p.sweep([P(s * 0.21, 0, 1.42), P(s * 0.25, 0.02, 1.14), P(s * 0.24, 0.1, 0.88)], [0.055, 0.047, 0.04], suit, 8)
    p.sweep([P(0, 0, 0.9), P(0, 0, 1.15), P(0, 0.0, 1.42), P(0, 0, 1.5)], [(0.1, 0.16), (0.1, 0.165), (0.11, 0.2), (0.06, 0.1)], vis, 12, up=f @ Y)
    p.cyl(P(0, 0, 1.48), P(0, 0, 1.58), 0.045, skin, 8)
    p.ball(P(0, 0.01, 1.67), 0.105 * h / 1.8, skin, 12)
    p.lathe(P(0, 0.0, 1.68), Z, [(0, 0.125), (0.03, 0.118), (0.09, 0.07), (0.11, 0)], vis, 12)


def truss(p, a, b, hgt, mat, n=14, w=0.5):
    a, b = Vector(a), Vector(b)
    d = (b - a) / n
    lat = d.normalized().cross(Z) * w
    for s in (-1, 1):
        p.beam(a + lat * s, b + lat * s, 0.14, 0.14, mat)
        p.beam(a + lat * s + Z * hgt, b + lat * s + Z * hgt, 0.14, 0.14, mat)
        for i in range(n):
            q0, q1 = a + d * i + lat * s, a + d * (i + 1) + lat * s
            if i % 2 == 0:
                p.beam(q0, q1 + Z * hgt, 0.07, 0.07, mat)
            else:
                p.beam(q0 + Z * hgt, q1, 0.07, 0.07, mat)
    for i in range(n + 1):
        q = a + d * i
        p.beam(q - lat, q + lat, 0.06, 0.06, mat)
        p.beam(q - lat + Z * hgt, q + lat + Z * hgt, 0.06, 0.06, mat)


def build(ctx):
    scene, m = ctx["scene"], ctx["mats"]
    env = get_coll("ENV_Hangar")
    c_l = get_coll("ENV_Lights")
    c_c = get_coll("ENV_Cameras")
    steel = mt.metal("ENV_Steel", (0.09, 0.1, 0.115, 1), rough=0.55, rough_var=0.15, grime=0.6, metallic=0.9)
    wall = mt.metal("ENV_WallPanel", (0.05, 0.058, 0.07, 1), rough=0.6, rough_var=0.12, grime=0.5, metallic=0.6)
    deck = mt.metal("ENV_Deck", (0.05, 0.055, 0.065, 1), rough=0.16, rough_var=0.1, scratches=0.6, grime=0.4)
    yellow = mt.simple("ENV_Yellow", (0.75, 0.42, 0.02, 1), rough=0.5)
    lamp = mt.simple("ENV_Lamp", (0.02, 0.02, 0.02, 1), emit=(0.82, 0.92, 1.0, 1), emit_strength=5.0)
    strip = mt.simple("ENV_PlatformLight", (0.02, 0.02, 0.02, 1), emit=(0.55, 0.9, 1.0, 1), emit_strength=4.0)
    warm = mt.simple("ENV_WarmLamp", (0.02, 0.02, 0.02, 1), emit=(1.0, 0.62, 0.3, 1), emit_strength=6.0)
    red = mt.simple("ENV_Beacon", (0.02, 0.0, 0.0, 1), emit=(1.0, 0.1, 0.03, 1), emit_strength=12.0)
    suit = mt.simple("ENV_Suit", (0.03, 0.05, 0.12, 1), rough=0.8)
    vis = mt.simple("ENV_HiVis", (0.9, 0.35, 0.02, 1), rough=0.7)
    skin = mt.simple("ENV_Skin", (0.5, 0.33, 0.25, 1), rough=0.6)
    dark = m["AEGIS_Rubber"]
    floor_m, hazard = _floor_mat(), _hazard_mat()

    # floor
    p = Part("ENV_floor")
    p.grid([[V(-W, Y0, FLOOR_Z), V(W, Y0, FLOOR_Z)], [V(-W, Y1, FLOOR_Z), V(W, Y1, FLOOR_Z)]], floor_m)
    p.finish(env, bevel=0)

    # maintenance platform (top surface at z = 0)
    p = Part("ENV_platform")
    Rp = 10.5
    p.lathe((0, 0.5, FLOOR_Z), Z, [(0, Rp + 0.5), (0.12, Rp + 0.5), (0.16, Rp + 0.15), (0.34, Rp + 0.15), (0.4, Rp), (0.4, Rp - 0.4)], steel, 96)
    p.lathe((0, 0.5, 0), Z, [(0, Rp - 0.4), (0.0, Rp - 0.75)], hazard, 96)
    for r0, r1, mat in ((Rp - 0.75, Rp - 0.95, deck), (Rp - 0.95, Rp - 1.1, strip), (Rp - 1.1, 7.0, deck), (7.0, 6.88, strip), (6.88, 0, deck)):
        p.lathe((0, 0.5, 0), Z, [(0, r0), (0, r1)], mat, 96)
    for k in range(24):     # deck clamps + floor lights around the rim
        a = 2 * pi * k / 24
        d = V(cos(a), sin(a), 0)
        p.box(V(0, 0.5, 0.03) + d * (Rp - 0.2), (0.5, 0.3, 0.06), steel, rot=frame(d.cross(Z)))
        if k % 2:
            p.box(V(0, 0.5, FLOOR_Z + 0.22) + d * (Rp + 0.17), (0.6, 0.05, 0.1), strip, rot=frame(d.cross(Z)))
    for a in (radians(-125), radians(-55)):      # access stairs
        d = V(cos(a), sin(a), 0)
        for i in range(3):
            p.box(V(0, 0.5, FLOOR_Z + 0.065 + 0.13 * i) + d * (Rp + 1.5 - 0.35 * i), (2.2, 0.36, 0.13), deck, rot=frame(d.cross(Z)))
    p.finish(env, bevel=0.01)

    # shell: walls, pilasters, door
    p = Part("ENV_walls")
    for x in (-W, W):
        p.grid([[V(x, Y0, FLOOR_Z), V(x, Y1, FLOOR_Z)], [V(x, Y0, H), V(x, Y1, H)]], wall)
    p.grid([[V(-W, Y1, FLOOR_Z), V(W, Y1, FLOOR_Z)], [V(-W, Y1, H), V(W, Y1, H)]], wall)
    p.grid([[V(-W, Y0, H), V(W, Y0, H)], [V(-W, Y1, H), V(W, Y1, H)]], wall)
    p.finish(env, bevel=0)
    p = Part("ENV_structure")
    ys = [Y0 + 4 + i * 8 for i in range(10)]
    for y in ys:
        for x in (-W + 0.5, W - 0.5):
            p.beam((x, y, FLOOR_Z), (x, y, H), 1.0, 0.9, steel, up=Y)
            p.beam((x - 0.5 * (1 if x > 0 else -1) * 1.2, y, 15.5), (x, y, 19.5), 0.5, 0.5, steel, up=Y)
            for z in (4.0, 9.0, 14.0):
                p.box((x - (0.52 if x > 0 else -0.52), y, z), (0.08, 0.5, 1.6), lamp if z == 9.0 else steel)
        truss(p, (-W + 1, y, 19.5), (W - 1, y, 19.5), 2.4, steel, n=18, w=0.45)
    for x in (-W + 0.2, W - 0.2):
        for z in (2.5, 6.5, 11.0, 16.0):
            p.beam((x, Y0, z), (x, Y1, z), 0.3, 0.5, steel, up=Z)
    for x in [-W + 4 + i * 8 for i in range(9)]:
        p.beam((x, Y1 - 0.5, FLOOR_Z), (x, Y1 - 0.5, H), 0.9, 1.0, steel, up=X)
    # hangar door (back wall) with slats, chevrons and a light slot above it
    p.box((0, Y1 - 0.25, 7.6), (30, 0.5, 16.0), wall)
    for i in range(16):
        p.beam((-14.8, Y1 - 0.55, 0.2 + i * 0.97), (14.8, Y1 - 0.55, 0.2 + i * 0.97), 0.16, 0.22, steel, up=Z)
    p.box((0, Y1 - 0.6, 16.3), (30.5, 0.4, 0.9), hazard)
    p.box((0, Y1 - 0.75, 17.4), (28, 0.3, 0.5), lamp)
    for x in (-15.6, 15.6):
        p.box((x, Y1 - 0.7, 8), (0.8, 0.5, 16.8), yellow)
        p.box((x, Y1 - 1.0, 12), (0.3, 0.25, 0.3), red)
    # rear catwalk + side gantries with railings
    for a, b, z in (((-W + 1, Y1 - 4.0, 8.0), (W - 1, Y1 - 4.0, 8.0), 8.0), ((-W + 2.5, Y0 + 4, 8.0), (-W + 2.5, Y1 - 4, 8.0), 8.0),
                    ((W - 2.5, Y0 + 4, 8.0), (W - 2.5, Y1 - 4, 8.0), 8.0)):
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        lat = d.cross(Z)
        p.beam(a, b, 2.2, 0.16, deck, up=Z)
        n = int((b - a).length / 2.0)
        for s in (-1, 1):
            for hgt in (0.55, 1.1):
                p.beam(a + lat * s * 1.05 + Z * hgt, b + lat * s * 1.05 + Z * hgt, 0.05, 0.05, yellow)
            for i in range(n + 1):
                q = a.lerp(b, i / n) + lat * s * 1.05
                p.beam(q, q + Z * 1.1, 0.05, 0.05, yellow)
        for i in range(0, n + 1, 3):
            q = a.lerp(b, i / n)
            p.beam(q - Z * 0.1, q - Z * 2.2 + lat * (1.6 if q.x < 0 or abs(lat.y) > 0.5 else -1.6) * (1 if abs(lat.x) > 0.5 and q.x < 0 else -1 if abs(lat.x) > 0.5 else 1),
                   0.14, 0.14, steel)
    p.finish(env, bevel=0.012)

    # service towers flanking the platform + overhead lamp bars
    p = Part("ENV_service_towers")
    for sx in (-1, 1):
        c = V(sx * 21.0, 15.0, FLOOR_Z)
        for dx in (-1, 1):
            for dy in (-1, 1):
                p.beam(c + V(dx * 1.1, dy * 1.1, 0), c + V(dx * 1.1, dy * 1.1, 11.5), 0.16, 0.16, steel)
        for i in range(8):
            z = 1.4 * i
            for (dx0, dy0), (dx1, dy1) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
                p.beam(c + V(dx0 * 1.1, dy0 * 1.1, z), c + V(dx1 * 1.1, dy1 * 1.1, z + 1.4), 0.06, 0.06, steel)
                p.beam(c + V(dx0 * 1.1, dy0 * 1.1, z + 1.4), c + V(dx1 * 1.1, dy1 * 1.1, z + 1.4), 0.07, 0.07, steel)
        for z in (5.6, 11.5):
            p.box(c + V(0, 0, z), (2.9, 2.9, 0.14), deck)
            for s in (-1, 1):
                p.beam(c + V(-1.4, s * 1.4, z + 1.0), c + V(1.4, s * 1.4, z + 1.0), 0.05, 0.05, yellow)
        # retracted service arm with a work light
        p.beam(c + V(0, 0, 9.6), c + V(-sx * 4.2, -1.5, 10.4), 0.3, 0.4, yellow)
        p.box(c + V(-sx * 4.3, -1.55, 10.2), (0.7, 0.5, 0.25), steel)
        p.box(c + V(-sx * 4.3, -1.55, 10.05), (0.5, 0.35, 0.04), warm)
        p.box(c + V(0, 0, 11.9), (0.3, 0.3, 0.3), red)
    for y in (-10, 2, 14):     # lamp bars under the trusses
        for x in (-18, -6, 6, 18):
            p.box((x, y, 19.2), (4.5, 0.5, 0.18), steel)
            p.box((x, y, 19.09), (4.2, 0.36, 0.04), lamp)
    p.finish(env, bevel=0.012)

    # scale references: technicians, crates, drums, tool cart
    p = Part("ENV_scale_references")
    pm = (suit, vis, skin, dark)
    person(p, (-9.0, -3.6, 0.0), V(0.9, 0.3, 0), pm, arm_up=True)
    person(p, (-9.6, -2.6, 0.0), V(0.95, 0.2, 0), pm)
    person(p, (8.3, -5.3, 0.0), V(-0.9, 0.3, 0), pm)
    person(p, (-13.5, -8.5, FLOOR_Z), V(0.8, 0.5, 0), pm)
    person(p, (20.6, 14.2, FLOOR_Z + 5.67), V(-1, -0.6, 0), pm)
    person(p, (4.0, Y1 - 4.4, 8.08), V(0, -1, 0), pm)
    for (x, y, s) in ((-14.5, -10.5, 1.3), (-15.9, -10.2, 1.0), (-14.9, -10.4, 0.8), (14.0, -9.5, 1.4), (15.6, -9.0, 1.1)):
        z = FLOOR_Z + s / 2 + (1.3 if s == 0.8 else 0)
        p.box((x, y, z), (s, s, s), steel if s != 1.0 else yellow)
        p.box((x, y, z), (s * 1.02, s * 0.25, s * 1.02), deck)
    for (x, y) in ((13.0, -11.5), (13.8, -11.9), (12.6, -12.3)):
        p.lathe((x, y, FLOOR_Z), Z, [(0, 0), (0, 0.3), (0.02, 0.31), (0.3, 0.31), (0.32, 0.29), (0.6, 0.29), (0.62, 0.31),
                                     (0.9, 0.31), (0.92, 0.3), (0.92, 0)], yellow, 20)
    p.box((-11.8, -9.6, FLOOR_Z + 0.75), (1.4, 0.7, 0.9), steel)      # console cart
    p.box((-11.8, -9.3, FLOOR_Z + 1.35), (1.2, 0.08, 0.5), strip, rot=frame(V(0, 1, 0.5)))
    p.finish(env, bevel=0.008)

    # umbilical hoses from the platform sockets to the towers
    p = Part("ENV_umbilicals")
    from .geo import catmull
    for sx in (-1, 1):
        for k in range(3):
            pts = [V(sx * (6.5 + 0.3 * k), 3.5 + k * 0.5, 0.05), V(sx * 9.5, 4.5 + 0.6 * k, 0.06), V(sx * 11.3, 5.2 + k * 0.3, -0.1),
                   V(sx * 15.0, 9.0 + 0.2 * k, FLOOR_Z + 0.07), V(sx * 19.8, 14.2 + 0.3 * k, FLOOR_Z + 0.4)]
            p.sweep(catmull(pts, 6), 0.06, dark if k != 1 else yellow, 8)
    p.finish(env, bevel=0)

    # --- atmosphere -------------------------------------------------------------------------
    w = bpy.data.worlds.new("ENV_World")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.006, 0.01, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = w
    fog_m, nt = mt._new("ENV_Fog")
    vs = mt._n(nt, 'ShaderNodeVolumeScatter')
    vs.inputs['Density'].default_value = 0.0028
    vs.inputs['Anisotropy'].default_value = 0.35
    vs.inputs['Color'].default_value = (0.8, 0.9, 1.0, 1)
    o = mt._n(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(vs.outputs[0], o.inputs['Volume'])
    p = Part("ENV_fog_volume")
    p.box((0, (Y0 + Y1) / 2, (H + FLOOR_Z) / 2), (2 * W - 0.4, Y1 - Y0 - 0.4, H - FLOOR_Z - 0.4), fog_m)
    fog = p.finish(env, bevel=0)
    fog.display_type = 'WIRE'
    ctx["fog"] = fog

    # --- lighting ---------------------------------------------------------------------------
    def L(name, kind, loc, target, energy, color, size=1.0, spot=None, blend=0.3):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = color
        if kind == 'AREA':
            ld.size = size
        else:
            ld.shadow_soft_size = size
        if spot:
            ld.spot_size = radians(spot)
            ld.spot_blend = blend
        lo = bpy.data.objects.new(name, ld)
        c_l.objects.link(lo)
        lo.location = loc
        render.look_at(lo, target)
        return lo

    L("LGT_key", 'AREA', (-13, -15, 15), (0, -3, 4.5), 8000, (1.0, 0.93, 0.84), size=7)
    L("LGT_rim_cool", 'AREA', (13, 16, 13), (0, 0, 5), 21000, (0.5, 0.78, 1.0), size=6)
    L("LGT_rim_left", 'AREA', (-17, 13, 9), (0, 2, 4), 6000, (0.45, 0.7, 1.0), size=5)
    L("LGT_fill", 'AREA', (10, -18, 5), (0, -3, 3.5), 380, (0.6, 0.75, 1.0), size=10)
    L("LGT_under_warm", 'AREA', (-4, -9, 0.6), (0, -4, 5), 350, (1.0, 0.6, 0.3), size=3)
    for i, (x, y) in enumerate(((-7, -6), (7, -6), (-8, 8), (8, 8), (0, 1))):
        L("LGT_shaft_%d" % (i + 1), 'SPOT', (x * 1.25, y * 1.2 + 0.5, 19.0), (x * 0.55, y * 0.5, 0), 9000 if i < 4 else 12000,
          (0.78, 0.9, 1.0), size=0.25, spot=30 if i < 4 else 38, blend=0.5)
    L("LGT_door_glow", 'AREA', (0, Y1 - 2.5, 14), (0, 0, 6), 3500, (0.55, 0.75, 1.0), size=14)

    # --- cameras ----------------------------------------------------------------------------
    cams = {}
    cams["hero"] = render.camera(scene, "CAM_hero", (-4.8, -21.5, 1.4), (0.0, -1.0, 5.7), 24, c_c)
    cams["head"] = render.camera(scene, "CAM_head", (-4.3, -12.4, 4.7), (0.1, -7.0, 6.0), 46, c_c, dof=5.6)
    cams["reactor"] = render.camera(scene, "CAM_reactor", (-2.5, -6.3, 1.25), (0.0, -2.15, 2.5), 52, c_c, dof=5.6)
    cams["wings"] = render.camera(scene, "CAM_wings", (7.5, -19.5, 11.5), (0.0, 0.8, 4.6), 27, c_c)
    # animated cinematic camera: low dolly-in on the dormant machine, then pull back and rise for the reveal
    tgt = bpy.data.objects.new("CAM_cine_target", None)
    c_c.objects.link(tgt)
    cine = render.camera(scene, "CAM_cinematic", (-7, -15, 1.4), (0, -4, 3), 30, c_c)
    tr = cine.constraints.new('TRACK_TO')
    tr.target = tgt
    tr.track_axis = 'TRACK_NEGATIVE_Z'
    tr.up_axis = 'UP_Y'
    for f, loc, t in ((1, (-6.5, -15.5, 1.3), (0.5, -5.0, 2.6)), (60, (-5.2, -14.0, 1.5), (0.3, -5.2, 3.0)),
                      (130, (-7.0, -15.5, 2.2), (0.0, -5.0, 5.2)), (200, (-8.5, -20.0, 1.9), (0.3, -2.0, 5.4)),
                      (264, (-5.0, -22.5, 1.45), (0.0, -1.0, 5.7))):
        cine.location = loc
        cine.keyframe_insert("location", frame=f)
        tgt.location = t
        tgt.keyframe_insert("location", frame=f)
    cams["cine"] = cine
    ctx["cams"] = cams
    scene.camera = cams["hero"]
