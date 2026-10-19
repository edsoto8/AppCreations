"""PBR materials built from shader nodes.

``build(full=False)`` gives flat blockout shading (milestones 1-5). ``build(full=True)`` gives the
procedural set: edge wear from a Bevel-node edge mask, AO-driven grime, noise roughness and
scratches. Every procedural texture is offset by values from a fixed seed, so reruns match.
"""

import bpy

from . import utils as U

# key: (base color, metallic, roughness)
FLAT = {
    "armor":       ((0.80, 0.48, 0.04), 0.0, 0.45),
    "armor_dark":  ((0.08, 0.085, 0.09), 0.2, 0.5),
    "steel_dark":  ((0.12, 0.125, 0.13), 0.8, 0.45),
    "titanium":    ((0.55, 0.56, 0.58), 1.0, 0.32),
    "chrome":      ((0.9, 0.9, 0.92), 1.0, 0.06),
    "rubber":      ((0.02, 0.02, 0.022), 0.0, 0.8),
    "hose":        ((0.025, 0.025, 0.028), 0.0, 0.6),
    "cable_orange": ((0.9, 0.25, 0.02), 0.0, 0.5),
    "cable_red":   ((0.5, 0.03, 0.02), 0.0, 0.5),
    "grease":      ((0.03, 0.025, 0.015), 0.4, 0.25),
    "weld":        ((0.25, 0.22, 0.2), 1.0, 0.55),
    "bolt":        ((0.35, 0.35, 0.36), 1.0, 0.4),
    "carbon":      ((0.03, 0.03, 0.035), 0.0, 0.3),
    "emit_blue":   ((0.1, 0.5, 1.0), 0.0, 0.3),
    "emit_amber":  ((1.0, 0.45, 0.05), 0.0, 0.3),
    "led_red":     ((1.0, 0.05, 0.02), 0.0, 0.3),
    "led_green":   ((0.1, 1.0, 0.2), 0.0, 0.3),
    "glass":       ((0.6, 0.7, 0.8), 0.0, 0.02),
    "lens_inner":  ((0.01, 0.02, 0.03), 0.5, 0.15),
    "hazard":      ((0.85, 0.6, 0.02), 0.0, 0.5),
    "decal_white": ((0.85, 0.85, 0.82), 0.0, 0.5),
    "decal_black": ((0.02, 0.02, 0.02), 0.0, 0.5),
    "concrete":    ((0.35, 0.34, 0.32), 0.0, 0.85),
    "floor_paint": ((0.85, 0.65, 0.05), 0.0, 0.6),
    "steel_joint": ((0.09, 0.09, 0.095), 0.5, 0.4),
    "gear":        ((0.40, 0.40, 0.41), 1.0, 0.3),
    "floor_white": ((0.62, 0.62, 0.60), 0.0, 0.6),
    "spring":      ((0.75, 0.08, 0.04), 0.3, 0.35),
    "copper":      ((0.8, 0.45, 0.3), 1.0, 0.35),
}
EMISSIVE = {"emit_blue": 12.0, "emit_amber": 8.0, "led_red": 10.0, "led_green": 10.0}


def _new(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def _principled(m):
    nt = m.node_tree
    return next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")


def build_flat():
    mats = {}
    for key, (col, met, rough) in FLAT.items():
        m = _new(f"M_{key}")
        b = _principled(m)
        b.inputs["Base Color"].default_value = (*col, 1.0)
        b.inputs["Metallic"].default_value = met
        b.inputs["Roughness"].default_value = rough
        m.diffuse_color = (*col, 1.0)
        if key in EMISSIVE:
            b.inputs["Emission Color"].default_value = (*col, 1.0)
            b.inputs["Emission Strength"].default_value = EMISSIVE[key]
        if key == "glass":
            b.inputs["Transmission Weight"].default_value = 1.0
            b.inputs["IOR"].default_value = 1.5
        mats[key] = m
    return mats


def build(full=False):
    return build_pbr() if full else build_flat()


# =========================================================================== node builder


class NB:
    """Small node-graph builder."""

    def __init__(self, name):
        m = bpy.data.materials.get(name)
        if m:
            bpy.data.materials.remove(m)
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.n("ShaderNodeOutputMaterial")
        self.bsdf = self.n("ShaderNodeBsdfPrincipled")
        self.link(self.bsdf.outputs["BSDF"], self.out.inputs["Surface"])
        self.r = U.rng(name)

    def n(self, kind, **props):
        node = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def set(self, name, value):
        if name in self.bsdf.inputs:
            self.bsdf.inputs[name].default_value = value

    def inp(self, name, sock):
        if name in self.bsdf.inputs:
            self.link(sock, self.bsdf.inputs[name])

    # ---- sockets ---------------------------------------------------------------------
    @staticmethod
    def sock(node, name, kind=None, out=False):
        coll = node.outputs if out else node.inputs
        for s in coll:
            if s.name == name and (kind is None or s.type == kind) and s.enabled:
                return s
        for s in coll:
            if s.name == name and (kind is None or s.type == kind):
                return s
        raise KeyError(name)

    def coords(self, scale=(1, 1, 1), rot=(0, 0, 0)):
        tc = self.n("ShaderNodeTexCoord")
        mp = self.n("ShaderNodeMapping")
        mp.inputs["Location"].default_value = [self.r.uniform(-50, 50) for _ in range(3)]
        mp.inputs["Rotation"].default_value = rot
        mp.inputs["Scale"].default_value = scale
        self.link(tc.outputs["Object"], mp.inputs["Vector"])
        return mp.outputs["Vector"]

    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0):
        t = self.n("ShaderNodeTexNoise")
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = detail
        t.inputs["Roughness"].default_value = rough
        t.inputs["Distortion"].default_value = dist
        self.link(vec, t.inputs["Vector"])
        return t.outputs["Fac"]

    def math(self, op, a, b=None, clamp=False):
        m = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs[0]

    def maprange(self, v, a, b, c=0.0, d=1.0):
        m = self.n("ShaderNodeMapRange", clamp=True)
        self.link(v, m.inputs[0])
        m.inputs[1].default_value = a
        m.inputs[2].default_value = b
        m.inputs[3].default_value = c
        m.inputs[4].default_value = d
        return m.outputs[0]

    def mixc(self, fac, a, b):
        m = self.n("ShaderNodeMix", data_type="RGBA")
        fa = self.sock(m, "Factor", "VALUE")
        if isinstance(fac, (int, float)):
            fa.default_value = fac
        else:
            self.link(fac, fa)
        for nm, v in (("A", a), ("B", b)):
            s = self.sock(m, nm, "RGBA")
            if isinstance(v, tuple):
                s.default_value = (*v, 1.0) if len(v) == 3 else v
            else:
                self.link(v, s)
        return self.sock(m, "Result", "RGBA", out=True)

    def mixf(self, fac, a, b):
        """Linear interpolation of floats: a + (b - a) * fac."""
        m = self.n("ShaderNodeMapRange", clamp=False)
        if isinstance(fac, (int, float)):
            m.inputs[0].default_value = fac
        else:
            self.link(fac, m.inputs[0])
        m.inputs[1].default_value = 0.0
        m.inputs[2].default_value = 1.0
        for i, v in ((3, a), (4, b)):
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs[0]

    def edge(self, radius=0.008, gain=10.0):
        bev = self.n("ShaderNodeBevel", samples=4)
        bev.inputs["Radius"].default_value = radius
        geo = self.n("ShaderNodeNewGeometry")
        dot = self.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        self.link(bev.outputs["Normal"], dot.inputs[0])
        self.link(geo.outputs["Normal"], dot.inputs[1])
        e = self.math("SUBTRACT", 1.0, self.sock(dot, "Value", out=True))
        return self.math("MULTIPLY", e, gain, clamp=True)

    def cavity(self, dist=0.06):
        ao = self.n("ShaderNodeAmbientOcclusion", samples=8)
        ao.inputs["Distance"].default_value = dist
        return self.math("SUBTRACT", 1.0, ao.outputs["AO"], clamp=True)

    def random(self):
        oi = self.n("ShaderNodeObjectInfo")
        return oi.outputs["Random"]

    def bump(self, height, strength=0.2, distance=0.002, normal=None):
        b = self.n("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height, b.inputs["Height"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        return b.outputs["Normal"]


# =========================================================================== recipes

def painted(name, paint, metal=(0.55, 0.55, 0.56), wear=1.0, grime=1.0, paint_rough=0.42, paint_metal=0.0,
            paint_socket=None, grime_col=(0.035, 0.028, 0.02), scratch=1.0, tint_var=0.08):
    b = NB(name)
    v1 = b.coords()
    fine = b.noise(v1, 38.0, 8.0, 0.62)
    large = b.noise(v1, 2.5, 3.0, 0.5)
    # paint colour with per-object variation
    base = paint_socket if paint_socket is not None else None
    if base is None:
        rv = b.random()
        tint = b.math("ADD", b.math("MULTIPLY", rv, tint_var), 1.0 - tint_var / 2)
        sh = b.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        b.sock(sh, "Factor", "VALUE").default_value = 1.0
        b.sock(sh, "A", "RGBA").default_value = (*paint, 1.0)
        comb = b.n("ShaderNodeCombineColor")
        for ch in ("Red", "Green", "Blue"):
            b.link(tint, comb.inputs[ch])
        b.link(comb.outputs["Color"], b.sock(sh, "B", "RGBA"))
        base = b.sock(sh, "Result", "RGBA", out=True)
    base = b.mixc(b.math("MULTIPLY", large, 0.35), base, b.mixc(0.5, base, (0.25, 0.22, 0.18)))
    # edge wear -> bare metal
    e = b.edge(0.010, 14.0)
    wearf = b.math("ADD", e, b.math("MULTIPLY", b.math("SUBTRACT", fine, 0.5), 1.8))
    wearf = b.maprange(wearf, 0.50, 0.58)
    wearf = b.math("MULTIPLY", wearf, wear, clamp=True)
    # scratches: contours of stretched noise, sparsified
    v2 = b.coords(scale=(1.0, 1.0, 1.0), rot=(b.r.uniform(0, 3), b.r.uniform(0, 3), b.r.uniform(0, 3)))
    sv = b.n("ShaderNodeMapping")
    sv.inputs["Scale"].default_value = (90.0, 4.0, 4.0)
    b.link(v2, sv.inputs["Vector"])
    sn = b.noise(sv.outputs["Vector"], 1.4, 2.0, 0.5)
    line = b.math("SUBTRACT", 1.0, b.math("MULTIPLY", b.math("ABSOLUTE", b.math("SUBTRACT", sn, 0.5)), 120.0), clamp=True)
    gate = b.maprange(b.noise(v1, 6.0, 2.0, 0.5), 0.56, 0.66)
    scr = b.math("MULTIPLY", b.math("MULTIPLY", line, gate), 0.85 * scratch, clamp=True)
    bare = b.math("MAXIMUM", wearf, scr)
    col = b.mixc(bare, base, metal)
    # cavity grime / grease
    cav = b.cavity(0.07)
    g = b.math("MULTIPLY", b.math("ADD", b.math("MULTIPLY", cav, 1.6), b.math("MULTIPLY", large, 0.25)), grime, clamp=True)
    g = b.maprange(g, 0.15, 0.85, 0.0, 0.85)
    col = b.mixc(g, col, grime_col)
    b.inp("Base Color", col)
    b.inp("Metallic", b.mixf(bare, paint_metal, 1.0))
    rough = b.mixf(bare, paint_rough, 0.32)
    rough = b.math("ADD", rough, b.math("MULTIPLY", b.math("SUBTRACT", fine, 0.5), 0.18))
    rough = b.mixf(g, rough, 0.75)
    b.inp("Roughness", rough)
    # chipped paint sits slightly lower than the paint surface
    h = b.math("SUBTRACT", b.math("MULTIPLY", fine, 0.25), b.math("MULTIPLY", wearf, 0.6))
    b.inp("Normal", b.bump(h, 0.12, 0.002))
    b.mat.diffuse_color = (*paint, 1.0) if isinstance(paint, tuple) else (0.5, 0.5, 0.5, 1)
    return b.mat


def hazard(name):
    m = painted(name, (0.90, 0.50, 0.008), wear=1.2, grime=0.8)
    # inject stripes: replace the per-object paint with a diagonal wave pattern
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0.0, 0.0, 0.785)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    wv = nt.nodes.new("ShaderNodeTexWave")
    wv.inputs["Scale"].default_value = 9.0
    wv.wave_profile = "SAW"
    nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.interpolation = "CONSTANT"
    cr.color_ramp.elements[0].position = 0.0
    cr.color_ramp.elements[0].color = (0.90, 0.50, 0.008, 1)
    cr.color_ramp.elements[1].position = 0.5
    cr.color_ramp.elements[1].color = (0.012, 0.012, 0.012, 1)
    nt.links.new(wv.outputs["Fac"], cr.inputs["Fac"])
    # the first MULTIPLY-blend Mix node holds the paint colour in its A input
    for nd in nt.nodes:
        if nd.type == "MIX" and getattr(nd, "blend_type", "") == "MULTIPLY":
            nt.links.new(cr.outputs["Color"], NB.sock(nd, "A", "RGBA"))
            break
    return m


def brushed_titanium(name="M_titanium"):
    b = NB(name)
    v = b.coords()
    st = b.n("ShaderNodeMapping")
    st.inputs["Scale"].default_value = (1.0, 1.0, 260.0)
    b.link(v, st.inputs["Vector"])
    brush = b.noise(st.outputs["Vector"], 3.0, 6.0, 0.6)
    large = b.noise(v, 4.0, 3.0, 0.5)
    cav = b.cavity(0.05)
    col = b.mixc(b.math("MULTIPLY", brush, 0.5), (0.50, 0.50, 0.52), (0.66, 0.66, 0.68))
    col = b.mixc(b.maprange(b.math("ADD", cav, b.math("MULTIPLY", large, 0.3)), 0.25, 0.9, 0.0, 0.7), col,
                 (0.06, 0.05, 0.04))
    b.inp("Base Color", col)
    b.set("Metallic", 1.0)
    b.inp("Roughness", b.mixf(brush, 0.22, 0.38))
    b.set("Anisotropic", 0.55)
    b.inp("Normal", b.bump(brush, 0.05, 0.001))
    b.mat.diffuse_color = (0.6, 0.6, 0.62, 1)
    return b.mat


def chrome(name="M_chrome"):
    b = NB(name)
    v = b.coords()
    smudge = b.noise(v, 9.0, 5.0, 0.6)
    oil = b.maprange(b.noise(v, 3.0, 2.0, 0.5), 0.55, 0.75)
    b.inp("Base Color", b.mixc(b.math("MULTIPLY", oil, 0.6), (0.93, 0.93, 0.95), (0.25, 0.22, 0.18)))
    b.set("Metallic", 1.0)
    b.inp("Roughness", b.mixf(b.maprange(smudge, 0.4, 0.8), 0.04, 0.16))
    b.mat.diffuse_color = (0.9, 0.9, 0.92, 1)
    return b.mat


def rubber(name, col=(0.018, 0.018, 0.02), rough=0.78, dust=0.6):
    b = NB(name)
    v = b.coords()
    d = b.maprange(b.noise(v, 5.0, 4.0, 0.6), 0.45, 0.8, 0.0, dust)
    cav = b.cavity(0.04)
    b.inp("Base Color", b.mixc(b.math("MULTIPLY", d, b.math("SUBTRACT", 1.0, cav), clamp=True), col, (0.16, 0.14, 0.12)))
    b.inp("Roughness", b.mixf(d, rough, 0.95))
    b.set("Specular IOR Level", 0.35)
    b.inp("Normal", b.bump(b.noise(v, 120.0, 2.0, 0.5), 0.08, 0.0005))
    b.mat.diffuse_color = (*col, 1)
    return b.mat


def plastic(name, col, rough=0.42, dirt=0.5):
    b = NB(name)
    v = b.coords()
    d = b.maprange(b.noise(v, 4.0, 4.0, 0.6), 0.5, 0.85, 0.0, dirt)
    b.inp("Base Color", b.mixc(d, col, (0.08, 0.06, 0.045)))
    b.inp("Roughness", b.mixf(d, rough, 0.8))
    b.mat.diffuse_color = (*col, 1)
    return b.mat


def carbon(name="M_carbon"):
    b = NB(name)
    v = b.coords(scale=(1, 1, 1))
    ck = b.n("ShaderNodeTexChecker")
    ck.inputs["Scale"].default_value = 160.0
    ck.inputs["Color1"].default_value = (0.012, 0.012, 0.014, 1)
    ck.inputs["Color2"].default_value = (0.05, 0.05, 0.055, 1)
    b.link(v, ck.inputs["Vector"])
    wv = b.n("ShaderNodeTexWave", wave_type="BANDS")
    wv.inputs["Scale"].default_value = 320.0
    b.link(v, wv.inputs["Vector"])
    col = b.mixc(b.math("MULTIPLY", wv.outputs["Fac"], 0.35), ck.outputs["Color"], (0.0, 0.0, 0.0))
    b.inp("Base Color", col)
    b.set("Roughness", 0.35)
    b.set("Anisotropic", 0.6)
    b.set("Coat Weight", 1.0)
    b.set("Coat Roughness", 0.04)
    b.mat.diffuse_color = (0.03, 0.03, 0.035, 1)
    return b.mat


def emissive(name, col, strength, flicker=0.25):
    b = NB(name)
    v = b.coords()
    nz = b.noise(v, 18.0, 3.0, 0.5)
    k = b.mixf(nz, 1.0 - flicker, 1.0 + flicker)
    em = b.n("ShaderNodeMath", operation="MULTIPLY")
    b.link(k, em.inputs[0])
    em.inputs[1].default_value = strength
    b.set("Base Color", (col[0] * 0.3, col[1] * 0.3, col[2] * 0.3, 1))
    b.set("Emission Color", (*col, 1))
    b.inp("Emission Strength", em.outputs[0])
    b.set("Roughness", 0.25)
    b.mat.diffuse_color = (*col, 1)
    return b.mat


def glass(name="M_glass"):
    b = NB(name)
    b.set("Base Color", (0.85, 0.92, 0.98, 1))
    b.set("Transmission Weight", 1.0)
    b.set("Roughness", 0.015)
    b.set("IOR", 1.52)
    b.mat.diffuse_color = (0.7, 0.8, 0.9, 0.3)
    return b.mat


def lens_inner(name="M_lens_inner"):
    b = NB(name)
    b.set("Base Color", (0.005, 0.007, 0.012, 1))
    b.set("Metallic", 0.3)
    b.set("Roughness", 0.08)
    b.set("Coat Weight", 1.0)
    b.set("Coat Roughness", 0.02)
    b.set("Thin Film Thickness", 420.0)
    b.set("Thin Film IOR", 1.45)
    b.mat.diffuse_color = (0.01, 0.01, 0.02, 1)
    return b.mat


def grease(name="M_grease"):
    b = NB(name)
    v = b.coords()
    n = b.noise(v, 14.0, 6.0, 0.65)
    b.inp("Base Color", b.mixc(n, (0.022, 0.016, 0.008), (0.06, 0.045, 0.02)))
    b.inp("Roughness", b.mixf(b.maprange(n, 0.3, 0.7), 0.08, 0.45))
    b.set("Metallic", 0.0)
    b.set("Coat Weight", 0.6)
    b.set("Coat Roughness", 0.1)
    b.inp("Normal", b.bump(n, 0.4, 0.002))
    b.mat.diffuse_color = (0.03, 0.025, 0.015, 1)
    return b.mat


def metal(name, col, rough=0.35, rust=0.0, heat=False, grime=0.6):
    b = NB(name)
    v = b.coords()
    n = b.noise(v, 24.0, 6.0, 0.6)
    large = b.noise(v, 3.0, 3.0, 0.5)
    c = b.mixc(b.math("MULTIPLY", n, 0.4), col, tuple(x * 0.7 for x in col))
    if heat:   # weld heat tint: straw -> blue bands
        cr = b.n("ShaderNodeValToRGB")
        els = cr.color_ramp.elements
        els[0].position, els[0].color = 0.35, (0.45, 0.32, 0.12, 1)
        els[1].position, els[1].color = 0.65, (0.12, 0.16, 0.35, 1)
        b.link(large, cr.inputs["Fac"])
        c = b.mixc(0.55, c, cr.outputs["Color"])
    if rust > 0:
        rm = b.maprange(b.noise(v, 7.0, 6.0, 0.7), 0.62, 0.72, 0.0, rust)
        c = b.mixc(rm, c, (0.25, 0.08, 0.02))
    cav = b.cavity(0.04)
    g = b.maprange(b.math("MULTIPLY", cav, grime * 1.6), 0.1, 0.9, 0.0, 0.85)
    c = b.mixc(g, c, (0.03, 0.025, 0.018))
    b.inp("Base Color", c)
    b.set("Metallic", 1.0)
    b.inp("Roughness", b.mixf(g, b.mixf(n, rough - 0.08, rough + 0.08), 0.7))
    b.inp("Normal", b.bump(n, 0.08, 0.001))
    b.mat.diffuse_color = (*col, 1)
    return b.mat


def concrete(name="M_concrete", col=(0.30, 0.29, 0.27)):
    b = NB(name)
    v = b.coords()
    n1 = b.noise(v, 1.2, 5.0, 0.6)
    n2 = b.noise(v, 30.0, 8.0, 0.7)
    vor = b.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    vor.inputs["Scale"].default_value = 2.2
    b.link(v, vor.inputs["Vector"])
    crack = b.math("SUBTRACT", 1.0, b.maprange(vor.outputs["Distance"], 0.0, 0.012), clamp=True)
    crack = b.math("MULTIPLY", crack, b.maprange(b.noise(v, 3.0, 2.0, 0.5), 0.5, 0.6))
    c = b.mixc(n1, tuple(x * 0.75 for x in col), tuple(min(1, x * 1.2) for x in col))
    c = b.mixc(b.math("MULTIPLY", n2, 0.4), c, (0.18, 0.17, 0.16))
    c = b.mixc(crack, c, (0.05, 0.05, 0.05))
    stain = b.maprange(b.noise(v, 0.6, 3.0, 0.5), 0.55, 0.75, 0.0, 0.5)
    c = b.mixc(stain, c, (0.09, 0.08, 0.07))
    b.inp("Base Color", c)
    b.inp("Roughness", b.mixf(stain, b.mixf(n2, 0.78, 0.95), 0.45))
    h = b.math("SUBTRACT", b.math("MULTIPLY", n2, 0.6), b.math("MULTIPLY", crack, 1.0))
    b.inp("Normal", b.bump(h, 0.35, 0.004))
    b.mat.diffuse_color = (*col, 1)
    return b.mat


def floor_paint(name="M_floor_paint", col=(0.80, 0.50, 0.02)):
    b = NB(name)
    v = b.coords()
    n = b.noise(v, 6.0, 8.0, 0.65)
    worn = b.maprange(n, 0.55, 0.62)
    c = b.mixc(worn, col, (0.22, 0.21, 0.2))
    c = b.mixc(b.maprange(b.noise(v, 1.0, 3.0, 0.5), 0.5, 0.8, 0.0, 0.5), c, (0.08, 0.07, 0.06))
    b.inp("Base Color", c)
    b.inp("Roughness", b.mixf(worn, 0.55, 0.85))
    b.mat.diffuse_color = (*col, 1)
    return b.mat


def build_pbr():
    P = lambda k, *a, **kw: painted(f"M_{k}", *a, **kw)
    mats = {
        "armor": P("armor", (0.90, 0.47, 0.008), wear=1.0, grime=1.0),
        "armor_dark": P("armor_dark", (0.055, 0.058, 0.062), metal=(0.5, 0.5, 0.52), wear=1.0, grime=0.8,
                        paint_rough=0.5),
        "steel_dark": P("steel_dark", (0.10, 0.104, 0.11), metal=(0.55, 0.55, 0.56), wear=0.9, grime=1.2,
                        paint_rough=0.38, paint_metal=0.35, scratch=0.35),
        "steel_joint": P("steel_joint", (0.085, 0.088, 0.092), wear=1.2, grime=2.0, paint_rough=0.35,
                         paint_metal=0.4, grime_col=(0.02, 0.016, 0.01)),
        "spring": P("spring", (0.55, 0.05, 0.02), wear=1.4, grime=0.8, paint_rough=0.3),
        "decal_white": P("decal_white", (0.80, 0.80, 0.77), wear=0.6, grime=0.6, scratch=0.3, tint_var=0.0),
        "decal_black": P("decal_black", (0.015, 0.015, 0.015), wear=0.6, grime=0.3, scratch=0.3, tint_var=0.0),
        "hazard": hazard("M_hazard"),
        "titanium": brushed_titanium(),
        "chrome": chrome(),
        "rubber": rubber("M_rubber"),
        "hose": rubber("M_hose", (0.025, 0.025, 0.027), rough=0.55, dust=0.4),
        "cable_orange": plastic("M_cable_orange", (0.85, 0.22, 0.015)),
        "cable_red": plastic("M_cable_red", (0.45, 0.02, 0.015)),
        "carbon": carbon(),
        "emit_blue": emissive("M_emit_blue", (0.12, 0.55, 1.0), 18.0),
        "emit_amber": emissive("M_emit_amber", (1.0, 0.42, 0.05), 10.0),
        "led_red": emissive("M_led_red", (1.0, 0.04, 0.02), 14.0, 0.05),
        "led_green": emissive("M_led_green", (0.15, 1.0, 0.25), 12.0, 0.05),
        "glass": glass(),
        "lens_inner": lens_inner(),
        "grease": grease(),
        "weld": metal("M_weld", (0.32, 0.30, 0.28), rough=0.55, heat=True),
        "bolt": metal("M_bolt", (0.42, 0.42, 0.43), rough=0.38, rust=0.6, grime=0.8),
        "gear": metal("M_gear", (0.40, 0.40, 0.41), rough=0.30, grime=1.4),
        "copper": metal("M_copper", (0.80, 0.42, 0.25), rough=0.3, grime=0.4),
        "concrete": concrete(),
        "floor_paint": floor_paint(),
        "floor_white": floor_paint("M_floor_white", (0.62, 0.62, 0.60)),
    }
    return mats
