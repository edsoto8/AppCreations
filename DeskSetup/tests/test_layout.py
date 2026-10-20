import math
from pathlib import Path

import pytest

from desksetup import layout
from desksetup.config import SceneConfig
from desksetup.layout import LayoutError, solve

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


@pytest.fixture(scope="module")
def default():
    return solve(SceneConfig())


def test_default_layout_has_no_overlaps_or_warnings(default):
    assert layout.overlaps(default) == []
    assert default.warnings == []


def test_monitor_housing_clears_the_open_lid(default):
    cfg = SceneConfig()
    gap = default.monitor.bottom_z - default.laptop.lid_top[2]
    assert gap >= cfg.ergonomics.lid_clearance_mm - 1e-6


def test_users_line_of_sight_over_the_lid_lands_below_the_visible_screen(default):
    cfg = SceneConfig()
    m = cfg.monitor
    eye, lid = default.eye, default.laptop.lid_top
    active_bottom = default.monitor.to_world((0, 0, -m.height_mm / 2 + m.chin_mm))
    slope = (lid[2] - eye[2]) / (lid[1] - eye[1])
    sight_z = eye[2] + slope * (active_bottom[1] - eye[1])
    assert active_bottom[2] >= sight_z


def test_monitor_and_laptop_are_centred_on_each_other(default):
    assert default.monitor.face_center[0] == pytest.approx(default.laptop.base.location[0])


def test_screen_is_tilted_to_face_the_eyes(default):
    sc, eye = default.monitor.screen_center, default.eye
    elevation = math.degrees(math.atan2(eye[2] - sc[2], sc[1] - eye[1]))
    assert default.monitor.tilt_deg == pytest.approx(elevation, abs=0.05)


def test_ergonomic_report_is_within_office_guidelines(default):
    r = default.report
    assert 500 <= r["viewing_distance_mm"] <= 1000  # roughly an arm's length
    assert 0 <= r["gaze_down_to_screen_center_deg"] <= 20  # screen centre slightly below eye level
    assert 75 <= r["keyboard_from_desk_edge_mm"] <= 150  # room to rest the wrists


def test_arm_links_keep_their_lengths(default):
    cfg = SceneConfig()
    arm = default.arm
    lower = math.dist(arm.pole_top, arm.elbow)
    upper = math.dist(arm.elbow_knuckle, arm.head)
    assert lower == pytest.approx(cfg.arm.lower_arm_length_mm, abs=1e-6)
    assert upper == pytest.approx(cfg.arm.upper_arm_length_mm, abs=1e-6)
    assert arm.pole_top[2] == pytest.approx(arm.elbow[2])  # lower arm is horizontal


def test_arm_is_hidden_behind_the_monitor_in_the_front_view(default):
    cfg = SceneConfig()
    half = cfg.monitor.width_mm / 2
    arm = default.arm
    for point in (arm.elbow, arm.elbow_knuckle, arm.head):
        assert abs(point[0] - default.monitor.face_center[0]) < half
        assert point[2] > default.monitor.bottom_z


def test_explicit_monitor_height_and_tilt_are_respected():
    cfg = SceneConfig.from_dict({"monitor": {"bottom_above_desk_mm": 280, "tilt_deg": 10}})
    lay = solve(cfg)
    assert lay.monitor.bottom_z - lay.desk.top_z == pytest.approx(280)
    assert lay.monitor.tilt_deg == 10


def test_unreachable_monitor_raises():
    cfg = SceneConfig.from_dict({"arm": {"pole_height_mm": 60}})
    with pytest.raises(LayoutError, match="cannot"):
        solve(cfg)


def test_overlapping_components_raise():
    cfg = SceneConfig.from_dict({"laptop": {"gap_behind_mat_mm": -150}})
    with pytest.raises(LayoutError, match="overlap"):
        solve(cfg)


def test_mouse_off_the_mat_is_reported():
    lay = solve(SceneConfig.from_dict({"mat": {"width_mm": 500}}))
    assert any("mouse" in w for w in lay.warnings)


@pytest.mark.parametrize("width_in,depth_in", [(48, 28), (55, 28), (60, 30), (72, 30), (80, 36)])
def test_common_desk_sizes_solve(width_in, depth_in):
    lay = solve(SceneConfig.from_dict({"desk": {"width_in": width_in, "depth_in": depth_in}}))
    assert layout.overlaps(lay) == []
    assert lay.desk.half_width * 2 == pytest.approx(width_in * 25.4)


def test_too_shallow_desk_is_rejected():
    # 24 in is not deep enough for keyboard, laptop and the arm clamp in a row.
    with pytest.raises(LayoutError, match="laptop_lid/arm_pole"):
        solve(SceneConfig.from_dict({"desk": {"depth_in": 24}}))


@pytest.mark.parametrize("path", sorted(CONFIG_DIR.glob("*.json")), ids=lambda p: p.name)
def test_shipped_configs_solve(path):
    solve(SceneConfig.load(path))
