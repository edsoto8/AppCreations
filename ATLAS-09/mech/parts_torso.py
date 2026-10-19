"""Torso: pelvis block, waist slewing bearing and actuators, chest hull with layered armor,
central power core, back power pack (radiator, fans, exhaust stacks), roll bar, hydraulic
distribution manifolds, shoulder sockets and the neck mount. World coordinates (the torso
bones are vertical)."""

import math

from mathutils import Vector

from . import details as D
from . import primitives as P
from . import skeleton as SK
from . import utils as U

CHEST_Z0, CHEST_Z1 = 2.66, 3.46
HULL_Y0, HULL_Y1 = -0.24, 0.36


def hull_taper(z):
    """Width scale of the chest hull against height (narrow waist, broad shoulders)."""
    pts = ((2.60, 0.62), (2.66, 0.66), (2.98, 0.96), (3.22, 1.0), (3.50, 0.90))
    for (z0, t0), (z1, t1) in zip(pts, pts[1:]):
        if z <= z1:
            return U.lerp(t0, t1, max(0.0, (z - z0) / (z1 - z0)))
    return pts[-1][1]


def hull_half_width(z):
    return 0.64 * hull_taper(z)


def front_half_width(z):
    return 0.40 * hull_taper(z)


def build(ctx):
    ms = ctx["milestone"]
    coll = U.sub_coll("Torso")
    rigc = U.sub_coll("Rig")
    kit = P.Kit(ctx["mats"], coll)
    kp, ksp, kc = kit.at("pelvis"), kit.at("spine"), kit.at("chest")
    out = []

    # ===================================================================== M2 structure
    out.append(P.box_obj(kp, "Torso_Pelvis_Core", (0.52, 0.46, 0.34), U.T(0, 0.06, 2.15), bevel=0.045))
    crotch = [(-0.20, 0.0), (0.20, 0.0), (0.14, -0.22), (-0.14, -0.22)]
    out.append(P.make("Torso_Pelvis_Keel", coll, kit.m("steel_dark"),
                      lambda bm: P.bm_prism(bm, crotch, 0.30, bevel=0.03),
                      U.T(0, 0.06, 2.02) @ P.ORIENT["-Y"], "pelvis"))
    # waist column (spine): flanged lathe body + gimbal block under the chest floor
    out.append(P.make("Torso_Waist_Column", coll, kit.m("titanium"),
                      lambda bm: P.bm_lathe(bm, [(0, 2.34), (0.20, 2.34), (0.20, 2.38), (0.15, 2.40), (0.14, 2.56),
                                                 (0.19, 2.58), (0.19, 2.62), (0, 2.62)], segs=40),
                      U.T(0, 0.06, 0), "spine"))
    out.append(P.box_obj(kc, "Torso_Chest_Floor", (0.86, 0.60, 0.06), U.T(0, 0.06, 2.64), bevel=0.02))

    hull_outline = [(0.40, -0.24), (0.64, -0.10), (0.64, 0.36), (-0.64, 0.36), (-0.64, -0.10), (-0.40, -0.24)]

    out.append(P.make("Torso_Chest_Hull", coll, kit.m("steel_dark"),
                      lambda bm: P.bm_prism(bm, hull_outline, CHEST_Z1 - CHEST_Z0,
                                            cuts_z=(2.98 - 3.06, 3.22 - 3.06), warp=_hull_warp),
                      None, "chest", bevel=0.02))
    out.append(P.box_obj(kc, "Torso_Chest_Keel", (0.30, 0.20, 0.86), U.T(0, 0.30, 3.04), "titanium", bevel=0.02))
    out.append(P.box_obj(kc, "Torso_PowerPack", (0.84, 0.32, 0.70), U.T(0, 0.51, 3.07), bevel=0.035))
    out.append(P.box_obj(kc, "Torso_PowerPack_Lower", (0.64, 0.26, 0.16), U.T(0, 0.47, 2.68), bevel=0.03))
    # roll bar behind the head (structural, protects the sensor head)
    def rollbar(bm):
        pts = [Vector((x, 0.30, z)) for x, z in ((-0.46, 3.40), (-0.42, 3.72), (-0.30, 3.86), (0.30, 3.86),
                                                  (0.42, 3.72), (0.46, 3.40))]
        for a, b in zip(pts, pts[1:]):
            P.bm_rod(bm, a, b, 0.038, segs=20)
        for p in pts[1:-1]:
            P.bm_sphere(bm, 0.038, U.T(*p), segs=20, rings=10)
        for p in (pts[0], pts[-1]):
            P.bm_box(bm, 0.14, 0.14, 0.05, U.T(*p) @ U.T(z=0.02), bevel=0.01, mat=0)
    out.append(P.make("Torso_RollBar", coll, kit.m("steel_dark"), rollbar, None, "chest", wn=False))
    # neck mount flange
    out.append(P.make("Torso_NeckMount", coll, kit.m("titanium"),
                      lambda bm: P.bm_lathe(bm, [(0, 0), (0.22, 0), (0.22, 0.03), (0.17, 0.05), (0.15, 0.06),
                                                 (0, 0.06)], segs=40),
                      U.T(0, -0.06, CHEST_Z1 - 0.01), "chest"))
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        # shoulder socket boss on the hull side
        sx = hull_half_width(3.20)
        out.append(P.make(f"Torso_ShoulderSocket_{sd}", coll, kit.m("steel_dark"),
                          lambda bm: P.bm_lathe(bm, [(0, 0), (0.30, 0), (0.30, 0.03), (0.27, 0.06), (0.0, 0.06)],
                                                segs=40),
                          U.T(s * (sx - 0.01), 0.06, 3.20) @ U.R(90 * s, "Y"), "chest"))
    if ms < 3:
        return out

    # ===================================================================== M3 joints + hydraulics
    out += P.bearing(kp, "Torso_Waist", U.T(0, 0.06, 2.33), 0.25, 0.15, 0.05, bolts=12, bolt_size=0.012)
    out += P.bearing(kc, "Torso_Neck", U.T(0, -0.06, CHEST_Z1 + 0.05), 0.17, 0.09, 0.04, bolts=10, bolt_size=0.009)
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        sx = hull_half_width(3.20)
        out += P.bearing(kc, f"Torso_Shoulder_{sd}", U.T(s * (sx + 0.08), 0.06, 3.20) @ U.R(90 * s, "Y"),
                         0.26, 0.16, 0.05, bolts=12, bolt_size=0.012)
        # waist actuators: pelvis -> chest floor, either side of the column
        p0, p1 = Vector((s * 0.22, 0.06, 2.24)), Vector((s * 0.36, 0.06, 2.63))
        out.append(P.mount_lug(kp, f"Torso_WaistAct_{sd}_MountPelvis", p0, Vector((0, 1, 0)), r=0.035, w=0.07,
                               base_dir=Vector((-s, 0, 0)), base_len=0.02))
        out.append(P.mount_lug(kc, f"Torso_WaistAct_{sd}_MountChest", p1, Vector((0, 1, 0)), r=0.035, w=0.07,
                               base_dir=Vector((0, 0, 1)), base_len=0.0))
        wp = P.piston(kit, f"Torso_Waist_Actuator_{sd}", p0, p1, "pelvis", "chest", r_barrel=0.036,
                      barrel_frac=0.5, coll_rig=rigc)
        out += [wp["cyl"], wp["rod"]]
        # hydraulic distribution manifold under each shoulder
        out += _manifold(kc, f"Torso_Manifold_{sd}", U.T(s * (hull_half_width(2.86) + 0.07), 0.16, 2.86), s)
    # pump unit on the back of the pelvis
    out.append(P.make("Torso_HydraulicPump", coll, kit.m("steel_dark", "titanium"),
                      lambda bm: (P.bm_cyl(bm, 0.11, 0.30, U.R(90, "Y"), segs=32, bevel=0.012),
                                  P.bm_cyl(bm, 0.075, 0.36, U.R(90, "Y"), segs=24, mat=1),
                                  [P.bm_cyl(bm, 0.118, 0.012, U.T(x=x) @ U.R(90, "Y"), segs=32, mat=1)
                                   for x in (-0.08, -0.04, 0.0, 0.04, 0.08)]),
                      U.T(0, 0.37, 2.16), "pelvis"))
    out.append(P.box_obj(kp, "Torso_HydraulicPump_Bracket", (0.34, 0.10, 0.06), U.T(0, 0.31, 2.08), bevel=0.012))

    if ms < 4:
        return out

    # ===================================================================== M4 armor + mechanics
    out += _chest_armor(kit)
    out += _pelvis_armor(kit)
    out += _power_pack(kit, rigc)
    out += _core(kit)
    if ms < 5:
        return out
    out += _torso_details(kit)
    return out


def _hull_warp(co):
    # prism was built centred at z=0; move it to the chest band and taper
    co.z += 3.06
    co.x *= hull_taper(co.z)
    return co


def _manifold(kit, name, m, s):
    """Distribution block with ports and hex fittings (hoses attach in cables.py)."""
    def b(bm):
        P.bm_box(bm, 0.14, 0.22, 0.20, bevel=0.012, mat=0)
        for i in range(3):
            for j in range(2):
                y, z = -0.06 + 0.06 * i, -0.045 + 0.09 * j
                P.bm_cyl(bm, 0.018, 0.03, U.T(s * 0.08, y, z) @ U.R(90, "Y"), segs=6, mat=1)
                P.bm_cyl(bm, 0.012, 0.03, U.T(s * 0.105, y, z) @ U.R(90, "Y"), segs=12, mat=1)
        P.bm_cyl(bm, 0.03, 0.05, U.T(0, 0, 0.12), segs=16, bevel=0.004, mat=1)    # pressure gauge stem
        P.bm_cyl(bm, 0.05, 0.02, U.T(0, 0, 0.155), segs=24, bevel=0.004, mat=1)
    ob = P.make(name, kit.coll, kit.m("steel_dark", "titanium"), b, m, kit.bone)
    gl = P.make(f"{name}_GaugeFace", kit.coll, kit.m("decal_white"),
                lambda bm: P.bm_cyl(bm, 0.04, 0.004, U.T(0, 0, 0.167), segs=24), m, kit.bone, wn=False)
    out = [ob, gl]
    out += P.bolt_line(kit, name, m @ Vector((-0.05, -0.09, 0.10)), m @ Vector((0.05, -0.09, 0.10)),
                       Vector((0, 0, 1)), 2, 0.008, "socket")
    return out


def _chest_armor(kit):
    kc = kit.at("chest")
    out = []
    zt = CHEST_Z1
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        f = front_half_width
        # upper chest plate on the flat front, inner-bottom corner chamfered to frame the core
        pts = [(0.035, 3.26), (0.15, 3.14), (f(3.14) + 0.01, 3.14), (f(3.30) + 0.01, 3.30), (f(zt) - 0.02, zt - 0.01),
               (0.035, zt - 0.01)]
        pts = pts if s > 0 else P.flip_outline_x(pts)
        out.append(P.armor_plate(kc, f"Torso_Chest_Armor_Upper_{sd}", pts, 0.05, U.T(0, HULL_Y0 - 0.003, 0) @ P.ORIENT["-Y"],
                                 bevel=0.014))
        # layered secondary plate along the top edge
        p2 = [(0.06, 3.35), (f(3.35) - 0.035, 3.35), (f(3.42) - 0.05, 3.42), (0.06, 3.42)]
        p2 = p2 if s > 0 else P.flip_outline_x(p2)
        out.append(P.armor_plate(kc, f"Torso_Chest_Armor_UpperLayer_{sd}", p2, 0.025,
                                 U.T(0, HULL_Y0 - 0.053, 0) @ P.ORIENT["-Y"], bevel=0.008))
        # cooling slots cut through the upper plate (validated boolean, fallback = louvre vent)
        upper = kit.coll.objects[f"Torso_Chest_Armor_Upper_{sd}"]
        cutters = [P.make(f"Torso_Chest_SlotCutter_{sd}_{i}", kit.coll, kit.m("steel_dark"),
                          lambda bm: P.bm_box(bm, 0.13, 0.016, 0.2, bevel=0.005),
                          U.T(s * 0.27, HULL_Y0, 3.21 + 0.03 * i) @ P.ORIENT["-Y"], None, wn=False)
                   for i in range(3)]

        def _fb(ob, s=s, sd=sd):
            out.extend(P.vent(kc, f"Torso_Chest_Vent_{sd}", U.T(s * 0.27, HULL_Y0 - 0.053, 3.24) @ P.ORIENT["-Y"],
                              0.15, 0.10, 3))
        U.boolean_cut(upper, cutters, f"chest_slots_{sd}", fallback=_fb)
        # flank plates on the chevron faces
        yaw = math.degrees(math.atan2(0.14, 0.24 * 0.97))
        cx = 0.52 * hull_taper(3.2)
        fl = P.poly_chamfer_rect(0.25, 0.40, (0.02, 0.02, 0.07, 0.02) if s > 0 else (0.02, 0.02, 0.02, 0.07))
        out.append(P.armor_plate(kc, f"Torso_Chest_Armor_Flank_{sd}", fl, 0.045,
                                 U.T(s * cx, -0.17 - 0.005, 3.20) @ U.R(yaw * s, "Z") @ P.ORIENT["-Y"],
                                 bevel=0.012))
        # lower chest / belly plates either side of the core
        lp = [(0.17, 2.70), (f(2.70) + 0.005, 2.70), (f(2.98) + 0.01, 2.98), (0.19, 2.98), (0.15, 2.86)]
        lp = lp if s > 0 else P.flip_outline_x(lp)
        out.append(P.armor_plate(kc, f"Torso_Chest_Armor_Lower_{sd}", lp, 0.045, U.T(0, HULL_Y0 - 0.003, 0) @ P.ORIENT["-Y"],
                                 bevel=0.012))
        # side plates under the shoulder socket
        sp = P.outline_side(P.poly_chamfer_rect(0.28, 0.20, (0.02, 0.04, 0.02, 0.06), cx=0.0), s)
        hx = hull_half_width(2.90)
        out.append(P.armor_plate(kc, f"Torso_Chest_Armor_Side_{sd}", sp, 0.03,
                                 U.T(s * (hx + 0.002), 0.10, 2.90) @ U.R(-s * 6, "Y") @ P.side_orient(s),
                                 mats=("armor_dark",), bevel=0.01))
        # collar plate beside the neck
        cp = P.poly_chamfer_rect(0.22, 0.10, (0.0, 0.0, 0.03, 0.03))
        out.append(P.armor_plate(kc, f"Torso_Collar_{sd}", cp, 0.03,
                                 U.T(s * 0.25, -0.12, zt + 0.02) @ U.R(-s * 15, "Z") @ U.R(-35, "X") @ P.ORIENT["-Y"],
                                 bevel=0.01))
        # top deck plates (shoulder line)
        tp = P.poly_chamfer_rect(0.30, 0.42, 0.04)
        out.append(P.armor_plate(kc, f"Torso_TopDeck_{sd}", tp, 0.025, U.T(s * 0.42, 0.10, zt), mats=("armor_dark",),
                                 bevel=0.008))
    # centre collar (front of the neck)
    out.append(P.armor_plate(kc, "Torso_Collar_Front", P.poly_chamfer_rect(0.26, 0.09, (0.0, 0.0, 0.03, 0.03)), 0.03,
                             U.T(0, -0.22, zt) @ U.R(-40, "X") @ P.ORIENT["-Y"], bevel=0.01))
    return out


def _pelvis_armor(kit):
    kp, ks = kit.at("pelvis"), kit.at("spine")
    out = []
    # front plate (codpiece) and segmented abdomen bands
    cp = [(-0.22, 2.30), (0.22, 2.30), (0.24, 2.12), (0.12, 1.98), (-0.12, 1.98), (-0.24, 2.12)]
    out.append(P.armor_plate(kp, "Torso_Pelvis_Armor_Front", cp, 0.045, U.T(0, -0.17, 0) @ P.ORIENT["-Y"],
                             cuts_x=(-0.12, 0.0, 0.12), bend=("Y", 0.5)))
    for i, z in enumerate((2.38, 2.46, 2.54)):
        w = 0.44 + 0.06 * i
        band = P.poly_chamfer_rect(w, 0.10, (0.02, 0.02, 0.02, 0.02), cy=0.0)
        out.append(P.armor_plate(ks, f"Torso_Abdomen_Band_{i}", band, 0.025,
                                 U.T(0, -0.16 - 0.012 * i, z) @ U.R(-12, "X") @ P.ORIENT["-Y"],
                                 mats=("armor_dark",), cuts_x=(-0.15, 0.0, 0.15), bend=("Y", 0.30), bevel=0.008))
    out.append(P.armor_plate(ks, "Torso_Abdomen_RearCover", P.poly_chamfer_rect(0.30, 0.20, 0.03), 0.02,
                             U.T(0, 0.23, 2.48) @ P.ORIENT["+Y"], mats=("carbon",), bevel=0.006))
    # hip tassets: armor over the hip yokes, hinged at the top to the pelvis core
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        tp = P.outline_side(P.poly_chamfer_rect(0.40, 0.30, (0.02, 0.02, 0.08, 0.04), cx=-0.02), s)
        out.append(P.armor_plate(kp, f"Torso_Tasset_{sd}", tp, 0.04,
                                 U.T(s * 0.70, 0.04, 2.30) @ U.R(s * 14, "Y") @ P.side_orient(s),
                                 cuts_x=(-0.12, 0.0, 0.12), bend=("Y", 0.45)))
        out.append(P.box_obj(kp, f"Torso_Tasset_{sd}_Hinge", (0.10, 0.30, 0.06), U.T(s * 0.63, 0.04, 2.47), bevel=0.015))
        out.append(P.make(f"Torso_Tasset_{sd}_HingePin", kit.coll, kit.m("chrome"),
                          lambda bm: P.bm_cyl(bm, 0.018, 0.34, U.R(90, "X"), segs=16, bevel=0.003),
                          U.T(s * 0.68, 0.04, 2.47), "pelvis"))
    return out


def _power_pack(kit, rigc):
    kc = kit.at("chest")
    out = []
    yb = 0.67   # back face of the power pack
    out.append(P.fin_stack(kc, "Torso_Radiator", U.T(0, yb, 2.86) @ P.ORIENT["+Y"], 0.5, 0.26, 0.05, 26, 0.02))
    out.append(P.box_obj(kc, "Torso_Radiator_Frame", (0.56, 0.02, 0.30), U.T(0, yb + 0.005, 2.86), bevel=0.006))
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        out += P.fan(kc, f"Torso_Back_{sd}", U.T(s * 0.21, yb, 3.20) @ P.ORIENT["+Y"], 0.13, 0.05)
        # exhaust stack with heat shield
        x = s * 0.30
        out.append(P.make(f"Torso_Exhaust_{sd}_Pipe", kit.coll, kit.m("titanium"),
                          lambda bm: P.bm_lathe(bm, [(0, 0), (0.08, 0.0), (0.08, 0.03), (0.058, 0.04), (0.055, 0.42),
                                                     (0.064, 0.44), (0.064, 0.50), (0.05, 0.50), (0.05, 0.47),
                                                     (0.0, 0.47)], segs=32),
                          U.T(x, 0.56, 3.42), "chest"))
        out.append(P.make(f"Torso_Exhaust_{sd}_Cap", kit.coll, kit.m("steel_dark"),
                          lambda bm: P.bm_cyl(bm, 0.075, 0.012, U.T(0, 0.0, 0.0), segs=32, bevel=0.003),
                          U.T(x, 0.56, 3.935) @ U.R(-25, "X") @ U.T(0, 0.045, 0.0), "chest"))
        out.append(P.make(f"Torso_Exhaust_{sd}_CapHinge", kit.coll, kit.m("steel_dark"),
                          lambda bm: P.bm_cyl(bm, 0.012, 0.06, U.R(90, "Y"), segs=12),
                          U.T(x, 0.62, 3.93), "chest", wn=False))
        out.append(P.make(f"Torso_Exhaust_{sd}_HeatShield", kit.coll, kit.m("steel_dark"),
                          lambda bm: P.bm_lathe(bm, [(0.075, 0.0), (0.075, 0.30)], segs=24, a0=math.radians(200),
                                                a1=math.radians(340)),
                          U.T(x, 0.56, 3.55), "chest", wn=False))
        hs = kit.coll.objects[f"Torso_Exhaust_{sd}_HeatShield"]
        U.add_solidify(hs, 0.006, 1.0)
        out += P.bolt_ring(kc, f"Torso_Exhaust_{sd}_Flange", U.T(x, 0.56, 3.45), 0.068, 6, 0.007, "hex")
        # vent grilles on the pack sides
        out += P.vent(kc, f"Torso_PowerPack_{sd}", U.T(s * 0.425, 0.51, 3.10) @ P.side_orient(s), 0.22, 0.30, 7)
    return out


def _core(kit):
    """Central power core: armored bezel, emissive cell behind glass, guard bars."""
    kc = kit.at("chest")
    out = []
    zc, y0 = 2.98, HULL_Y0
    m = U.T(0, y0, zc) @ P.ORIENT["-Y"]
    out.append(P.make("Torso_Core_Bezel", kit.coll, kit.m("titanium"),
                      lambda bm: P.bm_tube(bm, 0.175, 0.11, 0.06, U.T(z=0.03), segs=48, bevel=0.01), m, "chest"))
    out.append(P.make("Torso_Core_HexFrame", kit.coll, kit.m("steel_dark"),
                      lambda bm: P.bm_tube(bm, 0.21, 0.172, 0.045, U.T(z=0.022) @ U.R(30, "Z"), segs=6, bevel=0.008),
                      m, "chest"))
    out.append(P.make("Torso_Core_Cell", kit.coll, kit.m("emit_blue"),
                      lambda bm: P.bm_lathe(bm, [(0, 0.0), (0.11, 0.0), (0.11, 0.02), (0.08, 0.035), (0, 0.04)],
                                            segs=40), m, "chest", wn=False))
    out.append(P.make("Torso_Core_Glass", kit.coll, kit.m("glass"),
                      lambda bm: P.bm_lathe(bm, [(0, 0.05), (0.112, 0.045), (0.112, 0.042), (0, 0.047)], segs=40),
                      m, "chest", wn=False))
    def bars(bm):
        for i in range(5):
            x = -0.08 + 0.04 * i
            h = 2 * math.sqrt(max(0.0, 0.112 ** 2 - x ** 2))
            P.bm_box(bm, 0.012, h, 0.012, U.T(x, 0, 0.062), bevel=0.003)
    out.append(P.make("Torso_Core_GuardBars", kit.coll, kit.m("steel_dark"), bars, m, "chest", wn=False))
    out += P.bolt_ring(kc, "Torso_Core_Bezel", m @ U.T(z=0.06), 0.145, 10, 0.008, "socket")
    return out


def _torso_details(kit):
    kc, kp = kit.at("chest"), kit.at("pelvis")
    out = []
    f = front_half_width
    # labels
    out.append(D.label(kc, "Torso_Label_Serial", "ATLAS-09", U.T(0.21, HULL_Y0 - 0.054, 3.31) @ P.ORIENT["-Y"], 0.045,
                       mat="decal_black"))
    out.append(D.label(kc, "Torso_Label_SN", "SN 0917-AX", U.T(-0.21, HULL_Y0 - 0.054, 3.31) @ P.ORIENT["-Y"],
                       0.03, mat="decal_black"))
    out.append(D.label(kc, "Torso_Label_Core", "CORE 4.2 MW", U.T(0, HULL_Y0 - 0.006, 2.76) @ P.ORIENT["-Y"], 0.03,
                       mat="decal_white"))
    out.append(D.label(kc, "Torso_Label_Warning", "DANGER  HIGH PRESSURE", U.T(0.0, 0.672, 3.02) @ P.ORIENT["+Y"],
                       0.03, mat="decal_white"))
    out.append(D.label(kc, "Torso_Label_NoStep_L", "NO STEP", U.T(0.42, 0.10, CHEST_Z1 + 0.026), 0.035,
                       mat="decal_white"))
    out.append(D.label(kc, "Torso_Label_NoStep_R", "NO STEP", U.T(-0.42, 0.10, CHEST_Z1 + 0.026), 0.035,
                       mat="decal_white"))
    out.append(D.label(kp, "Torso_Label_Pelvis", "LIFT POINT", U.T(0, -0.218, 2.24) @ P.ORIENT["-Y"], 0.026,
                       mat="decal_black"))
    # hazard strips along the lower edge of the upper chest plates
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        hz = [(0.17, 3.15), (f(3.15) - 0.01, 3.15), (f(3.19) - 0.01, 3.19), (0.17, 3.19)]
        hz = hz if s > 0 else P.flip_outline_x(hz)
        out.append(P.armor_plate(kc, f"Torso_Chest_HazardStrip_{sd}", hz, 0.004,
                                 U.T(0, HULL_Y0 - 0.054, 0) @ P.ORIENT["-Y"], mats=("hazard",), bevel=0.001))
        # LED status strips on the flank plates
        yaw = math.degrees(math.atan2(0.14, 0.24 * 0.97))
        cx = 0.52 * hull_taper(3.2)
        out.append(D.led_strip(kc, f"Torso_Flank_LightBar_{sd}",
                               U.T(s * cx, -0.17, 3.20) @ U.R(yaw * s, "Z") @ P.ORIENT["-Y"] @ U.T(0, 0.12, 0.045),
                               0.14))
        out.append(D.led(kc, f"Torso_Flank_LED_{sd}",
                         U.T(s * cx, -0.17, 3.20) @ U.R(yaw * s, "Z") @ P.ORIENT["-Y"] @ U.T(0, -0.12, 0.045),
                         "led_red" if s > 0 else "led_green"))
        # bolts on armor
        out += P.bolt_line(kc, f"Torso_Chest_Armor_UpperLayer_{sd}", Vector((s * 0.09, HULL_Y0 - 0.078, 3.385)),
                           Vector((s * (f(3.385) - 0.08), HULL_Y0 - 0.078, 3.385)), Vector((0, -1, 0)), 4, 0.010)
        out += P.bolt_line(kc, f"Torso_Chest_Armor_Lower_{sd}", Vector((s * 0.22, HULL_Y0 - 0.048, 2.73)),
                           Vector((s * (f(2.73) - 0.03), HULL_Y0 - 0.048, 2.73)), Vector((0, -1, 0)), 3, 0.011)
        out += P.bolt_line(kc, f"Torso_TopDeck_{sd}", Vector((s * 0.30, -0.08, CHEST_Z1 + 0.025)),
                           Vector((s * 0.30, 0.28, CHEST_Z1 + 0.025)), Vector((0, 0, 1)), 4, 0.009, "socket")
        out += P.bolt_line(kc, f"Torso_PowerPack_{sd}_Edge", Vector((s * 0.40, 0.672, 2.78)),
                           Vector((s * 0.40, 0.672, 3.36)), Vector((0, 1, 0)), 5, 0.01)
        # access panels
        out += D.access_panel(kc, f"Torso_AccessPanel_Back_{sd}", U.T(s * 0.21, 0.672, 3.40) @ P.ORIENT["+Y"] @ U.T(0, -0.0, 0),
                              0.18, 0.10, "armor_dark", handle=False)
        out += D.access_panel(kc, f"Torso_AccessPanel_Side_{sd}",
                              U.T(s * (hull_half_width(3.36) + 0.002), 0.22, 3.36) @ P.side_orient(s), 0.16, 0.12)
    # weld seams: chest floor to waist column, keel to floor
    out.append(P.weld_seam(kc, "Torso_Weld_Floor_Front", [(-0.3, -0.24, 2.672), (0.0, -0.245, 2.672), (0.3, -0.24, 2.672)]))
    out.append(P.weld_seam(kp, "Torso_Weld_Pelvis", [(-0.2, -0.173, 2.32), (0.0, -0.175, 2.32), (0.2, -0.173, 2.32)]))
    out += D.access_panel(kp, "Torso_AccessPanel_Pelvis", U.T(0, 0.293, 2.21) @ P.ORIENT["+Y"], 0.24, 0.14)
    return out
