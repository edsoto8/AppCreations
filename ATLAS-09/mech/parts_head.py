"""Head and sensor assembly: neck turret, pitch hinge, faceted sensor head with brow armor,
lens cluster (main optic, twin auxiliary optics, lidar slit), side camera pods on brackets,
antennas, cooling vents and heat-sink fins, LED status lights, and a rotating lidar dome on
top (``sensor`` bone)."""

import math

from mathutils import Vector

from . import details as D
from . import primitives as P
from . import utils as U

NECK = Vector((0.0, -0.06, 3.44))
PIVOT = Vector((0.0, -0.06, 3.64))       # head pitch hinge
HZ0, HZ1 = 3.66, 3.92                     # head shell vertical extent
FACE_Y = -0.36


def head_warp(co):
    """Taper the shell toward the top and slope the brow back."""
    t = max(0.0, min(1.0, (co.z - HZ0) / (HZ1 - HZ0)))
    co.x *= 1.0 - 0.14 * t
    if co.y < -0.20:
        co.y += 0.09 * max(0.0, (t - 0.6) / 0.4) * (-(co.y + 0.20) / 0.16)
    return co


def build(ctx):
    ms = ctx["milestone"]
    coll = U.sub_coll("Head")
    rigc = U.sub_coll("Rig")
    kit = P.Kit(ctx["mats"], coll)
    kn, kh, ks = kit.at("neck"), kit.at("head"), kit.at("sensor")
    out = []

    # ===================================================================== M2 structure
    out.append(P.make("Head_Neck_Column", coll, kit.m("titanium"),
                      lambda bm: P.bm_lathe(bm, [(0, 0.0), (0.12, 0.0), (0.12, 0.03), (0.09, 0.05), (0.085, 0.14),
                                                 (0.11, 0.16), (0.11, 0.18), (0, 0.18)], segs=36),
                      U.T(*NECK) @ U.T(z=0.02), "neck"))
    shell = [(-0.17, -0.36), (0.17, -0.36), (0.26, -0.22), (0.26, 0.10), (0.18, 0.17), (-0.18, 0.17),
             (-0.26, 0.10), (-0.26, -0.22)]
    hh = HZ1 - HZ0
    out.append(P.make("Head_Shell", coll, kit.m("steel_dark"),
                      lambda bm: P.bm_prism(bm, shell, hh, U.T(z=(HZ0 + HZ1) / 2), cuts_z=(-0.04, 0.05),
                                            warp=None),
                      None, "head", bevel=0.018))
    sh = coll.objects["Head_Shell"]
    _warp_object(sh, head_warp)
    # face bay: recessed dark sensor panel
    face = P.poly_chamfer_rect(0.30, 0.16, (0.03, 0.03, 0.02, 0.02))
    out.append(P.armor_plate(kh, "Head_SensorBay", face, 0.03, U.T(0, FACE_Y + 0.002, 3.735) @ P.ORIENT["-Y"],
                             mats=("carbon",), bevel=0.006))
    out.append(P.box_obj(kh, "Head_Chin", (0.30, 0.20, 0.06), U.T(0, -0.26, HZ0 - 0.005), bevel=0.02))
    if ms < 3:
        return out

    # ===================================================================== M3 joints
    out += P.hinge(kn, "Head_PitchLugs", U.T(*PIVOT) @ U.R(180, "Y"),
                   gap=0.20, r_pin=0.03, plate_h=0.10, plate_d=0.14, plate_t=0.025)
    out += P.joint_drum(kh, "Head_Pitch", U.T(*PIVOT), 0.06, 0.18, teeth=18, grease=False)
    # neck tilt actuator (small cylinder behind the neck)
    p0, p1 = NECK + Vector((0, 0.13, 0.05)), PIVOT + Vector((0, 0.17, 0.06))
    out.append(P.mount_lug(kn, "Head_TiltAct_MountNeck", p0, Vector((1, 0, 0)), r=0.025, w=0.05,
                           base_dir=Vector((0, -1, 0)), base_len=0.04))
    out.append(P.mount_lug(kh, "Head_TiltAct_MountHead", p1, Vector((1, 0, 0)), r=0.025, w=0.05,
                           base_dir=Vector((0, -1, 0.2)), base_len=0.0))
    tp = P.piston(kit, "Head_Tilt_Actuator", p0, p1, "neck", "head", r_barrel=0.022, coll_rig=rigc)
    out += [tp["cyl"], tp["rod"]]
    # lidar turntable
    out += P.bearing(kh, "Head_Lidar", U.T(0, 0.02, HZ1 + 0.005), 0.10, 0.06, 0.02, bolts=8, bolt_size=0.006)
    if ms < 4:
        return out

    # ===================================================================== M4 armor + sensor hardware
    # brow armor (yellow) across the sloped front-top, cheek plates, top plate
    brow = P.poly_chamfer_rect(0.46, 0.14, (0.04, 0.04, 0.05, 0.05))
    out.append(P.armor_plate(kh, "Head_Armor_Brow", brow, 0.03,
                             U.T(0, -0.315, 3.868) @ U.R(-41, "X") @ P.ORIENT["-Y"], cuts_x=(-0.12, 0.0, 0.12),
                             bend=("Y", 0.5)))
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        ck = P.outline_side(P.poly_chamfer_rect(0.30, 0.20, (0.07, 0.02, 0.02, 0.05), cx=-0.03), s)
        out.append(P.armor_plate(kh, f"Head_Armor_Cheek_{sd}", ck, 0.025,
                                 U.T(s * 0.243, -0.08, 3.78) @ P.side_orient(s), bevel=0.008))
        # side camera pods on brackets
        pod_m = U.T(s * 0.355, -0.14, 3.80)
        out.append(P.box_obj(kh, f"Head_CamPod_{sd}_Bracket", (0.10, 0.06, 0.05),
                             U.T(s * 0.305, -0.10, 3.80), bevel=0.012))
        out += _camera_pod(kh, f"Head_CamPod_{sd}", pod_m, 0.045, 0.20)
        out += P.vent(kh, f"Head_Side_{sd}", U.T(s * 0.268, 0.05, 3.74) @ P.side_orient(s), 0.10, 0.10, 4,
                      depth=0.025)
    out.append(P.armor_plate(kh, "Head_Armor_Top", P.poly_chamfer_rect(0.34, 0.26, 0.05), 0.02,
                             U.T(0, 0.0, HZ1 - 0.004), mats=("armor_dark",), bevel=0.006))
    out.append(P.fin_stack(kh, "Head_Rear_HeatSink", U.T(0, 0.165, 3.79) @ P.ORIENT["+Y"], 0.26, 0.16, 0.035, 14, 0.02))
    # lens cluster
    fm = U.T(0, FACE_Y - 0.02, 3.735) @ P.ORIENT["-Y"]
    out += _lens(kh, "Head_Lens_Main", fm @ U.T(0, 0.005, 0), 0.055, 0.07, emit="emit_blue")
    for s in (1, -1):
        sd = "L" if s > 0 else "R"
        out += _lens(kh, f"Head_Lens_Aux_{sd}", fm @ U.T(s * 0.10, -0.03, 0), 0.028, 0.045, emit="emit_amber")
    out.append(P.make("Head_LidarSlit", coll, kit.m("steel_dark", "led_red"),
                      lambda bm: (P.bm_box(bm, 0.24, 0.022, 0.02, U.T(z=0.01), bevel=0.004, mat=0),
                                  P.bm_box(bm, 0.21, 0.008, 0.008, U.T(z=0.02), mat=1)),
                      fm @ U.T(0, 0.058, 0), "head", wn=False))
    # rotating lidar dome (sensor bone)
    out.append(P.make("Head_Lidar_Drum", coll, kit.m("steel_dark", "lens_inner"),
                      lambda bm: (P.bm_lathe(bm, [(0, 0), (0.085, 0), (0.085, 0.02), (0.075, 0.03), (0.075, 0.075),
                                                  (0.085, 0.085), (0.085, 0.10), (0.06, 0.115), (0, 0.118)], segs=40),
                                  P.bm_prism(bm, P.annular_sector(0.074, 0.079, math.radians(-50), math.radians(50)),
                                             0.04, U.T(z=0.0525), mat=1)),
                      U.T(0, 0.02, HZ1 + 0.015), "sensor"))
    out.append(P.make("Head_Lidar_Window", coll, kit.m("glass"),
                      lambda bm: P.bm_tube(bm, 0.0775, 0.0745, 0.035, U.T(z=0.0525), segs=40),
                      U.T(0, 0.02, HZ1 + 0.015), "sensor", wn=False))
    return out + (_head_details(kit) if ms >= 5 else [])


def _warp_object(ob, fn):
    me = ob.data
    for v in me.vertices:
        v.co = fn(v.co.copy())
    me.update()


def _lens(kit, name, m, r, depth, emit="emit_blue"):
    """Optic: stepped housing with hood, dark lens stack, glass element, emissive iris ring.
    Local +Z looks out of the head."""
    hood = P.make(f"{name}_Housing", kit.coll, kit.m("titanium", "steel_dark"),
                  lambda bm: (P.bm_lathe(bm, [(r * 0.9, -depth * 0.5), (r * 1.45, -depth * 0.5), (r * 1.45, 0.0),
                                              (r * 1.3, depth * 0.15), (r * 1.3, depth * 0.55), (r * 1.15, depth * 0.62),
                                              (r * 1.08, depth * 0.62), (r * 1.08, depth * 0.1), (r * 0.9, depth * 0.1)],
                                         segs=40),
                              [P.bm_box(bm, r * 0.5, r * 0.12, depth * 0.3,
                                        U.R(a, "Z") @ U.T(x=r * 1.32, z=depth * 0.35), mat=1) for a in (45, 135, 225, 315)]),
                  m, kit.bone)
    core = P.make(f"{name}_Optic", kit.coll, kit.m("lens_inner", emit),
                  lambda bm: (P.bm_lathe(bm, [(0, -depth * 0.3), (r * 1.0, -depth * 0.3), (r, depth * 0.05),
                                              (r * 0.6, depth * 0.08), (0, depth * 0.09)], segs=32),
                              P.bm_tube(bm, r * 0.75, r * 0.6, 0.004, U.T(z=depth * 0.095), segs=32, mat=1)),
                  m, kit.bone, wn=False)
    glass = P.make(f"{name}_Glass", kit.coll, kit.m("glass"),
                   lambda bm: P.bm_lathe(bm, [(0, depth * 0.17), (r * 1.0, depth * 0.12), (r * 1.0, depth * 0.11),
                                             (0, depth * 0.155)], segs=32),
                   m, kit.bone, wn=False)
    return [hood, core, glass]


def _camera_pod(kit, name, m, r, L):
    """Cylindrical camera housing along -Y with sunshade and rear connector."""
    body = P.make(f"{name}_Body", kit.coll, kit.m("steel_dark", "titanium"),
                  lambda bm: (P.bm_lathe(bm, [(0, L / 2), (r * 0.7, L / 2 + 0.01), (r, L / 2 - 0.01), (r, -L / 2 + 0.02),
                                              (r * 1.12, -L / 2 + 0.01), (r * 1.12, -L / 2 - 0.03), (r * 0.95, -L / 2 - 0.03),
                                              (r * 0.95, -L / 2)],
                                         U.R(90, "X"), segs=32),
                              P.bm_cyl(bm, r * 0.35, 0.03, U.T(0, L / 2 + 0.02, 0) @ U.R(90, "X"), segs=16, mat=1)),
                  m, kit.bone)
    out = [body]
    out += _lens(kit, f"{name}_Lens", m @ U.T(0, -L / 2 - 0.0, 0) @ P.ORIENT["-Y"] @ U.T(z=-0.035), r * 0.6, 0.05,
                 emit="emit_blue")
    return out


def _head_details(kit):
    kh, kn = kit.at("head"), kit.at("neck")
    out = []
    # antennas: whip (with spring base) and blade, GPS puck
    out.append(P.make("Head_Antenna_Whip", kit.coll, kit.m("steel_dark", "rubber"),
                      lambda bm: (P.bm_cyl(bm, 0.018, 0.04, U.T(z=0.02), segs=16, bevel=0.004, mat=0),
                                  P.bm_helix(bm, 0.012, 0.003, 0.05, 6, U.T(z=0.04) @ U.R(-90, "X"), seg_turn=12,
                                             ring=6, mat=0),
                                  P.bm_cyl(bm, 0.006, 0.30, U.T(z=0.24), segs=10, r_top=0.003, mat=1),
                                  P.bm_sphere(bm, 0.008, U.T(z=0.39), segs=10, rings=6, mat=1)),
                      U.T(-0.16, 0.10, 3.915), "head", wn=False))
    out.append(P.make("Head_Antenna_Blade", kit.coll, kit.m("armor_dark"),
                      lambda bm: P.bm_prism(bm, [(-0.04, 0), (0.05, 0), (0.0, 0.16), (-0.03, 0.16)], 0.012, bevel=0.003),
                      U.T(0.16, 0.10, 3.915) @ P.ORIENT["+X"], "head"))
    out.append(P.make("Head_Antenna_GPS", kit.coll, kit.m("decal_white"),
                      lambda bm: P.bm_lathe(bm, [(0, 0), (0.035, 0), (0.035, 0.01), (0.025, 0.02), (0, 0.022)], segs=24),
                      U.T(0.0, -0.12, 3.915), "head"))
    # LED status row on the left cheek
    for i in range(3):
        out.append(D.led(kh, f"Head_StatusLED_{i}", U.T(0.268, -0.15 + 0.03 * i, 3.84) @ P.side_orient(1),
                         ("led_green", "led_green", "led_red")[i], r=0.008))
    out.append(D.led_strip(kh, "Head_Brow_LightBar", U.T(0, -0.39, 3.808) @ P.ORIENT["-Y"], 0.18))
    out.append(D.label(kh, "Head_Label_ID", "A-09", U.T(-0.268, -0.10, 3.84) @ P.side_orient(-1), 0.04,
                       mat="decal_black"))
    for s in (1, -1):
        out += P.bolt_line(kh, f"Head_Armor_Cheek_{'L' if s > 0 else 'R'}", Vector((s * 0.268, -0.20, 3.70)),
                           Vector((s * 0.268, -0.02, 3.70)), Vector((s, 0, 0)), 3, 0.007, "socket")
    out += P.bolt_line(kh, "Head_Armor_Brow", Vector((-0.17, -0.347, 3.843)), Vector((0.17, -0.347, 3.843)),
                       Vector((0, -0.75, 0.66)), 5, 0.008)
    return out
