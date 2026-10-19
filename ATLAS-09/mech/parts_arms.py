"""Arms: shoulder flange + actuator housing + layered pauldron, two-axis shoulder, hydraulic
elbow (bicep/tricep cylinders), heavy forearm, geared rotating wrist on a quick-coupler, and
either the three-finger gripper (left) or a hydraulic rock drill (right)."""

import math

from mathutils import Vector

from . import details as D
from . import primitives as P
from . import skeleton as SK
from . import utils as U


def build(ctx, side):
    ms = ctx["milestone"]
    s = SK.side_sign(side)
    coll = U.sub_coll(f"Arm_{side}")
    rigc = U.sub_coll("Rig")
    kit = P.Kit(ctx["mats"], coll)
    pre = f"Arm_{side}"
    bn = {k: f"{k}.{side}" for k in ("shoulder", "upperarm", "forearm", "wrist")}
    ksh, ku, kf, kw = (kit.at(bn[k]) for k in ("shoulder", "upperarm", "forearm", "wrist"))
    J = SK.head(bn["upperarm"])                 # shoulder joint (abduction pin along Y)
    Mu, Lu = SK.seg(bn["upperarm"])
    Mf, Lf = SK.seg(bn["forearm"])
    Mw, Lw = SK.seg(bn["wrist"])
    xs = Vector((s, 0, 0))
    out = []

    # ===================================================================== M2 structure
    out.append(P.make(f"{pre}_Shoulder_Flange", coll, kit.m("titanium"),
                      lambda bm: P.bm_lathe(bm, [(0, 0), (0.23, 0), (0.23, 0.03), (0.20, 0.05), (0.17, 0.08),
                                                 (0, 0.08)], segs=48),
                      U.frame(Vector((s * 0.745, 0.06, 3.20)), xs), bn["shoulder"]))
    out.append(P.box_obj(ksh, f"{pre}_Shoulder_Housing", (0.17, 0.34, 0.30), U.T(s * 0.885, 0.06, 3.21), bevel=0.04))
    out.append(P.box_obj(ku, f"{pre}_UpperArm_Hub", (0.22, 0.26, 0.16), Mu @ U.T(z=-0.15), bevel=0.03))
    ch = Lu - 0.20 - 0.24
    out.append(P.make(f"{pre}_UpperArm_Core", coll, kit.m("steel_dark"),
                      lambda bm: P.bm_prism(bm, P.poly_chamfer_rect(0.18, 0.20, 0.04), ch, bevel=0.01),
                      Mu @ U.T(z=-(0.20 + ch / 2)), bn["upperarm"]))
    out.append(P.box_obj(ku, f"{pre}_UpperArm_ElbowYoke", (0.40, 0.24, 0.12), Mu @ U.T(z=-(Lu - 0.23)), bevel=0.025))
    out.append(P.box_obj(kf, f"{pre}_Forearm_Hub", (0.24, 0.28, 0.16), Mf @ U.T(z=-0.15), bevel=0.03))
    fh = 0.34

    def fore(bm):
        P.bm_prism(bm, P.poly_chamfer_rect(0.30, 0.34, 0.06), fh, cuts_z=(-0.1, 0.0, 0.1),
                   warp=lambda c: Vector((c.x * (1 - 0.25 * (0.5 - c.z / fh)), c.y * (1 - 0.18 * (0.5 - c.z / fh)), c.z)),
                   bevel=0.0)
    out.append(P.make(f"{pre}_Forearm_Housing", coll, kit.m("steel_dark"), fore, Mf @ U.T(z=-(0.22 + fh / 2)),
                      bn["forearm"], bevel=0.015))
    out.append(P.make(f"{pre}_Forearm_WristNeck", coll, kit.m("titanium"),
                      lambda bm: P.bm_lathe(bm, [(0, 0.0), (0.12, 0.0), (0.12, -0.02), (0.10, -0.04), (0.10, -0.06),
                                                 (0, -0.06)], segs=40),
                      Mf @ U.T(z=-(0.22 + fh) + 0.005), bn["forearm"]))
    # wrist: rotating collar + quick-coupler plate (both on the wrist bone)
    out.append(P.make(f"{pre}_Wrist_Collar", coll, kit.m("steel_dark"),
                      lambda bm: P.bm_lathe(bm, [(0, 0.0), (0.105, 0.0), (0.11, -0.01), (0.11, -0.07), (0.13, -0.08),
                                                 (0.13, -0.095), (0, -0.095)], segs=40),
                      Mw, bn["wrist"]))
    cp = P.poly_chamfer_rect(0.26, 0.30, 0.04)
    out.append(P.make(f"{pre}_Wrist_Coupler", coll, kit.m("titanium"),
                      lambda bm: P.bm_prism(bm, cp, 0.035, bevel=0.008), Mw @ U.T(z=-0.112), bn["wrist"]))
    if side == "L":
        out += _gripper(kit, pre, ms)
    else:
        out += _drill(kit, pre, ms)
    if ms < 3:
        return out

    # ===================================================================== M3 joints + hydraulics
    # shoulder abduction joint: clevis on the shoulder, drum on the upper arm (pin along Y)
    out += P.hinge(ksh, f"{pre}_ShoulderLugs", U.frame(J, xs, Vector((0, 1, 0))), gap=0.29, r_pin=0.04,
                   plate_h=0.16, plate_d=0.26, plate_t=0.035)
    out += P.joint_drum(ku, f"{pre}_Shoulder", U.T(*J) @ U.R(90, "Z"), 0.10, 0.14, teeth=24)
    # elbow
    out += P.hinge(ku, f"{pre}_ElbowLugs", Mu @ U.T(z=-Lu), gap=0.34, r_pin=0.04, plate_h=0.30, plate_d=0.26,
                   plate_t=0.03)
    out += P.joint_drum(kf, f"{pre}_Elbow", Mf, 0.11, 0.18, teeth=26)
    # wrist bearing + drive pinion and motor
    out += P.bearing(kf, f"{pre}_Wrist", Mf @ U.T(z=-Lf + 0.02), 0.135, 0.085, 0.035, bolts=10, bolt_size=0.008)
    out.append(P.make(f"{pre}_Wrist_RingGear", coll, kit.m("titanium"),
                      lambda bm: P.bm_gear(bm, 0.128, 40, 0.025, tooth=0.012), Mw @ U.T(z=-0.045), bn["wrist"]))
    pin_m = Mf @ U.T(s * 0.0, 0.0, -Lf) @ U.T(0, 0.152, -0.045)
    out.append(P.make(f"{pre}_Wrist_Pinion", coll, kit.m("titanium"),
                      lambda bm: (P.bm_gear(bm, 0.03, 12, 0.025, tooth=0.008), P.bm_cyl(bm, 0.008, 0.05, segs=12)),
                      pin_m, bn["forearm"]))
    out.append(P.make(f"{pre}_Wrist_DriveMotor", coll, kit.m("steel_dark", "titanium"),
                      lambda bm: (P.bm_cyl(bm, 0.035, 0.12, U.T(z=0.08), segs=24, bevel=0.006),
                                  [P.bm_cyl(bm, 0.038, 0.006, U.T(z=0.05 + 0.02 * i), segs=24, mat=1) for i in range(4)]),
                      pin_m, bn["forearm"]))
    # bicep (front) and tricep (rear) cylinders across the elbow
    b0, b1 = Mu @ Vector((0, -0.17, -0.20)), Mf @ Vector((0, -0.19, -0.16))
    out.append(P.mount_lug(ku, f"{pre}_Bicep_MountTop", b0, Vector((1, 0, 0)), r=0.04, w=0.10,
                           base_dir=Mu.to_3x3() @ Vector((0, 1, 0)), base_len=0.04))
    out.append(P.mount_lug(kf, f"{pre}_Bicep_MountForearm", b1, Vector((1, 0, 0)), r=0.04, w=0.10,
                           base_dir=Mf.to_3x3() @ Vector((0, 1, 0)), base_len=0.04))
    bp = P.piston(kit, f"{pre}_Bicep_Actuator", b0, b1, bn["upperarm"], bn["forearm"], r_barrel=0.046,
                  barrel_frac=0.6, rod_frac=0.55, coll_rig=rigc)
    out += [bp["cyl"], bp["rod"]]
    t0, t1 = Mu @ Vector((0, 0.165, -0.22)), Mf @ Vector((0, 0.165, 0.07))
    out.append(P.mount_lug(ku, f"{pre}_Tricep_MountTop", t0, Vector((1, 0, 0)), r=0.035, w=0.08,
                           base_dir=Mu.to_3x3() @ Vector((0, -1, 0)), base_len=0.04))
    out.append(P.make(f"{pre}_Tricep_Lever", coll, kit.m("steel_dark"),
                      lambda bm: P.bm_beam(bm, Vector((0, 0.06, -0.08)), Vector((0, 0.165, 0.07)), 0.07, 0.06,
                                           bevel=0.012), Mf, bn["forearm"]))
    tp = P.piston(kit, f"{pre}_Tricep_Actuator", t0, t1, bn["upperarm"], bn["forearm"], r_barrel=0.04,
                  barrel_frac=0.6, rod_frac=0.6, coll_rig=rigc)
    out += [tp["cyl"], tp["rod"]]
    # shoulder pitch actuator: chest -> shoulder housing (drives the shoulder flange rotation)
    c0 = Vector((s * 0.55, 0.40, 3.02))
    c1 = Vector((s * 0.86, 0.24, 3.10))
    out.append(P.mount_lug(kit.at("chest"), f"{pre}_ShoulderAct_MountChest", c0, Vector((0, 0, 1)), r=0.035, w=0.07,
                           base_dir=Vector((-s, 0, 0)), base_len=0.05))
    out.append(P.mount_lug(ksh, f"{pre}_ShoulderAct_MountHousing", c1, Vector((0, 0, 1)), r=0.035, w=0.07,
                           base_dir=Vector((0, -1, 0)), base_len=0.04))
    sp = P.piston(kit, f"{pre}_Shoulder_Actuator", c0, c1, "chest", bn["shoulder"], r_barrel=0.036,
                  coll_rig=rigc)
    out += [sp["cyl"], sp["rod"]]
    if ms < 4:
        return out

    # ===================================================================== M4 armor
    out += _arm_armor(kit, pre, s, bn, J, Mu, Lu, Mf, Lf)
    if ms < 5:
        return out
    out += _arm_details(kit, pre, s, bn, Mu, Lu, Mf, Lf, Mw)
    return out


def _arm_armor(kit, pre, s, bn, J, Mu, Lu, Mf, Lf):
    ksh, ku, kf = (kit.at(bn[k]) for k in ("shoulder", "upperarm", "forearm"))
    out = []
    so, si = P.side_orient(s), P.side_orient(-s)
    c = Vector((s * 0.93, 0.06, 3.22))
    mpa = U.frame(c, Vector((s, 0, 0)), Vector((0, 0, 1)))
    # pauldron: revolved shell over the shoulder (Solidify), plus a raised top layer
    # faceted (7 flats over 210 degrees) so it reads as bent plate, not a dome
    prof = [(0.27, -0.22), (0.315, -0.15), (0.315, 0.12), (0.25, 0.25), (0.10, 0.30)]
    pa = P.make(f"{pre}_Pauldron", kit.coll, kit.m("armor"),
                lambda bm: P.bm_lathe(bm, prof, segs=7, a0=math.radians(-105), a1=math.radians(105)),
                mpa, bn["shoulder"], wn=False, smooth=20)
    U.add_solidify(pa, 0.035, 0.0)
    U.add_bevel(pa, 0.006, 2, 20)
    U.add_weighted_normal(pa)
    out.append(pa)
    prof2 = [(0.34, -0.11), (0.34, 0.09), (0.28, 0.21)]
    pl = P.make(f"{pre}_Pauldron_TopLayer", kit.coll, kit.m("armor"),
                lambda bm: P.bm_lathe(bm, prof2, segs=3, a0=math.radians(-45), a1=math.radians(45)),
                mpa, bn["shoulder"], wn=False, smooth=20)
    U.add_solidify(pl, 0.025, 0.0)
    U.add_bevel(pl, 0.005, 2, 20)
    U.add_weighted_normal(pl)
    out.append(pl)
    rim = P.make(f"{pre}_Pauldron_RimTrim", kit.coll, kit.m("armor_dark"),
                 lambda bm: P.bm_lathe(bm, [(0.27, -0.235), (0.29, -0.235), (0.29, -0.20), (0.27, -0.20)], segs=7,
                                       a0=math.radians(-105), a1=math.radians(105)),
                 mpa, bn["shoulder"], wn=False, smooth=20)
    U.add_solidify(rim, 0.02, 0.0)
    out.append(rim)
    # upper arm plates
    op = P.outline_side(P.poly_chamfer_rect(0.26, 0.30, (0.03, 0.06, 0.03, 0.03)), s)
    out.append(P.armor_plate(ku, f"{pre}_UpperArm_Armor_Outer", op, 0.03,
                             Mu @ U.T(x=s * 0.205, z=-0.38) @ so, cuts_x=(-0.08, 0.0, 0.08), bend=("Y", 0.3)))
    ip = P.outline_side(P.poly_chamfer_rect(0.22, 0.26, 0.03), -s)
    out.append(P.armor_plate(ku, f"{pre}_UpperArm_Armor_Inner", ip, 0.025,
                             Mu @ U.T(x=-s * 0.205, z=-0.38) @ si, mats=("armor_dark",), cuts_x=(-0.06, 0.06),
                             bend=("Y", 0.3)))
    # forearm: big outer plate (layered), top shield, inner plate, rear ribs
    fo = P.outline_side(P.poly_chamfer_rect(0.36, 0.40, (0.04, 0.04, 0.10, 0.04), cx=0.0), s)
    out.append(P.armor_plate(kf, f"{pre}_Forearm_Armor_Outer", fo, 0.04,
                             Mf @ U.T(x=s * 0.155, z=-0.38) @ so, cuts_x=(-0.12, -0.04, 0.04, 0.12), bend=("Y", 0.34)))
    fo2 = P.outline_side(P.poly_chamfer_rect(0.24, 0.16, (0.02, 0.02, 0.06, 0.02), cx=-0.02), s)
    out.append(P.armor_plate(kf, f"{pre}_Forearm_Armor_OuterLayer", fo2, 0.03,
                             Mf @ U.T(x=s * 0.193, z=-0.33) @ so, mats=("armor_dark",), cuts_x=(-0.06, 0.02),
                             bend=("Y", 0.38)))
    ft = P.poly_chamfer_rect(0.26, 0.34, (0.03, 0.03, 0.06, 0.06))
    out.append(P.armor_plate(kf, f"{pre}_Forearm_Armor_Front", ft, 0.035,
                             Mf @ U.T(y=-0.165, z=-0.40) @ P.ORIENT["-Y"], cuts_x=(-0.08, 0.0, 0.08), bend=("Y", 0.3)))
    fi = P.outline_side(P.poly_chamfer_rect(0.28, 0.30, 0.03), -s)
    out.append(P.armor_plate(kf, f"{pre}_Forearm_Armor_Inner", fi, 0.025,
                             Mf @ U.T(x=-s * 0.14, z=-0.40) @ si, mats=("armor_dark",)))
    for i in range(4):
        out.append(P.box_obj(kf, f"{pre}_Forearm_Rib_{i}", (0.22, 0.03, 0.02),
                             Mf @ U.T(y=0.165, z=-0.27 - 0.07 * i), "titanium", bevel=0.006))
    return out


def _gripper(kit, pre, ms):
    """Three-finger industrial gripper on the left wrist."""
    kw = kit.at("wrist.L")
    out = []
    Mw, _ = SK.seg("wrist.L")
    out.append(P.box_obj(kw, f"{pre}_Gripper_Palm", (0.24, 0.30, 0.11), Mw @ U.T(z=-0.185), bevel=0.025))
    out.append(P.box_obj(kw, f"{pre}_Gripper_PalmPlate", (0.20, 0.24, 0.02), Mw @ U.T(z=-0.245), "rubber", bevel=0.006))
    for f in ("finger_a", "finger_b", "thumb"):
        b = f"{f}.L"
        Mfi, Lfi = SK.seg(b)
        inward = Vector((0, 1, 0)) if f != "thumb" else Vector((0, -1, 0))
        k = kit.at(b)
        iy = inward.y

        def finger(bm, iy=iy):
            # knuckle drum, proximal link, middle joint, distal claw with inward hook
            P.bm_cyl(bm, 0.034, 0.075, U.R(90, "Y"), segs=24, bevel=0.005, mat=0)
            P.bm_prism(bm, P.poly_chamfer_rect(0.06, 0.07, 0.012), 0.12, U.T(z=-0.075), bevel=0.006, mat=0)
            P.bm_cyl(bm, 0.03, 0.07, U.T(z=-0.135) @ U.R(90, "Y"), segs=20, bevel=0.004, mat=1)
            claw = [(-0.034 * iy, 0.0), (0.03 * iy, 0.0), (0.045 * iy, -0.07), (0.035 * iy, -0.11), (-0.005 * iy, -0.10),
                    (-0.03 * iy, -0.06)]
            if iy < 0:
                claw = [(x, y) for x, y in reversed(claw)]
            P.bm_prism(bm, claw, 0.055, U.T(z=-0.135) @ P.M_YZ, bevel=0.006, mat=0)
        out.append(P.make(f"{pre}_Gripper_{f.title().replace('_', '')}", kit.coll, kit.m("steel_dark", "chrome"),
                          finger, Mfi, b))
        out.append(P.make(f"{pre}_Gripper_{f.title().replace('_', '')}_Pads", kit.coll, kit.m("rubber"),
                          lambda bm, iy=iy: (P.bm_box(bm, 0.05, 0.012, 0.09, U.T(y=0.036 * iy, z=-0.075), bevel=0.004),
                                             P.bm_box(bm, 0.045, 0.012, 0.05, U.T(y=0.034 * iy, z=-0.19), bevel=0.004)),
                          Mfi, b, wn=False))
        if ms >= 3:
            # finger actuator: palm -> finger lever
            p0 = Mw @ Vector((SK.head(b).x - SK.head("wrist.L").x, -0.02 * iy, -0.17))
            p1 = Mfi @ Vector((0, -0.045 * iy, -0.06))
            pa = P.piston(kit, f"{pre}_Gripper_{f.title().replace('_', '')}_Actuator", p0, p1, "wrist.L", b,
                          r_barrel=0.014, barrel_frac=0.55, rod_frac=0.55, coll_rig=U.sub_coll("Rig"))
            out += [pa["cyl"], pa["rod"]]
    return out


def _drill(kit, pre, ms):
    """Hydraulic rock drill on the right wrist: motor, gearbox, shroud, chuck and fluted bit."""
    kw, kt = kit.at("wrist.R"), kit.at("tool.R")
    out = []
    Mw, _ = SK.seg("wrist.R")
    Mt, Lt = SK.seg("tool.R")
    out.append(P.make(f"{pre}_Drill_Motor", kit.coll, kit.m("armor", "steel_dark"),
                      lambda bm: (P.bm_lathe(bm, [(0, -0.13), (0.10, -0.13), (0.12, -0.15), (0.12, -0.27),
                                                  (0.095, -0.30), (0, -0.30)], segs=40, mat=0),
                                  [P.bm_cyl(bm, 0.128, 0.012, U.T(z=-0.165 - 0.022 * i), segs=40, mat=1)
                                   for i in range(5)]),
                      Mw, "wrist.R"))
    out.append(P.make(f"{pre}_Drill_Gearbox", kit.coll, kit.m("steel_dark"),
                      lambda bm: P.bm_lathe(bm, [(0, -0.30), (0.09, -0.30), (0.09, -0.34), (0.07, -0.37), (0, -0.37)],
                                            segs=32), Mw, "wrist.R"))
    out.append(P.make(f"{pre}_Drill_Shroud", kit.coll, kit.m("armor_dark"),
                      lambda bm: P.bm_lathe(bm, [(0.085, -0.36), (0.095, -0.44)], segs=24, a0=math.radians(-120),
                                            a1=math.radians(120)), Mw, "wrist.R", wn=False))
    U.add_solidify(kit.coll.objects[f"{pre}_Drill_Shroud"], 0.008, 0.0)
    # chuck + bit on the tool spindle bone (spins)
    out.append(P.make(f"{pre}_Drill_Chuck", kit.coll, kit.m("titanium"),
                      lambda bm: (P.bm_lathe(bm, [(0, 0.0), (0.06, 0.0), (0.06, -0.05), (0.045, -0.08), (0.03, -0.09),
                                                  (0, -0.09)], segs=32),
                                  [P.bm_box(bm, 0.02, 0.012, 0.04, U.R(a, "Z") @ U.T(x=0.058, z=-0.03))
                                   for a in (0, 120, 240)]),
                      Mt @ U.T(z=-0.17), "tool.R"))
    L = 0.36

    def bit(bm):
        prof = [(0.042 * (0.64 + 0.36 * abs(math.cos(a))) * math.cos(a),
                 0.042 * (0.64 + 0.36 * abs(math.cos(a))) * math.sin(a))
                for a in [math.tau * i / 28 for i in range(28)]]

        def twist(c):
            t = (c.z + L / 2) / L            # 0 at the tip, 1 at the shank
            ang = 7.5 * (1 - t) * 2.0
            x, y = c.x, c.y
            r = 1.0 if t > 0.12 else max(0.15, t / 0.12)
            return Vector(((x * math.cos(ang) - y * math.sin(ang)) * r, (x * math.sin(ang) + y * math.cos(ang)) * r, c.z))
        P.bm_prism(bm, prof, L, cuts_z=[-L / 2 + L * i / 24 for i in range(1, 24)], warp=twist)
    out.append(P.make(f"{pre}_Drill_Bit", kit.coll, kit.m("chrome"), bit, Mt @ U.T(z=-0.26 - L / 2), "tool.R",
                      wn=False, smooth=60))
    out.append(P.make(f"{pre}_Drill_Tip", kit.coll, kit.m("copper"),
                      lambda bm: P.bm_cyl(bm, 0.014, 0.05, segs=16, r_top=0.002),
                      Mt @ U.T(z=-0.26 - L - 0.01) @ U.R(180, "X"), "tool.R"))
    out.append(P.make(f"{pre}_Drill_Collar", kit.coll, kit.m("steel_dark"),
                      lambda bm: P.bm_cyl(bm, 0.05, 0.03, segs=24, bevel=0.005), Mt @ U.T(z=-0.255), "tool.R"))
    return out


def _arm_details(kit, pre, s, bn, Mu, Lu, Mf, Lf, Mw):
    ksh, ku, kf, kw = (kit.at(bn[k]) for k in ("shoulder", "upperarm", "forearm", "wrist"))
    out = []
    xs = Vector((s, 0, 0))
    # coupler locking pins + hydraulic quick-connect nipples
    out.append(P.make(f"{pre}_Wrist_CouplerPins", kit.coll, kit.m("chrome", "steel_dark"),
                      lambda bm: [P.bm_cyl(bm, 0.014, 0.34, U.T(x=x, z=-0.112) @ U.R(90, "X"), segs=16, bevel=0.003)
                                  for x in (-0.09, 0.09)],
                      Mw, bn["wrist"]))
    out.append(P.make(f"{pre}_Wrist_QuickConnects", kit.coll, kit.m("titanium", "copper"),
                      lambda bm: [(P.bm_cyl(bm, 0.014, 0.04, U.T(x=x, y=0.11, z=-0.08), segs=6),
                                   P.bm_cyl(bm, 0.009, 0.02, U.T(x=x, y=0.11, z=-0.05), segs=12, mat=1))
                                  for x in (-0.05, 0.05)],
                      Mw, bn["wrist"], wn=False))
    out += P.bolt_line(kf, f"{pre}_Forearm_Armor_Outer", Mf @ Vector((s * 0.195, -0.13, -0.24)),
                       Mf @ Vector((s * 0.195, 0.11, -0.24)), Mf.to_3x3() @ xs, 4, 0.01)
    out += P.bolt_line(kf, f"{pre}_Forearm_Armor_Front", Mf @ Vector((-0.10, -0.20, -0.56)),
                       Mf @ Vector((0.10, -0.20, -0.56)), Mf.to_3x3() @ Vector((0, -1, 0)), 3, 0.009, "socket")
    out += P.bolt_line(ku, f"{pre}_UpperArm_Armor_Outer", Mu @ Vector((s * 0.235, -0.09, -0.26)),
                       Mu @ Vector((s * 0.235, 0.09, -0.26)), Mu.to_3x3() @ xs, 3, 0.009, "socket")
    out += P.bolt_ring(ksh, f"{pre}_Shoulder_Flange", U.frame(Vector((s * 0.825, 0.06, 3.20)), xs), 0.19, 12, 0.01)
    # hazard strip on the forearm front + labels + LED
    out.append(P.armor_plate(kf, f"{pre}_Forearm_HazardStrip", P.poly_chamfer_rect(0.20, 0.05, 0.0), 0.005,
                             Mf @ U.T(y=-0.204, z=-0.27) @ P.ORIENT["-Y"], mats=("hazard",), bevel=0.001,
                             cuts_x=(-0.05, 0.0, 0.05), bend=("Y", 0.33)))
    out.append(D.label(kf, f"{pre}_Forearm_Label", "GRIP 40 kN" if s > 0 else "DRILL 900 Nm",
                       Mf @ U.T(x=s * 0.196, y=0.02, z=-0.47) @ P.side_orient(s), 0.032, mat="decal_black"))
    out.append(D.label(ksh, f"{pre}_Pauldron_Label", "09",
                       U.frame(Vector((s * 1.03, -0.12, 3.47)), Vector((0, -0.55, 1)), Vector((1, 0, 0))), 0.12,
                       mat="decal_black"))
    out.append(D.led(kf, f"{pre}_Forearm_StatusLED", Mf @ U.T(x=s * 0.10, y=-0.20, z=-0.53) @ P.ORIENT["-Y"],
                     "led_green" if s > 0 else "led_red"))
    pts = [tuple(Mu @ Vector((x, -0.105, -0.205))) for x in (-0.07, 0.0, 0.07)]
    out.append(P.weld_seam(ku, f"{pre}_UpperArm_Weld", pts))
    return out
