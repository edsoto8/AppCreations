"""Legs: hip yoke and drum, thigh, hydraulic knee, shin with shock absorbers, reinforced ankle,
wide articulated foot with split toes.

Limb parts are modelled in the bone's segment frame (``skeleton.seg``): origin at the joint,
local Z up the limb, local X = world X (outward is ``s * X``), local Y = backward.
"""

from mathutils import Vector

from . import primitives as P
from . import skeleton as SK
from . import utils as U


def build(ctx, side):
    ms = ctx["milestone"]
    s = SK.side_sign(side)
    coll = U.sub_coll(f"Leg_{side}")
    rigc = U.sub_coll("Rig")
    kit = P.Kit(ctx["mats"], coll)
    pre = f"Leg_{side}"
    bn = {k: f"{k}.{side}" for k in ("thigh", "shin", "foot", "toe")}
    kt, ks, kf, ko = (kit.at(bn[k]) for k in ("thigh", "shin", "foot", "toe"))
    kp = kit.at("pelvis")

    Mt, Lt = SK.seg(bn["thigh"])
    Ms, Ls = SK.seg(bn["shin"])
    H = SK.head(bn["thigh"])
    A = SK.head(bn["foot"])
    Mf = U.T(*A)                      # foot: world-aligned frame at the ankle
    out = []

    def tp(v):          # thigh-local point -> world
        return Mt @ Vector(v)

    def sp(v):
        return Ms @ Vector(v)

    def fp(v):
        return Mf @ Vector(v)

    # ===================================================================== M2 structure
    out.append(P.box_obj(kt, f"{pre}_Thigh_Hub", (0.30, 0.34, 0.20), Mt @ U.T(z=-0.17), bevel=0.03))
    fh = Lt - 0.55
    out.append(P.make(f"{pre}_Thigh_Femur", coll, kit.m("steel_dark"),
                      lambda bm: P.bm_prism(bm, P.poly_chamfer_rect(0.24, 0.24, 0.05), fh, bevel=0.01),
                      Mt @ U.T(z=-(0.25 + fh / 2)), bn["thigh"]))
    out.append(P.box_obj(kt, f"{pre}_Thigh_KneeYoke", (0.44, 0.26, 0.14), Mt @ U.T(z=-(Lt - 0.25)), bevel=0.025))
    # femur stiffening ribs (front/back flanges)
    for yy, nm in ((-0.115, "Front"), (0.115, "Rear")):
        out.append(P.box_obj(kt, f"{pre}_Thigh_Flange_{nm}", (0.06, 0.03, fh + 0.1),
                             Mt @ U.T(y=yy, z=-(0.22 + (fh + 0.1) / 2)), "titanium", bevel=0.006))

    out.append(P.box_obj(ks, f"{pre}_Shin_Hub", (0.30, 0.34, 0.22), Ms @ U.T(z=-0.19), bevel=0.03))
    rail_top, rail_bot = -0.28, -(Ls - 0.28)
    rl = rail_top - rail_bot
    for xx, nm in ((0.13, "Outer"), (-0.13, "Inner")):
        out.append(P.make(f"{pre}_Shin_Rail_{nm}", coll, kit.m("steel_dark"),
                          lambda bm: P.bm_prism(bm, P.poly_chamfer_rect(0.06, 0.22, 0.015), rl, bevel=0.006),
                          Ms @ U.T(x=s * xx, z=(rail_top + rail_bot) / 2), bn["shin"]))
    out.append(P.box_obj(ks, f"{pre}_Shin_Spine", (0.12, 0.12, rl), Ms @ U.T(y=0.02, z=(rail_top + rail_bot) / 2),
                         "titanium", bevel=0.012))
    for i, zz in enumerate((-0.42, -0.60)):
        out.append(P.box_obj(ks, f"{pre}_Shin_CrossPlate_{i}", (0.32, 0.20, 0.025), Ms @ U.T(z=zz), bevel=0.006))
    out.append(P.box_obj(ks, f"{pre}_Shin_AnkleYoke", (0.43, 0.26, 0.14), Ms @ U.T(z=-(Ls - 0.22)), bevel=0.025))

    out.append(P.box_obj(kf, f"{pre}_Foot_HeelHousing", (0.30, 0.34, 0.20), Mf @ U.T(y=0.02, z=-0.17), bevel=0.03))
    foot_outline = [(-0.26, -0.33), (0.26, -0.33), (0.28, -0.20), (0.28, 0.25), (0.20, 0.40),
                    (-0.20, 0.40), (-0.28, 0.25), (-0.28, -0.20)]
    out.append(P.make(f"{pre}_Foot_Base", coll, kit.m("steel_dark"),
                      lambda bm: P.bm_prism(bm, foot_outline, 0.12, bevel=0.018, segs=2),
                      Mf @ U.T(z=-0.325), bn["foot"]))
    sole = P.make(f"{pre}_Foot_SolePads", coll, kit.m("rubber"),
                  lambda bm: P.bm_box(bm, 0.48, 0.095, 0.035, bevel=0.008),
                  Mf @ U.T(y=-0.30, z=-0.42 + 0.0175), bn["foot"], wn=False)
    arr = sole.modifiers.new("Array", "ARRAY")
    arr.count = 7
    arr.use_relative_offset = False
    arr.use_constant_offset = True
    arr.constant_offset_displace = (0, 0.108, 0)
    sole["ground_anchor"] = True
    out.append(sole)
    # split toes
    Tj = SK.head(bn["toe"])
    toe_y0 = Tj.y - A.y
    for i, cx in enumerate((0.125, -0.125)):
        nm = "Outer" if cx * s > 0 else "Inner"
        pts = [(cx - 0.11, toe_y0 - 0.02), (cx + 0.11, toe_y0 - 0.02), (cx + 0.10, toe_y0 - 0.28),
               (cx + 0.055, toe_y0 - 0.36), (cx - 0.055, toe_y0 - 0.36), (cx - 0.10, toe_y0 - 0.28)]
        out.append(P.make(f"{pre}_Toe_{nm}", coll, kit.m("steel_dark"),
                          lambda bm, pts=pts: P.bm_prism(bm, pts, 0.09, bevel=0.014),
                          Mf @ U.T(z=-0.34),
                          bn["toe"]))
        pad = P.make(f"{pre}_Toe_{nm}_Pad", coll, kit.m("rubber"),
                     lambda bm, pts=pts: P.bm_prism(bm, pts, 0.035, bevel=0.008),
                     Mf @ U.T(z=-0.42 + 0.0175), bn["toe"], wn=False)
        pad["ground_anchor"] = True
        out.append(pad)
    out.append(P.box_obj(kf, f"{pre}_Foot_HeelSpur", (0.30, 0.14, 0.12), Mf @ U.T(y=0.44, z=-0.34), bevel=0.025))
    hb = P.box_obj(kf, f"{pre}_Foot_HeelBumper", (0.32, 0.05, 0.10), Mf @ U.T(y=0.525, z=-0.35), "rubber", bevel=0.015)
    out.append(hb)

    if ms < 3:
        return out

    # ===================================================================== M3 joints + hydraulics
    # hip: drum on the thigh, yoke + bridge on the pelvis
    out += P.joint_drum(kt, f"{pre}_Hip", U.T(*H), 0.16, 0.20, teeth=32)
    out += P.hinge(kp, f"{pre}_HipYoke", U.T(*H) @ U.R(180, "Y"), gap=0.35, r_pin=0.05, plate_h=0.30,
                   plate_d=0.38, plate_t=0.04)
    out.append(P.box_obj(kp, f"{pre}_HipYoke_Bridge", (0.43, 0.34, 0.12), U.T(*H) @ U.T(z=0.27), bevel=0.025))
    # knee
    out += P.hinge(kt, f"{pre}_KneeLugs", Mt @ U.T(z=-Lt), gap=0.365, r_pin=0.045, plate_h=0.33, plate_d=0.30,
                   plate_t=0.035)
    out += P.joint_drum(ks, f"{pre}_Knee", Ms, 0.13, 0.22, teeth=28)
    # ankle
    out += P.hinge(ks, f"{pre}_AnkleLugs", Ms @ U.T(z=-Ls), gap=0.36, r_pin=0.04, plate_h=0.30, plate_d=0.26,
                   plate_t=0.035)
    out += P.joint_drum(kf, f"{pre}_Ankle", Mf, 0.10, 0.20, teeth=24)
    # toe knuckles
    tz = Tj.z - A.z
    for i, (cx, w, kk) in enumerate(((0.0, 0.08, kf), (0.235, 0.06, kf), (-0.235, 0.06, kf),
                                     (0.12, 0.15, ko), (-0.12, 0.15, ko))):
        out.append(P.make(f"{pre}_Toe_Knuckle_{i}", coll, kit.m("titanium" if kk is ko else "steel_dark"),
                          lambda bm, w=w: P.bm_cyl(bm, 0.062, w, U.R(90, "Y"), segs=24, bevel=0.008),
                          Mf @ U.T(x=cx, y=toe_y0, z=tz), kk.bone))
    out.append(P.make(f"{pre}_Toe_HingePin", coll, kit.m("chrome"),
                      lambda bm: P.bm_cyl(bm, 0.025, 0.52, U.R(90, "Y"), segs=16, bevel=0.004),
                      Mf @ U.T(y=toe_y0, z=tz), bn["foot"]))

    # knee front actuator (exposed, runs down the front of the thigh)
    a0, a1 = tp((0, -0.24, -0.25)), sp((0, -0.25, -0.15))
    out.append(P.mount_lug(kt, f"{pre}_KneeAct_MountTop", a0, Vector((1, 0, 0)), r=0.05, w=0.16,
                           base_dir=(Mt.to_3x3() @ Vector((0, 1, 0))), base_len=0.03))
    out.append(P.mount_lug(ks, f"{pre}_KneeAct_MountShin", a1, Vector((1, 0, 0)), r=0.05, w=0.16,
                           base_dir=(Ms.to_3x3() @ Vector((0, 1, 0))), base_len=0.05))
    ka = P.piston(kit, f"{pre}_Knee_Actuator", a0, a1, bn["thigh"], bn["shin"], r_barrel=0.058, coll_rig=rigc)
    out += [ka["cyl"], ka["rod"]]
    # rear knee cylinders (pair)
    for xx, nm in ((0.085, "O"), (-0.085, "I")):
        b0, b1 = tp((s * xx, 0.18, -0.40)), sp((s * xx, 0.20, -0.24))
        out.append(P.mount_lug(kt, f"{pre}_KneeRear{nm}_MountTop", b0, Vector((1, 0, 0)), r=0.035, w=0.07,
                               base_dir=(Mt.to_3x3() @ Vector((0, -1, 0))), base_len=0.03))
        out.append(P.mount_lug(ks, f"{pre}_KneeRear{nm}_MountShin", b1, Vector((1, 0, 0)), r=0.035, w=0.07,
                               base_dir=(Ms.to_3x3() @ Vector((0, -1, 0))), base_len=0.02))
        kr = P.piston(kit, f"{pre}_Knee_Rear{nm}", b0, b1, bn["thigh"], bn["shin"], r_barrel=0.036,
                      barrel_frac=0.5, coll_rig=rigc)
        out += [kr["cyl"], kr["rod"]]
    # hip extension cylinder (pelvis -> back of thigh)
    h0 = H + Vector((s * 0.13, 0.27, 0.22))
    h1 = tp((s * 0.13, 0.20, -0.50))
    out.append(P.mount_lug(kp, f"{pre}_HipAct_MountPelvis", h0, Vector((1, 0, 0)), r=0.045, w=0.09,
                           base_dir=Vector((0, -1, 0.3)), base_len=0.06))
    out.append(P.mount_lug(kt, f"{pre}_HipAct_MountThigh", h1, Vector((1, 0, 0)), r=0.04, w=0.08,
                           base_dir=(Mt.to_3x3() @ Vector((0, -1, 0))), base_len=0.03))
    hp = P.piston(kit, f"{pre}_Hip_Actuator", h0, h1, "pelvis", bn["thigh"], r_barrel=0.045, coll_rig=rigc)
    out += [hp["cyl"], hp["rod"]]
    # ankle cylinders (pair, behind the shin) driving the heel lever
    out.append(P.box_obj(kf, f"{pre}_Foot_HeelLever", (0.28, 0.20, 0.10), Mf @ U.T(y=0.26, z=-0.19), bevel=0.02))
    for xx, nm in ((0.09, "O"), (-0.09, "I")):
        c0, c1 = sp((s * xx, 0.20, -0.42)), fp((s * xx, 0.32, -0.13))
        out.append(P.mount_lug(ks, f"{pre}_Ankle{nm}_MountShin", c0, Vector((1, 0, 0)), r=0.035, w=0.07,
                               base_dir=(Ms.to_3x3() @ Vector((0, -1, 0))), base_len=0.05))
        out.append(P.mount_lug(kf, f"{pre}_Ankle{nm}_MountHeel", c1, Vector((1, 0, 0)), r=0.035, w=0.07,
                               base_dir=Vector((0, 0, -1)), base_len=0.02))
        ap = P.piston(kit, f"{pre}_Ankle_Actuator{nm}", c0, c1, bn["shin"], bn["foot"], r_barrel=0.04,
                      barrel_frac=0.55, coll_rig=rigc)
        out += [ap["cyl"], ap["rod"]]
    # shock absorbers (coil-over) on both sides of the shin
    for xx, nm in ((0.30, "O"), (-0.30, "I")):
        d0, d1 = sp((s * xx, -0.03, -0.36)), fp((s * xx, -0.05, -0.20))
        out.append(P.beam_obj(ks, f"{pre}_Shock{nm}_Outrigger", sp((s * 0.12, -0.03, -0.36)),
                              sp((s * (abs(xx) + 0.02) * (1 if xx > 0 else -1), -0.03, -0.36)), 0.07, 0.09,
                              bevel=0.012))
        out.append(P.box_obj(kf, f"{pre}_Shock{nm}_FootMount", (0.12, 0.12, 0.10),
                             Mf @ U.T(x=s * xx * 0.93, y=-0.05, z=-0.23), bevel=0.015))
        sh = P.coilover(kit, f"{pre}_Shock{nm}", d0, d1, bn["shin"], bn["foot"], r_spring=0.05, coll_rig=rigc)
        out += [sh["cyl"], sh["rod"], sh["spring"]]
    # toe actuator
    e0, e1 = fp((0, -0.17, -0.16)), fp((0, toe_y0 - 0.16, -0.255))
    out.append(P.box_obj(kf, f"{pre}_ToeAct_Mount", (0.10, 0.06, 0.12), Mf @ U.T(y=-0.15, z=-0.17), bevel=0.012))
    out.append(P.box_obj(ko, f"{pre}_Toe_Crossbar", (0.42, 0.07, 0.05), Mf @ U.T(y=toe_y0 - 0.16, z=-0.27),
                         "titanium", bevel=0.012))
    tpis = P.piston(kit, f"{pre}_Toe_Actuator", e0, e1, bn["foot"], bn["toe"], r_barrel=0.028, coll_rig=rigc)
    out += [tpis["cyl"], tpis["rod"]]

    if ms < 4:
        return out

    # ===================================================================== M4 armor + mechanics
    out += _leg_armor(kit, pre, s, bn, Mt, Lt, Ms, Ls, Mf, toe_y0, ms)
    if ms < 5:
        return out
    out += _leg_details(kit, pre, s, bn, Mt, Lt, Ms, Ls, Mf, toe_y0)
    if ms >= 9:
        _leg_m9(kit, pre)
    return out


def _leg_m9(kit, pre):
    """Milestone-9 refinements: GN anti-slip tread on the instep, rounded (SubSurf) rubber,
    GN rivet rows on the shin rails."""
    c = kit.coll.objects
    P.gn_tread(kit, c[f"{pre}_Foot_Armor_Instep"], 0.38, 0.18, 0.034, 0.035)
    for nm in (f"{pre}_Foot_SolePads", f"{pre}_Foot_HeelBumper", f"{pre}_Toe_Outer_Pad", f"{pre}_Toe_Inner_Pad"):
        P.add_subsurf(c[nm], 1, 2)
    for nm in (f"{pre}_Shin_Rail_Outer", f"{pre}_Shin_Rail_Inner"):
        P.gn_rivet_row(kit, c[nm], (0.0, -0.112, 0.20), (0.0, -0.112, -0.20), 6, 0.007, (1.5708, 0, 0))


def _leg_armor(kit, pre, s, bn, Mt, Lt, Ms, Ls, Mf, toe_y0, ms):
    kt, ks, kf, ko = (kit.at(bn[k]) for k in ("thigh", "shin", "foot", "toe"))
    out = []
    so = P.side_orient(s)
    si = P.side_orient(-s)
    # thigh outer plates (layered), wrapped around the leg
    pts = P.outline_side(P.poly_chamfer_rect(0.40, 0.48, (0.03, 0.12, 0.08, 0.03), cx=-0.03), s)
    out.append(P.armor_plate(kt, f"{pre}_Thigh_Armor_Outer", pts, 0.035, Mt @ U.T(x=s * 0.237, z=-0.42) @ so,
                             cuts_x=(-0.15, -0.07, 0.0, 0.07, 0.15), bend=("Y", 0.36)))
    up = P.outline_side(P.poly_chamfer_rect(0.27, 0.17, (0.02, 0.06, 0.02, 0.02), cx=-0.05), s)
    upper = P.armor_plate(kt, f"{pre}_Thigh_Armor_OuterUpper", up, 0.03,
                          Mt @ U.T(x=s * 0.272, z=-0.30) @ so, cuts_x=(-0.1, 0.0, 0.1), bend=("Y", 0.40))
    out.append(upper)
    # vent slots cut with a validated boolean (falls back to a separate louvre vent)
    cutters = []
    for i in range(4):
        c = P.make(f"{pre}_Thigh_VentCutter_{i}", kit.coll, kit.m("steel_dark"),
                   lambda bm: P.bm_box(bm, 0.12, 0.018, 0.2, bevel=0.004),
                   Mt @ U.T(x=s * 0.29, y=-0.06, z=-0.26 - 0.026 * i) @ so, None, wn=False)
        cutters.append(c)

    def _fallback(ob, kit=kt):
        out.extend(P.vent(kit, f"{pre}_Thigh_Vent", Mt @ U.T(x=s * 0.305, y=-0.06, z=-0.30) @ so, 0.14, 0.12, 4))
    if U.boolean_cut(upper, cutters, f"{pre}_thigh_vent", fallback=_fallback):
        out.append(P.box_obj(kt, f"{pre}_Thigh_VentBacker", (0.13, 0.11, 0.006), Mt @ U.T(x=s * 0.2685, y=-0.06, z=-0.30) @ so,
                             "rubber", bevel=0.002, wn=False))
    pin = P.outline_side(P.poly_chamfer_rect(0.30, 0.40, (0.03, 0.05, 0.05, 0.03), cx=-0.03), -s)
    out.append(P.armor_plate(kt, f"{pre}_Thigh_Armor_Inner", pin, 0.03, Mt @ U.T(x=-s * 0.237, z=-0.42) @ si,
                             mats=("armor_dark",), cuts_x=(-0.1, 0.0, 0.1), bend=("Y", 0.34)))
    # quad guards either side of the exposed knee actuator
    for xx, nm in ((0.105, "O"), (-0.105, "I")):
        g = P.poly_chamfer_rect(0.09, 0.36, (0.0, 0.0, 0.03, 0.03))
        out.append(P.armor_plate(kt, f"{pre}_Thigh_Armor_Front{nm}", g, 0.03,
                                 Mt @ U.T(x=s * xx, y=-0.135, z=-0.47) @ P.ORIENT["-Y"] @ U.R(-8 * s * (1 if xx > 0 else -1), "Y")))
    # front-outer shields wrapping the corner beside the exposed actuator
    for xx, nm, sgn in ((0.19, "FrontOuterShield", 1), (-0.19, "FrontInnerShield", -1)):
        g = P.poly_chamfer_rect(0.16, 0.42, (0.0, 0.03, 0.06, 0.02))
        out.append(P.armor_plate(kt, f"{pre}_Thigh_Armor_{nm}", g if s * sgn > 0 else P.flip_outline_x(g), 0.035,
                                 Mt @ U.T(x=s * xx, y=-0.16, z=-0.43) @ U.R(32 * s * sgn, "Z") @ P.ORIENT["-Y"],
                                 mats=("armor" if sgn > 0 else "armor_dark",), cuts_x=(-0.04, 0.04),
                                 bend=("Y", 0.4)))
    # knee side discs
    for xx, nm, kk in ((0.235, "O", ks), (-0.235, "I", ks)):
        mm = Ms @ U.T(x=s * xx) @ (so if xx > 0 else si)
        out.append(P.make(f"{pre}_Knee_Guard{nm}", kit.coll, kit.m("armor" if xx > 0 else "armor_dark"),
                          lambda bm: P.bm_lathe(bm, [(0, 0.035), (0.10, 0.035), (0.15, 0.02), (0.165, 0.0),
                                                     (0.0, 0.0)], segs=40),
                          mm, bn["shin"]))
        out.append(P.make(f"{pre}_Knee_GuardHub{nm}", kit.coll, kit.m("titanium"),
                          lambda bm: P.bm_cyl(bm, 0.05, 0.03, U.T(z=0.045), segs=24, bevel=0.006),
                          mm, bn["shin"]))
    # shin guard (front), layered
    g = P.poly_chamfer_rect(0.36, 0.44, (0.03, 0.03, 0.09, 0.09))
    out.append(P.armor_plate(ks, f"{pre}_Shin_Armor_Front", g, 0.04, Ms @ U.T(y=-0.16, z=-0.52) @ P.ORIENT["-Y"],
                             cuts_x=(-0.12, -0.04, 0.04, 0.12), bend=("Y", 0.30)))
    g2 = P.poly_chamfer_rect(0.26, 0.16, (0.0, 0.0, 0.06, 0.06))
    out.append(P.armor_plate(ks, f"{pre}_Shin_Armor_FrontUpper", g2, 0.03, Ms @ U.T(y=-0.205, z=-0.38) @ P.ORIENT["-Y"],
                             mats=("armor_dark",), cuts_x=(-0.08, 0.0, 0.08), bend=("Y", 0.30)))
    # shin side plates
    for xx, nm in ((0.165, "O"), (-0.165, "I")):
        sd = P.outline_side(P.poly_chamfer_rect(0.26, 0.30, (0.03, 0.03, 0.06, 0.03), cx=0.0), s if xx > 0 else -s)
        out.append(P.armor_plate(ks, f"{pre}_Shin_Armor_Side{nm}", sd, 0.03,
                                 Ms @ U.T(x=s * xx, z=-0.50) @ (so if xx > 0 else si),
                                 mats=("armor" if xx > 0 else "armor_dark",)))
    # calf: carbon-fibre cover over the spine between the rear cylinders
    out.append(P.armor_plate(ks, f"{pre}_Shin_Armor_Calf", P.poly_chamfer_rect(0.09, 0.34, 0.02), 0.02,
                             Ms @ U.T(y=0.085, z=-0.55) @ P.ORIENT["+Y"], mats=("carbon",), bevel=0.006))
    # foot armour: instep, toe caps, heel
    ins = P.poly_chamfer_rect(0.46, 0.26, (0.05, 0.05, 0.02, 0.02))
    out.append(P.armor_plate(kf, f"{pre}_Foot_Armor_Instep", ins, 0.035,
                             Mf @ U.T(y=-0.20, z=-0.255) @ U.R(-12, "X"), cuts_y=(-0.06, 0.06), bend=("X", 0.6)))
    for cx in (0.125, -0.125):
        nm = "Outer" if cx * s > 0 else "Inner"
        tc = [(cx - 0.10, toe_y0 - 0.06), (cx + 0.10, toe_y0 - 0.06), (cx + 0.09, toe_y0 - 0.27),
              (cx + 0.05, toe_y0 - 0.33), (cx - 0.05, toe_y0 - 0.33), (cx - 0.09, toe_y0 - 0.27)]
        out.append(P.armor_plate(ko, f"{pre}_Toe_{nm}_Cap", tc, 0.025, Mf @ U.T(z=-0.295),
                                 mats=("armor",), bevel=0.008))
    heel = P.poly_chamfer_rect(0.34, 0.16, (0.02, 0.02, 0.05, 0.05))
    out.append(P.armor_plate(kf, f"{pre}_Foot_Armor_Heel", heel, 0.03, Mf @ U.T(y=0.20, z=-0.15) @ P.ORIENT["+Y"],
                             mats=("armor_dark",)))
    for xx, nm in ((0.285, "O"), (-0.285, "I")):
        fs = P.outline_side(P.poly_chamfer_rect(0.50, 0.09, (0.03, 0.03, 0.0, 0.0), cx=0.0), s if xx > 0 else -s)
        out.append(P.armor_plate(kf, f"{pre}_Foot_Armor_Side{nm}", fs, 0.02,
                                 Mf @ U.T(x=s * xx, y=0.0, z=-0.33) @ (so if xx > 0 else si), mats=("armor_dark",),
                                 bevel=0.006))
    # hip actuator housing cover (pelvis side) and exposed spur gear train on the hip
    kp = kit.at("pelvis")
    H = SK.head(bn["thigh"])
    out.append(P.make(f"{pre}_Hip_GearTrain", kit.coll, kit.m("titanium"),
                      lambda bm: (P.bm_gear(bm, 0.07, 14, 0.03, U.T(z=0.0)),
                                  P.bm_cyl(bm, 0.02, 0.06, segs=12)),
                      U.T(*H) @ U.T(x=s * 0.235, y=-0.12, z=0.17) @ U.R(90, "Y"), "pelvis"))
    out.append(P.box_obj(kp, f"{pre}_Hip_MotorHousing", (0.12, 0.16, 0.16), U.T(*H) @ U.T(x=s * 0.17, y=-0.12, z=0.24),
                         bevel=0.02))
    return out


def _leg_details(kit, pre, s, bn, Mt, Lt, Ms, Ls, Mf, toe_y0):
    kt, ks, kf, ko = (kit.at(bn[k]) for k in ("thigh", "shin", "foot", "toe"))
    out = []
    xo = Vector((s, 0, 0))
    # fasteners on the thigh plates
    for i, zz in enumerate((-0.44, -0.61)):
        for j, yy in enumerate((-0.18, 0.11)):
            out.append(P.bolt(kt, f"{pre}_Thigh_Armor_Outer_Bolt_{i}{j}",
                              Mt @ U.frame(Vector((s * 0.268, yy, zz)), xo), 0.011))
    out += P.bolt_line(kt, f"{pre}_Thigh_Armor_OuterUpper", Mt @ Vector((s * 0.300, -0.15, -0.355)),
                       Mt @ Vector((s * 0.300, 0.03, -0.355)), Mt.to_3x3() @ xo, 4, 0.008, "socket")
    out += P.bolt_line(kt, f"{pre}_Thigh_KneeYoke", Mt @ Vector((-0.17, -0.13, -(Lt - 0.25))),
                       Mt @ Vector((0.17, -0.13, -(Lt - 0.25))), Mt.to_3x3() @ Vector((0, -1, 0)), 4, 0.011)
    # shin guard bolts + side bolts
    for zz in (-0.34, -0.70):
        for xx in (-0.13, 0.13):
            out.append(P.bolt(ks, f"{pre}_Shin_Armor_Front_Bolt_{zz}_{xx}",
                              Ms @ U.frame(Vector((xx, -0.195, zz)), Vector((0, -1, 0))), 0.011))
    out += P.bolt_line(ks, f"{pre}_Shin_AnkleYoke", Ms @ Vector((-0.17, -0.13, -(Ls - 0.22))),
                       Ms @ Vector((0.17, -0.13, -(Ls - 0.22))), Ms.to_3x3() @ Vector((0, -1, 0)), 4, 0.011)
    for xx, nm in ((0.165, "O"), (-0.165, "I")):
        sx = s if xx > 0 else -s
        for zz in (-0.38, -0.62):
            out.append(P.bolt(ks, f"{pre}_Shin_Armor_Side{nm}_Bolt_{zz}",
                              Ms @ U.frame(Vector((s * xx + sx * 0.03, 0.08, zz)), Vector((sx, 0, 0))), 0.009, "socket"))
    # foot fasteners
    out += P.bolt_line(kf, f"{pre}_Foot_Armor_Instep", Mf @ Vector((-0.19, -0.30, -0.225)),
                       Mf @ Vector((0.19, -0.30, -0.225)), Vector((0, -0.2, 1)), 4, 0.01)
    out += P.bolt_line(kf, f"{pre}_Foot_Base_Rim", Mf @ Vector((-0.24, 0.30, -0.265)),
                       Mf @ Vector((0.24, 0.30, -0.265)), Vector((0, 0, 1)), 5, 0.012)
    for side_x in (0.28, -0.28):
        out += P.bolt_line(kf, f"{pre}_Foot_Side{'O' if side_x * s > 0 else 'I'}",
                           Mf @ Vector((side_x * 1.0 + (0.022 if side_x > 0 else -0.022), -0.18, -0.33)),
                           Mf @ Vector((side_x * 1.0 + (0.022 if side_x > 0 else -0.022), 0.18, -0.33)),
                           Vector((1 if side_x > 0 else -1, 0, 0)), 4, 0.009, "socket")
    for cx in (0.125, -0.125):
        nm = "Outer" if cx * s > 0 else "Inner"
        out += P.bolt_line(ko, f"{pre}_Toe_{nm}_Cap", Mf @ Vector((cx, toe_y0 - 0.10, -0.27)),
                           Mf @ Vector((cx, toe_y0 - 0.24, -0.27)), Vector((0, 0, 1)), 2, 0.009, "socket")
    # weld seams where the femur meets the hub / yoke and where the rails meet the shin hub
    for zz, nm in ((-0.25, "Top"), (-(Lt - 0.32), "Bottom")):
        pts = [tuple(Mt @ Vector((x, -0.112, zz))) for x in (-0.08, -0.03, 0.03, 0.08)]
        out.append(P.weld_seam(kt, f"{pre}_Thigh_Weld_{nm}", pts))
    for xx in (0.13, -0.13):
        pts = [tuple(Ms @ Vector((s * xx + dx, -0.112, -0.30))) for dx in (-0.03, 0.0, 0.03)]
        out.append(P.weld_seam(ks, f"{pre}_Shin_Weld_{'O' if xx > 0 else 'I'}", pts))
    # hazard stripes on the shin guard upper edge + knee warning label
    hz = P.poly_chamfer_rect(0.22, 0.05, 0.0)
    out.append(P.armor_plate(ks, f"{pre}_Shin_HazardStrip", hz, 0.006,
                             Ms @ U.T(y=-0.236, z=-0.415) @ P.ORIENT["-Y"], mats=("hazard",), bevel=0.0015,
                             cuts_x=(-0.06, 0.0, 0.06), bend=("Y", 0.33)))
    from . import details as D
    out.append(D.label(kt, f"{pre}_Thigh_Label", f"A09-{'L' if s > 0 else 'R'}LG",
                       Mt @ U.T(x=s * 0.272, y=-0.03, z=-0.53) @ P.side_orient(s), 0.045))
    out.append(D.label(ks, f"{pre}_Shin_Label", "HYD 210 BAR",
                       Ms @ U.T(y=-0.24, z=-0.62) @ P.ORIENT["-Y"], 0.03, mat="decal_black"))
    out.append(D.led(ks, f"{pre}_Shin_StatusLED", Ms @ U.T(x=s * 0.11, y=-0.215, z=-0.30) @ P.ORIENT["-Y"],
                     "led_green"))
    return out
