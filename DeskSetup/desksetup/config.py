"""Scene configuration.

Every tunable number lives here. Field names carry their unit (``_in``, ``_mm``, ``_deg``), and
everything except the desk's headline dimensions is in millimetres. Values left as ``None`` are
solved by :mod:`desksetup.layout` from ergonomic rules.

Configs load from JSON: any subset of fields can be given, nested by section, e.g.::

    {"desk": {"width_in": 72}, "monitor": {"bottom_above_desk_mm": 260}}

This module is pure Python so it can be imported and tested without Blender.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

MM_PER_IN = 25.4


@dataclass
class DeskConfig:
    width_in: float = 60.0
    depth_in: float = 30.0
    height_in: float = 29.0  # floor to the top surface
    top_thickness_in: float = 1.0
    edge_radius_mm: float = 3.0  # eased edge of the slab
    corner_radius_mm: float = 6.0  # plan-view corner radius
    board_width_mm: float = 150.0  # width of the glued-up walnut boards
    leg_inset_x_mm: float = 80.0  # desk end to the outer face of each leg frame
    leg_inset_y_mm: float = 45.0  # front/back edge to the leg frame
    leg_tube_width_mm: float = 25.0  # tube size seen from the front
    leg_tube_depth_mm: float = 50.0  # tube size seen from the side
    leveler_height_mm: float = 10.0
    crossbar: bool = True  # steel stretcher under the back edge

    @property
    def width_mm(self) -> float:
        return self.width_in * MM_PER_IN

    @property
    def depth_mm(self) -> float:
        return self.depth_in * MM_PER_IN

    @property
    def height_mm(self) -> float:
        return self.height_in * MM_PER_IN

    @property
    def top_thickness_mm(self) -> float:
        return self.top_thickness_in * MM_PER_IN


@dataclass
class MonitorConfig:
    diagonal_in: float = 27.0
    aspect_w: float = 16.0
    aspect_h: float = 9.0
    bezel_mm: float = 7.5
    chin_mm: float = 14.0
    corner_radius_mm: float = 5.0
    panel_thickness_mm: float = 10.0
    rear_housing_depth_mm: float = 28.0
    x_mm: float = 0.0
    # Front face of the panel, measured forward from the desk's back edge.
    face_from_back_edge_mm: float = 150.0
    # Bottom edge of the housing above the desk top. None: solved so it clears the laptop.
    bottom_above_desk_mm: float | None = None
    # Backward tilt of the top edge. None: solved so the screen faces the user's eyes.
    tilt_deg: float | None = None

    @property
    def active_width_mm(self) -> float:
        d = self.diagonal_in * MM_PER_IN
        return d * self.aspect_w / (self.aspect_w**2 + self.aspect_h**2) ** 0.5

    @property
    def active_height_mm(self) -> float:
        d = self.diagonal_in * MM_PER_IN
        return d * self.aspect_h / (self.aspect_w**2 + self.aspect_h**2) ** 0.5

    @property
    def width_mm(self) -> float:
        return self.active_width_mm + 2 * self.bezel_mm

    @property
    def height_mm(self) -> float:
        return self.active_height_mm + self.bezel_mm + self.chin_mm


@dataclass
class MonitorArmConfig:
    finish: str = "silver"  # "silver" or "black" anodized aluminium
    clamp_x_mm: float | None = None  # None: centred behind the monitor
    pole_height_mm: float | None = None  # None: solved so the gas arm meets the monitor
    pole_radius_mm: float = 17.0
    lower_arm_length_mm: float = 200.0  # pivot to pivot, swings in the horizontal plane
    upper_arm_length_mm: float = 225.0  # gas-spring arm, pivot to pivot
    elbow_side: int = 1  # +1 elbow folds to the right, -1 to the left
    head_depth_mm: float = 42.0  # VESA plate to the head's swivel axis
    vesa_mm: float = 100.0


@dataclass
class LaptopConfig:
    # 14-inch MacBook Pro proportions.
    width_mm: float = 312.6
    depth_mm: float = 221.2
    base_thickness_mm: float = 10.0
    lid_thickness_mm: float = 5.5
    corner_radius_mm: float = 9.0
    lid_angle_deg: float = 112.0  # between keyboard deck and lid
    display_width_mm: float = 302.4
    display_height_mm: float = 196.5
    finish: str = "silver"  # "silver" or "space_gray"
    x_mm: float = 0.0
    gap_behind_mat_mm: float = 18.0  # base front edge to the back edge of the desk mat


@dataclass
class KeyboardConfig:
    # Logitech MX Keys Mini proportions.
    width_mm: float = 296.0
    depth_mm: float = 132.0
    front_height_mm: float = 8.0  # body only, keycaps sit on top
    back_height_mm: float = 14.0
    key_pitch_mm: float = 18.6
    key_size_mm: float = 16.4
    x_mm: float = -35.0
    y_offset_mm: float = 0.0  # from the centre of the desk mat
    rotation_deg: float = 0.0


@dataclass
class MouseConfig:
    # Logitech MX Master 3S proportions.
    length_mm: float = 124.9
    width_mm: float = 84.3
    height_mm: float = 51.0
    gap_from_keyboard_mm: float = 95.0
    y_offset_mm: float = 12.0  # from the keyboard's centre line
    rotation_deg: float = -6.0  # slight natural yaw


@dataclass
class DeskMatConfig:
    width_mm: float = 800.0
    depth_mm: float = 260.0
    thickness_mm: float = 3.0
    corner_radius_mm: float = 10.0
    x_mm: float = 0.0
    front_offset_mm: float = 25.0  # from the desk's front edge


@dataclass
class CableConfig:
    usb_c_radius_mm: float = 2.1
    power_radius_mm: float = 3.2
    grommet_diameter_mm: float = 60.0
    grommet_x_mm: float = -230.0
    grommet_from_back_edge_mm: float = 110.0
    tray_width_mm: float = 540.0
    tray_depth_mm: float = 120.0
    tray_height_mm: float = 95.0
    tray_x_mm: float = -330.0  # off-centre so it clears the monitor-arm clamp
    outlet_x_mm: float = -705.0  # behind the left leg, so the drop is hidden from the front
    outlet_height_mm: float = 300.0  # above the floor


@dataclass
class RoomConfig:
    wall_gap_mm: float = 110.0  # desk back edge to the wall
    left_wall_x_mm: float = -1700.0  # relative to the desk centre
    right_wall_x_mm: float = 3400.0
    ceiling_height_mm: float = 2750.0
    window_width_mm: float = 1900.0
    window_height_mm: float = 1750.0
    window_sill_mm: float = 650.0
    window_center_y_mm: float = -350.0
    baseboard_height_mm: float = 70.0


@dataclass
class ErgonomicsConfig:
    # Seated eye height above the floor (50th percentile adult on a standard task chair).
    eye_height_mm: float = 1215.0
    # Eyes measured back from the desk's front edge.
    eye_from_front_edge_mm: float = 160.0
    lid_clearance_mm: float = 18.0  # minimum gap between the lid top and the monitor housing
    sightline_margin_mm: float = 12.0  # visible screen starts this far above the eye-to-lid line


@dataclass
class LightingConfig:
    sun_elevation_deg: float = 32.0
    # Direction the sunlight comes from, counter-clockwise from +X: 180 = straight through the
    # left-hand window, 200 = from the left and slightly in front of the desk.
    sun_azimuth_deg: float = 200.0
    sun_strength: float = 3.2
    sun_angle_deg: float = 2.5  # angular diameter; larger = softer shadow edges
    sky_strength: float = 0.55
    fill_strength_w: float = 70.0
    screen_brightness: float = 1.6
    exposure: float = 0.7


@dataclass
class CameraConfig:
    name: str = "front"
    location_mm: tuple[float, float, float] = (0.0, -2600.0, 1250.0)
    target_mm: tuple[float, float, float] = (0.0, 40.0, 960.0)
    lens_mm: float = 70.0
    fstop: float = 8.0


def _default_cameras() -> list[CameraConfig]:
    return [
        CameraConfig("front", (0.0, -2650.0, 1235.0), (0.0, 60.0, 965.0), 62.0, 9.0),
        CameraConfig("side", (2750.0, 30.0, 1120.0), (0.0, 30.0, 870.0), 52.0, 9.0),
        # Straight down (flat lay); the ceiling is hidden from cameras, so it can sit above it.
        CameraConfig("overhead", (0.0, 20.0, 2900.0), (0.0, 20.0, 737.0), 40.0, 11.0),
        CameraConfig("three_quarter", (1850.0, -2150.0, 1400.0), (-60.0, 60.0, 930.0), 58.0, 8.0),
    ]


@dataclass
class RenderConfig:
    resolution_x: int = 2560
    resolution_y: int = 1440
    samples: int = 128  # with OpenImageDenoise this is clean; raise for final client renders
    adaptive_threshold: float = 0.015
    denoise: bool = True
    max_bounces: int = 10
    output_dir: str = "output"
    blend_file: str = "DeskSetup.blend"
    threads: int = 0  # 0 = all cores


@dataclass
class SceneConfig:
    desk: DeskConfig = field(default_factory=DeskConfig)
    monitor: MonitorConfig = field(default_factory=MonitorConfig)
    arm: MonitorArmConfig = field(default_factory=MonitorArmConfig)
    laptop: LaptopConfig = field(default_factory=LaptopConfig)
    keyboard: KeyboardConfig = field(default_factory=KeyboardConfig)
    mouse: MouseConfig = field(default_factory=MouseConfig)
    mat: DeskMatConfig = field(default_factory=DeskMatConfig)
    cables: CableConfig = field(default_factory=CableConfig)
    room: RoomConfig = field(default_factory=RoomConfig)
    ergonomics: ErgonomicsConfig = field(default_factory=ErgonomicsConfig)
    lighting: LightingConfig = field(default_factory=LightingConfig)
    cameras: list[CameraConfig] = field(default_factory=_default_cameras)
    render: RenderConfig = field(default_factory=RenderConfig)

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SceneConfig:
        return _merge(cls(), data)

    @classmethod
    def load(cls, path: str | Path) -> SceneConfig:
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


def _merge(instance: Any, data: dict[str, Any]) -> Any:
    """Return ``instance`` with the fields in ``data`` overridden, recursing into sections."""
    if not isinstance(data, dict):
        raise TypeError(f"expected an object for {type(instance).__name__}, got {data!r}")
    fields = {f.name: f for f in dataclasses.fields(instance)}
    changes: dict[str, Any] = {}
    for key, value in data.items():
        if key.startswith("_"):  # "_comment" keys are allowed in JSON files
            continue
        if key not in fields:
            raise KeyError(f"unknown setting '{key}' in {type(instance).__name__}")
        current = getattr(instance, key)
        if dataclasses.is_dataclass(current):
            changes[key] = _merge(current, value)
        elif key == "cameras":
            changes[key] = _merge_cameras(current, value)
        elif isinstance(current, tuple):
            changes[key] = tuple(float(v) for v in value)
        else:
            changes[key] = value
    return dataclasses.replace(instance, **changes)


def _merge_cameras(current: list[CameraConfig], value: list[dict[str, Any]]) -> list[CameraConfig]:
    """Cameras merge by name: a known name updates that camera, a new name adds one."""
    by_name = {c.name: c for c in current}
    for item in value:
        name = item.get("name")
        if not name:
            raise KeyError("each camera needs a 'name'")
        by_name[name] = _merge(by_name.get(name, CameraConfig(name=name)), item)
    return list(by_name.values())
