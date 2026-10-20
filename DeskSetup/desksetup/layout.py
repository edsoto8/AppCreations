"""Ergonomic layout solver.

Turns a :class:`SceneConfig` into concrete positions for every component, so the Blender
builders never invent numbers of their own. The solver:

* stacks the desk mat, keyboard and mouse at the front of the desk,
* puts the laptop behind the mat and works out where the top of its open lid ends up,
* raises the monitor until its housing clears the lid and the user's line of sight over the lid
  lands below the visible screen,
* tilts the monitor so the screen faces the user's eyes,
* solves the two-link monitor arm (horizontal lower arm + gas-spring upper arm) between the desk
  clamp and the monitor's VESA head, and
* checks that no two components overlap.

World coordinates, all in millimetres: origin on the floor under the desk centre, +X to the
user's right, +Y away from the user (towards the wall), +Z up.

Pure Python: no Blender import, so it is fully unit tested.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from itertools import combinations

from .config import SceneConfig

Vec = tuple[float, float, float]


class LayoutError(ValueError):
    """The configuration cannot be laid out (e.g. the arm cannot reach the monitor)."""


@dataclass(frozen=True)
class Box:
    """Axis-aligned bounding box in world millimetres."""

    min: Vec
    max: Vec

    @staticmethod
    def from_points(points: Iterable[Vec]) -> Box:
        pts = list(points)
        return Box(
            tuple(min(p[i] for p in pts) for i in range(3)),  # type: ignore[arg-type]
            tuple(max(p[i] for p in pts) for i in range(3)),  # type: ignore[arg-type]
        )

    @staticmethod
    def centered(center: Vec, size: Vec) -> Box:
        return Box(
            tuple(c - s / 2 for c, s in zip(center, size)),  # type: ignore[arg-type]
            tuple(c + s / 2 for c, s in zip(center, size)),  # type: ignore[arg-type]
        )

    def overlap(self, other: Box) -> float:
        """Smallest penetration depth across the three axes (<= 0 means no overlap)."""
        return min(min(self.max[i], other.max[i]) - max(self.min[i], other.min[i]) for i in range(3))


def rotate_x(v: Vec, degrees: float) -> Vec:
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    x, y, z = v
    return (x, y * c - z * s, y * s + z * c)


def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def dist(a: Vec, b: Vec) -> float:
    return math.dist(a, b)


@dataclass
class DeskLayout:
    top_z: float  # top surface
    bottom_z: float  # underside of the slab
    front_y: float
    back_y: float
    half_width: float


@dataclass
class Placement:
    """A component's anchor point (world mm) and yaw about +Z (degrees)."""

    location: Vec
    yaw_deg: float = 0.0


@dataclass
class LaptopLayout:
    base: Placement  # centre of the base's bottom face
    hinge: Vec  # point on the hinge axis, at the base centre-line
    lid_angle_deg: float
    lid_top: Vec  # highest point of the open lid (outer edge)
    lid_rear_y: float


@dataclass
class MonitorLayout:
    face_center: Vec  # centre of the front face of the housing
    tilt_deg: float  # top edge tilted back by this much
    screen_center: Vec  # centre of the active area
    bottom_z: float  # lowest point of the housing
    vesa_center: Vec  # centre of the VESA plate on the rear housing

    def to_world(self, local: Vec) -> Vec:
        """Monitor-local point (X across, +Y into the monitor, Z up, origin = face centre)."""
        return add(self.face_center, rotate_x(local, -self.tilt_deg))


# The gas arm's elbow knuckle sits this far above the lower arm's centre line.
ELBOW_KNUCKLE_RISE = 29.0


@dataclass
class ArmLayout:
    clamp: Vec  # top surface of the clamp plate, on the pole axis
    pole_height: float
    pole_top: Vec  # lower-arm pivot
    elbow: Vec  # elbow swivel axis, at the lower arm's centre line
    elbow_knuckle: Vec  # gas-arm pivot above the elbow
    head: Vec  # swivel axis of the tilt head, at the gas arm's end pivot
    upper_arm_angle_deg: float  # rise of the gas-spring arm above horizontal


@dataclass
class Layout:
    desk: DeskLayout
    mat: Placement  # centre of the mat's bottom face
    keyboard: Placement  # centre of the keyboard's bottom face
    mouse: Placement  # centre of the mouse's bottom face
    laptop: LaptopLayout
    monitor: MonitorLayout
    arm: ArmLayout
    eye: Vec
    wall_y: float
    boxes: dict[str, Box] = field(default_factory=dict)
    report: dict[str, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# Pairs that are meant to touch (resting on each other) and are excluded from overlap checks.
_RESTING_PAIRS = {
    frozenset(("desk_top", "mat")),
    frozenset(("desk_top", "laptop_base")),
    frozenset(("mat", "keyboard")),
    frozenset(("mat", "mouse")),
    frozenset(("desk_top", "arm_clamp")),
    frozenset(("laptop_base", "laptop_lid")),
    frozenset(("monitor", "arm_head")),
}


def solve(cfg: SceneConfig) -> Layout:
    desk = _solve_desk(cfg)
    mat = _solve_mat(cfg, desk)
    keyboard, mouse = _solve_inputs(cfg, mat)
    laptop = _solve_laptop(cfg, desk, mat)
    eye = (0.0, desk.front_y - cfg.ergonomics.eye_from_front_edge_mm, cfg.ergonomics.eye_height_mm)
    monitor = _solve_monitor(cfg, desk, laptop, eye)
    arm = _solve_arm(cfg, desk, monitor)
    layout = Layout(
        desk=desk,
        mat=mat,
        keyboard=keyboard,
        mouse=mouse,
        laptop=laptop,
        monitor=monitor,
        arm=arm,
        eye=eye,
        wall_y=desk.back_y + cfg.room.wall_gap_mm,
    )
    layout.boxes = _bounding_boxes(cfg, layout)
    _check(cfg, layout)
    return layout


def _solve_desk(cfg: SceneConfig) -> DeskLayout:
    d = cfg.desk
    return DeskLayout(
        top_z=d.height_mm,
        bottom_z=d.height_mm - d.top_thickness_mm,
        front_y=-d.depth_mm / 2,
        back_y=d.depth_mm / 2,
        half_width=d.width_mm / 2,
    )


def _solve_mat(cfg: SceneConfig, desk: DeskLayout) -> Placement:
    m = cfg.mat
    return Placement((m.x_mm, desk.front_y + m.front_offset_mm + m.depth_mm / 2, desk.top_z))


def _solve_inputs(cfg: SceneConfig, mat: Placement) -> tuple[Placement, Placement]:
    k, m = cfg.keyboard, cfg.mouse
    top = mat.location[2] + cfg.mat.thickness_mm
    kb = Placement((k.x_mm, mat.location[1] + k.y_offset_mm, top), k.rotation_deg)
    mouse_x = k.x_mm + k.width_mm / 2 + m.gap_from_keyboard_mm + m.width_mm / 2
    mouse = Placement((mouse_x, kb.location[1] + m.y_offset_mm, top), m.rotation_deg)
    return kb, mouse


def laptop_lid_points(cfg: SceneConfig, hinge: Vec) -> list[Vec]:
    """Corners of the open lid's side profile (inner/outer face at the hinge and the top edge)."""
    lp = cfg.laptop
    a = math.radians(lp.lid_angle_deg)
    along = (0.0, -math.cos(a), math.sin(a))  # hinge -> top edge
    outward = (0.0, math.sin(a), math.cos(a))  # display side -> outer aluminium side
    length = lp.depth_mm - 4.0
    pts = []
    for s in (0.0, length):
        for t in (0.0, lp.lid_thickness_mm):
            for x in (-lp.width_mm / 2, lp.width_mm / 2):
                pts.append((hinge[0] + x, hinge[1] + along[1] * s + outward[1] * t, hinge[2] + along[2] * s + outward[2] * t))
    return pts


def _solve_laptop(cfg: SceneConfig, desk: DeskLayout, mat: Placement) -> LaptopLayout:
    lp = cfg.laptop
    front = mat.location[1] + cfg.mat.depth_mm / 2 + lp.gap_behind_mat_mm
    base = Placement((lp.x_mm, front + lp.depth_mm / 2, desk.top_z))
    # The lid's inner face starts flush with the deck, 2 mm in front of the base's rear edge.
    hinge = (lp.x_mm, front + lp.depth_mm - 2.0, desk.top_z + lp.base_thickness_mm)
    pts = laptop_lid_points(cfg, hinge)
    top = max(pts, key=lambda p: (p[2], p[1]))
    return LaptopLayout(
        base=base,
        hinge=hinge,
        lid_angle_deg=lp.lid_angle_deg,
        lid_top=(lp.x_mm, top[1], top[2]),
        lid_rear_y=max(p[1] for p in pts),
    )


def monitor_corners(cfg: SceneConfig) -> list[Vec]:
    """Housing corners in monitor-local space (origin = front face centre, +Y into the monitor)."""
    m = cfg.monitor
    w, h = m.width_mm / 2, m.height_mm / 2
    depth = m.panel_thickness_mm + m.rear_housing_depth_mm
    # The rear housing is smaller than the panel; the panel corners bound it.
    return [(x, y, z) for x in (-w, w) for y in (0.0, m.panel_thickness_mm) for z in (-h, h)] + [
        (x, depth, z) for x in (-w * 0.62, w * 0.62) for z in (-h * 0.56, h * 0.62)
    ]


def screen_center_local(cfg: SceneConfig) -> Vec:
    m = cfg.monitor
    # Active area sits between the top bezel and the thicker chin.
    return (0.0, 0.0, (m.chin_mm - m.bezel_mm) / 2)


def _solve_monitor(cfg: SceneConfig, desk: DeskLayout, laptop: LaptopLayout, eye: Vec) -> MonitorLayout:
    m, erg = cfg.monitor, cfg.ergonomics
    face_y = desk.back_y - m.face_from_back_edge_mm
    corners = monitor_corners(cfg)
    screen_local = screen_center_local(cfg)
    active_bottom_local = (0.0, 0.0, -m.height_mm / 2 + m.chin_mm)

    tilt = m.tilt_deg if m.tilt_deg is not None else 0.0
    center_z = desk.top_z + 400.0
    for _ in range(8):  # height depends on tilt and tilt on height; this converges in a few passes
        rotated = [rotate_x(c, -tilt) for c in corners]
        low = min(p[2] for p in rotated)
        if m.bottom_above_desk_mm is not None:
            center_z = desk.top_z + m.bottom_above_desk_mm - low
        else:
            # 1) physical clearance above the lid
            z_clear = laptop.lid_top[2] + erg.lid_clearance_mm - low
            # 2) the eye's line over the lid must land below the visible screen
            ab = rotate_x(active_bottom_local, -tilt)
            target_y = face_y + ab[1]
            ly, lz = laptop.lid_top[1], laptop.lid_top[2]
            slope = (lz - eye[2]) / (ly - eye[1])
            sight_z = eye[2] + slope * (target_y - eye[1]) + erg.sightline_margin_mm
            z_sight = sight_z - ab[2]
            center_z = max(z_clear, z_sight)
        if m.tilt_deg is not None:
            break
        sc = add((m.x_mm, face_y, center_z), rotate_x(screen_local, -tilt))
        new_tilt = math.degrees(math.atan2(eye[2] - sc[2], sc[1] - eye[1]))
        new_tilt = max(-5.0, min(20.0, new_tilt))
        if abs(new_tilt - tilt) < 1e-6:
            break
        tilt = new_tilt

    face = (m.x_mm, face_y, center_z)
    layout = MonitorLayout(face_center=face, tilt_deg=tilt, screen_center=(0, 0, 0), bottom_z=0, vesa_center=(0, 0, 0))
    layout.screen_center = layout.to_world(screen_local)
    layout.bottom_z = min(layout.to_world(c)[2] for c in corners)
    layout.vesa_center = layout.to_world((0.0, m.panel_thickness_mm + m.rear_housing_depth_mm, 0.0))
    return layout


def _solve_arm(cfg: SceneConfig, desk: DeskLayout, mon: MonitorLayout) -> ArmLayout:
    a = cfg.arm
    clamp_x = a.clamp_x_mm if a.clamp_x_mm is not None else mon.face_center[0]
    clamp = (clamp_x, desk.back_y - 32.0, desk.top_z + 12.0)  # 12 mm clamp plate
    v = mon.vesa_center
    head = (v[0], v[1] + a.head_depth_mm, v[2])
    l1, l2 = a.lower_arm_length_mm, a.upper_arm_length_mm
    dx, dy = head[0] - clamp[0], head[1] - clamp[1]
    d = math.hypot(dx, dy)

    if a.pole_height_mm is None:
        r2 = min(l1, l2 * 0.95)  # isosceles plan triangle: the arm folds neatly behind the monitor
        if d > l1 + r2:
            r2 = min(l2 * 0.95, d - l1 + 1e-6)
        if not abs(l1 - r2) <= d <= l1 + r2:
            raise LayoutError(f"monitor arm cannot reach the monitor: {d:.0f} mm away in plan view")
        rise = math.sqrt(l2**2 - r2**2)
        pole_h = head[2] - rise - clamp[2] - ELBOW_KNUCKLE_RISE
        if pole_h < 60.0:
            raise LayoutError(f"monitor too low for this arm (pole would be {pole_h:.0f} mm); lower the arm lengths")
    else:
        pole_h = a.pole_height_mm
        rise = head[2] - clamp[2] - pole_h - ELBOW_KNUCKLE_RISE
        if abs(rise) >= l2:
            raise LayoutError(f"gas arm ({l2:.0f} mm) cannot rise {rise:.0f} mm")
        r2 = math.sqrt(l2**2 - rise**2)
        if not abs(l1 - r2) <= d <= l1 + r2:
            raise LayoutError(f"monitor arm cannot reach the monitor: {d:.0f} mm away in plan view")

    pole_top = (clamp[0], clamp[1], clamp[2] + pole_h)
    ux, uy = (dx / d, dy / d) if d > 1e-6 else (0.0, -1.0)
    along = (l1**2 - r2**2 + d**2) / (2 * d) if d > 1e-6 else 0.0
    h = math.sqrt(max(l1**2 - along**2, 0.0))
    nx, ny = -uy, ux
    if nx * a.elbow_side < 0 or (nx == 0 and ny * a.elbow_side < 0):
        nx, ny = -nx, -ny
    elbow = (clamp[0] + ux * along + nx * h, clamp[1] + uy * along + ny * h, pole_top[2])
    return ArmLayout(
        clamp=clamp,
        pole_height=pole_h,
        pole_top=pole_top,
        elbow=elbow,
        elbow_knuckle=(elbow[0], elbow[1], elbow[2] + ELBOW_KNUCKLE_RISE),
        head=head,
        upper_arm_angle_deg=math.degrees(math.atan2(rise, r2)),
    )


def _bounding_boxes(cfg: SceneConfig, lay: Layout) -> dict[str, Box]:
    d, m, k, ms, lp = lay.desk, cfg.mat, cfg.keyboard, cfg.mouse, cfg.laptop
    boxes = {
        "desk_top": Box((-d.half_width, d.front_y, d.bottom_z), (d.half_width, d.back_y, d.top_z)),
        "mat": Box.centered(add(lay.mat.location, (0, 0, m.thickness_mm / 2)), (m.width_mm, m.depth_mm, m.thickness_mm)),
        "keyboard": _yawed_box(lay.keyboard, (k.width_mm, k.depth_mm, k.back_height_mm + 7.0)),
        "mouse": _yawed_box(lay.mouse, (ms.width_mm, ms.length_mm, ms.height_mm)),
        "laptop_base": Box.centered(
            add(lay.laptop.base.location, (0, 0, lp.base_thickness_mm / 2)), (lp.width_mm, lp.depth_mm, lp.base_thickness_mm)
        ),
        "laptop_lid": Box.from_points(laptop_lid_points(cfg, lay.laptop.hinge)),
        "monitor": Box.from_points(lay.monitor.to_world(c) for c in monitor_corners(cfg)),
        "arm_clamp": Box.centered(add(lay.arm.clamp, (0, 0, -6.0)), (70.0, 64.0, 12.0)),
        "arm_pole": Box(
            (lay.arm.clamp[0] - cfg.arm.pole_radius_mm, lay.arm.clamp[1] - cfg.arm.pole_radius_mm, lay.arm.clamp[2]),
            (lay.arm.clamp[0] + cfg.arm.pole_radius_mm, lay.arm.clamp[1] + cfg.arm.pole_radius_mm, lay.arm.pole_top[2]),
        ),
        "arm_head": Box.centered(lay.arm.head, (60.0, 2 * cfg.arm.head_depth_mm, 60.0)),
    }
    return boxes


def _yawed_box(p: Placement, size: Vec) -> Box:
    a = math.radians(p.yaw_deg)
    c, s = abs(math.cos(a)), abs(math.sin(a))
    w = size[0] * c + size[1] * s
    dpt = size[0] * s + size[1] * c
    x, y, z = p.location
    return Box((x - w / 2, y - dpt / 2, z), (x + w / 2, y + dpt / 2, z + size[2]))


def overlaps(layout: Layout, tolerance_mm: float = 0.5) -> list[tuple[str, str, float]]:
    """Pairs of components whose bounding boxes intersect by more than ``tolerance_mm``."""
    found = []
    for (a, ba), (b, bb) in combinations(layout.boxes.items(), 2):
        if frozenset((a, b)) in _RESTING_PAIRS:
            continue
        depth = ba.overlap(bb)
        if depth > tolerance_mm:
            found.append((a, b, depth))
    return found


def _check(cfg: SceneConfig, lay: Layout) -> None:
    hits = overlaps(lay)
    if hits:
        desc = ", ".join(f"{a}/{b} ({depth:.1f} mm)" for a, b, depth in hits)
        raise LayoutError(f"components overlap: {desc}")

    d, mon = lay.desk, lay.monitor
    mat_box, mouse_box = lay.boxes["mat"], lay.boxes["mouse"]
    if mouse_box.max[0] > mat_box.max[0] or mouse_box.min[0] < mat_box.min[0]:
        lay.warnings.append("mouse hangs off the desk mat; widen the mat or move the keyboard")
    for name, box in lay.boxes.items():
        if name == "arm_clamp":
            continue
        if box.min[0] < -d.half_width - 1 or box.max[0] > d.half_width + 1 or box.min[1] < d.front_y - 1:
            lay.warnings.append(f"{name} extends past the desk")
    if lay.arm.elbow[1] + 30 > lay.wall_y:
        lay.warnings.append("monitor arm elbow would touch the wall; increase room.wall_gap_mm")

    m = cfg.monitor
    screen_top = mon.to_world((0, 0, m.height_mm / 2 - m.bezel_mm))
    view_dist = dist(lay.eye, mon.screen_center)
    gaze = math.degrees(math.atan2(lay.eye[2] - mon.screen_center[2], mon.screen_center[1] - lay.eye[1]))
    lay.report = {
        "viewing_distance_mm": round(view_dist, 1),
        "gaze_down_to_screen_center_deg": round(gaze, 1),
        "screen_top_above_eye_mm": round(screen_top[2] - lay.eye[2], 1),
        "monitor_tilt_deg": round(mon.tilt_deg, 1),
        "monitor_bottom_above_desk_mm": round(mon.bottom_z - d.top_z, 1),
        "lid_top_above_desk_mm": round(lay.laptop.lid_top[2] - d.top_z, 1),
        "lid_to_monitor_clearance_mm": round(mon.bottom_z - lay.laptop.lid_top[2], 1),
        "keyboard_from_desk_edge_mm": round(lay.boxes["keyboard"].min[1] - d.front_y, 1),
        "arm_pole_height_mm": round(lay.arm.pole_height, 1),
        "arm_gas_spring_angle_deg": round(lay.arm.upper_arm_angle_deg, 1),
    }
    if not 500 <= view_dist <= 1000:
        lay.warnings.append(f"viewing distance {view_dist:.0f} mm is outside the 500-1000 mm range")
    if screen_top[2] - lay.eye[2] > 120:
        lay.warnings.append("top of the screen is well above eye level; consider a lower lid angle or a taller chair")
