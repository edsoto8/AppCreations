"""Physically based procedural materials (Cycles). No image textures, no UVs - object-space noise."""
import bpy

CYAN = (0.0, 0.78, 1.0, 1.0)
M = {}  # name -> material


def _new(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    return mat, nt


def _n(nt, typ, **kw):
    n = nt.nodes.new(typ)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def _mixc(nt, fac, a, b):
    m = _n(nt, 'ShaderNodeMix', data_type='RGBA')
    for sock, val in ((m.inputs[0], fac), (m.inputs[6], a), (m.inputs[7], b)):
        if hasattr(val, 'links'):
            nt.links.new(val, sock)
        else:
            sock.default_value = val
    return m.outputs[2]


def _math(nt, op, a, b=None):
    m = _n(nt, 'ShaderNodeMath', operation=op)
    for sock, val in ((m.inputs[0], a), (m.inputs[1], b)):
        if val is None:
            continue
        if hasattr(val, 'links'):
            nt.links.new(val, sock)
        else:
            sock.default_value = val
    return m.outputs[0]


def _maprange(nt, v, a, b, c, d):
    m = _n(nt, 'ShaderNodeMapRange')
    nt.links.new(v, m.inputs[0])
    for i, x in zip((1, 2, 3, 4), (a, b, c, d)):
        m.inputs[i].default_value = x
    return m.outputs[0]


def _noise(nt, coord, scale, detail=4.0, rough=0.55, stretch=None, rot=None):
    mp = _n(nt, 'ShaderNodeMapping')
    nt.links.new(coord, mp.inputs[0])
    if stretch:
        mp.inputs['Scale'].default_value = stretch
    if rot:
        mp.inputs['Rotation'].default_value = rot
    nz = _n(nt, 'ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = detail
    nz.inputs['Roughness'].default_value = rough
    nt.links.new(mp.outputs[0], nz.inputs['Vector'])
    return nz.outputs[0]


def _out(nt, shader):
    o = _n(nt, 'ShaderNodeOutputMaterial')
    nt.links.new(shader, o.inputs[0])


def metal(name, color, rough=0.35, rough_var=0.12, brushed=0.0, scratches=0.0, wear=0.0,
          wear_color=(0.55, 0.57, 0.6, 1), grime=0.0, coat=0.0, metallic=1.0):
    mat, nt = _new(name)
    co = _n(nt, 'ShaderNodeTexCoord').outputs['Object']
    p = _n(nt, 'ShaderNodeBsdfPrincipled')
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = 0.08
    # large scale roughness variation (smudges / heat tint)
    big = _noise(nt, co, 2.2, 6.0, 0.6)
    r = _maprange(nt, big, 0.25, 0.75, rough - rough_var, rough + rough_var)
    col = _mixc(nt, _maprange(nt, big, 0.3, 0.8, 0.0, 0.35), color, tuple(c * 0.55 for c in color[:3]) + (1,))
    height = None
    if brushed:
        br = _noise(nt, co, 160.0, 2.0, 0.5, stretch=(1.0, 0.02, 1.0))
        r = _math(nt, 'ADD', r, _maprange(nt, br, 0.3, 0.7, -brushed, brushed))
        height = _math(nt, 'MULTIPLY', br, 0.25)
        p.inputs['Anisotropic'].default_value = 0.45
    if scratches:
        sc = None
        for i, rot in enumerate(((0, 0, 0.5), (0.3, 0, 2.1), (0, 0.6, 1.2))):
            s = _noise(nt, co, 9.0 + 5 * i, 2.0, 0.5, stretch=(30.0, 0.35, 30.0), rot=rot)
            s = _maprange(nt, s, 0.72, 0.75, 0.0, 1.0)
            sc = s if sc is None else _math(nt, 'MAXIMUM', sc, s)
        sc = _math(nt, 'MULTIPLY', sc, scratches)
        r = _math(nt, 'SUBTRACT', r, _math(nt, 'MULTIPLY', sc, 0.18))
        col = _mixc(nt, _math(nt, 'MULTIPLY', sc, 0.3), col, wear_color)
        h2 = _math(nt, 'MULTIPLY', sc, -0.6)
        height = h2 if height is None else _math(nt, 'ADD', height, h2)
    if grime:
        g = _maprange(nt, _noise(nt, co, 5.0, 8.0, 0.7), 0.5, 0.8, 0.0, grime)
        col = _mixc(nt, g, col, (0.012, 0.011, 0.01, 1))
        r = _math(nt, 'ADD', r, _math(nt, 'MULTIPLY', g, 0.3))
    if wear:
        # edge wear: compare the true normal to a bevelled normal
        bv = _n(nt, 'ShaderNodeBevel', samples=3)
        bv.inputs['Radius'].default_value = 0.025
        geo = _n(nt, 'ShaderNodeNewGeometry')
        dot = _n(nt, 'ShaderNodeVectorMath', operation='DOT_PRODUCT')
        nt.links.new(bv.outputs[0], dot.inputs[0])
        nt.links.new(geo.outputs['Normal'], dot.inputs[1])
        edge = _maprange(nt, dot.outputs['Value'], 0.995, 0.93, 0.0, 1.0)
        brk = _maprange(nt, _noise(nt, co, 14.0, 6.0, 0.7), 0.35, 0.65, 0.0, 1.0)
        edge = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', edge, brk), wear)
        col = _mixc(nt, edge, col, wear_color)
        r = _math(nt, 'SUBTRACT', r, _math(nt, 'MULTIPLY', edge, 0.15))
    if height is not None:
        bump = _n(nt, 'ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.12
        bump.inputs['Distance'].default_value = 0.004
        nt.links.new(height, bump.inputs['Height'])
        nt.links.new(bump.outputs[0], p.inputs['Normal'])
    nt.links.new(col, p.inputs['Base Color'])
    nt.links.new(r, p.inputs['Roughness'])
    _out(nt, p.outputs[0])
    M[name] = mat
    return mat


def carbon(name):
    mat, nt = _new(name)
    co = _n(nt, 'ShaderNodeTexCoord').outputs['Object']
    p = _n(nt, 'ShaderNodeBsdfPrincipled')
    mp = _n(nt, 'ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0.4, 0.3, 0.785)
    nt.links.new(co, mp.inputs[0])
    ck = _n(nt, 'ShaderNodeTexChecker')
    ck.inputs['Scale'].default_value = 90.0
    nt.links.new(mp.outputs[0], ck.inputs[0])
    w1 = _n(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
    w1.inputs['Scale'].default_value = 140.0
    w2 = _n(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y')
    w2.inputs['Scale'].default_value = 140.0
    nt.links.new(mp.outputs[0], w1.inputs[0])
    nt.links.new(mp.outputs[0], w2.inputs[0])
    weave = _mixc(nt, ck.outputs['Fac'], w1.outputs['Fac'], w2.outputs['Fac'])
    col = _mixc(nt, weave, (0.008, 0.008, 0.009, 1), (0.03, 0.031, 0.034, 1))
    nt.links.new(col, p.inputs['Base Color'])
    nt.links.new(_maprange(nt, weave, 0.0, 1.0, 0.5, 0.28), p.inputs['Roughness'])
    p.inputs['Metallic'].default_value = 0.2
    p.inputs['Coat Weight'].default_value = 0.7
    p.inputs['Coat Roughness'].default_value = 0.12
    bump = _n(nt, 'ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.15
    bump.inputs['Distance'].default_value = 0.002
    nt.links.new(weave, bump.inputs['Height'])
    nt.links.new(bump.outputs[0], p.inputs['Normal'])
    _out(nt, p.outputs[0])
    M[name] = mat
    return mat


def energy(name, strength, prop="energy", expr=None, hot=0.0, base=(0.004, 0.03, 0.04, 1), color=CYAN):
    """Cyan emissive. Emission strength is driven by a custom property on the rig (see bind_drivers)."""
    mat, nt = _new(name)
    p = _n(nt, 'ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = base
    p.inputs['Roughness'].default_value = 0.2
    p.inputs['Coat Weight'].default_value = 0.5
    if hot:
        co = _n(nt, 'ShaderNodeTexCoord').outputs['Object']
        nz = _maprange(nt, _noise(nt, co, 9.0, 5.0, 0.6), 0.35, 0.7, 0.0, 1.0)
        c = _mixc(nt, _math(nt, 'MULTIPLY', nz, hot), color, (0.75, 0.97, 1.0, 1))
        nt.links.new(c, p.inputs['Emission Color'])
    else:
        p.inputs['Emission Color'].default_value = color
    p.inputs['Emission Strength'].default_value = strength
    p.name = "EnergyBSDF"
    _out(nt, p.outputs[0])
    mat["aegis_strength"] = strength
    mat["aegis_prop"] = prop
    mat["aegis_expr"] = expr or "e*%g" % strength
    M[name] = mat
    return mat


def membrane(name):
    """Wing energy membrane: hex-cell field, transparent when unpowered."""
    mat, nt = _new(name)
    co = _n(nt, 'ShaderNodeTexCoord').outputs['Object']
    vo = _n(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
    vo.inputs['Scale'].default_value = 2.6
    nt.links.new(co, vo.inputs['Vector'])
    lines = _maprange(nt, vo.outputs['Distance'], 0.0, 0.06, 1.0, 0.0)
    vo2 = _n(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
    vo2.inputs['Scale'].default_value = 11.0
    nt.links.new(co, vo2.inputs['Vector'])
    fine = _maprange(nt, vo2.outputs['Distance'], 0.0, 0.05, 0.35, 0.0)
    cloud = _maprange(nt, _noise(nt, co, 0.8, 4.0, 0.6), 0.3, 0.7, 0.25, 1.0)
    pat = _math(nt, 'MAXIMUM', lines, fine)
    em = _n(nt, 'ShaderNodeEmission')
    em.inputs['Color'].default_value = CYAN
    power = _n(nt, 'ShaderNodeValue')
    power.name = "Power"
    power.outputs[0].default_value = 1.0
    s = _math(nt, 'ADD', _math(nt, 'MULTIPLY', pat, 9.0), _math(nt, 'MULTIPLY', cloud, 0.9))
    nt.links.new(_math(nt, 'MULTIPLY', s, power.outputs[0]), em.inputs['Strength'])
    tr = _n(nt, 'ShaderNodeBsdfTransparent')
    mix = _n(nt, 'ShaderNodeMixShader')
    alpha = _math(nt, 'ADD', _math(nt, 'MULTIPLY', pat, 0.75), _math(nt, 'MULTIPLY', cloud, 0.22))
    alpha = _math(nt, 'MULTIPLY', alpha, power.outputs[0])
    nt.links.new(_math(nt, 'MINIMUM', alpha, 1.0), mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    _out(nt, mix.outputs[0])
    mat["aegis_prop"] = "membrane_power"
    M[name] = mat
    return mat


def glass(name):
    mat, nt = _new(name)
    fr = _n(nt, 'ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.5
    tr = _n(nt, 'ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = (0.86, 0.97, 1.0, 1)
    gl = _n(nt, 'ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.03
    mix = _n(nt, 'ShaderNodeMixShader')
    nt.links.new(_math(nt, 'MINIMUM', _math(nt, 'MULTIPLY', fr.outputs[0], 2.2), 1.0), mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(gl.outputs[0], mix.inputs[2])
    _out(nt, mix.outputs[0])
    M[name] = mat
    return mat


def simple(name, color, rough=0.6, metallic=0.0, emit=None, emit_strength=0.0):
    mat, nt = _new(name)
    p = _n(nt, 'ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = color
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metallic
    if emit:
        p.inputs['Emission Color'].default_value = emit
        p.inputs['Emission Strength'].default_value = emit_strength
    _out(nt, p.outputs[0])
    M[name] = mat
    return mat


def build_all():
    M.clear()
    metal("AEGIS_Titanium", (0.115, 0.125, 0.145, 1), rough=0.36, rough_var=0.1, brushed=0.06, scratches=1.0,
          wear=0.9, grime=0.35)
    metal("AEGIS_Titanium_Light", (0.27, 0.285, 0.31, 1), rough=0.33, rough_var=0.1, brushed=0.06, scratches=0.9,
          wear=0.8, wear_color=(0.7, 0.72, 0.75, 1), grime=0.3)
    metal("AEGIS_Gunmetal", (0.035, 0.038, 0.043, 1), rough=0.5, rough_var=0.12, scratches=0.4, grime=0.4)
    metal("AEGIS_Chrome", (0.82, 0.84, 0.87, 1), rough=0.09, rough_var=0.06, scratches=0.25)
    metal("AEGIS_Gold", (0.86, 0.56, 0.2, 1), rough=0.26, rough_var=0.08, scratches=0.5, wear=0.5,
          wear_color=(1.0, 0.8, 0.45, 1))
    metal("AEGIS_Bronze", (0.42, 0.24, 0.1, 1), rough=0.4, rough_var=0.12, scratches=0.5, grime=0.5)
    metal("AEGIS_Copper", (0.85, 0.38, 0.2, 1), rough=0.3, rough_var=0.08)
    metal("AEGIS_Tooth", (0.62, 0.64, 0.68, 1), rough=0.2, rough_var=0.08, scratches=0.7)
    carbon("AEGIS_Carbon")
    simple("AEGIS_Rubber", (0.012, 0.012, 0.013, 1), rough=0.75)
    energy("AEGIS_Energy_Conduit", 5.0)
    energy("AEGIS_Energy_Vent", 3.0)
    energy("AEGIS_Energy_Eye", 30.0, prop="eye_power")
    energy("AEGIS_Energy_Core", 15.0, expr="e*15*(1+0.22*sin(frame/3.5))", hot=1.0)
    energy("AEGIS_Energy_Ring", 12.0, expr="e*12*(1+0.2*sin(frame/3.5+1.5))")
    energy("AEGIS_Energy_Throat", 10.0, prop="throat_power")
    membrane("AEGIS_Energy_Membrane")
    glass("AEGIS_Glass")
    return M


def _drive(target, path, rig, prop, expr):
    fc = target.driver_add(path)
    d = fc.driver
    d.type = 'SCRIPTED'
    v = d.variables.new()
    v.name = "e"
    v.type = 'SINGLE_PROP'
    v.targets[0].id = rig
    v.targets[0].data_path = '["%s"]' % prop
    d.expression = expr
    return fc


def bind_drivers(rig):
    """Wire every energy material to the rig's custom properties (energy / eye_power / ...)."""
    for mat in M.values():
        if "aegis_prop" not in mat:
            continue
        nt = mat.node_tree
        if "EnergyBSDF" in nt.nodes:
            _drive(nt.nodes["EnergyBSDF"].inputs['Emission Strength'], "default_value", rig,
                   mat["aegis_prop"], mat["aegis_expr"])
        elif "Power" in nt.nodes:
            _drive(nt.nodes["Power"].outputs[0], "default_value", rig, mat["aegis_prop"], "e")
