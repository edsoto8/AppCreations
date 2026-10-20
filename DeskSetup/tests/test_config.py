import json
from pathlib import Path

import pytest

from desksetup.config import MM_PER_IN, SceneConfig

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


def test_desk_headline_dimensions_convert_from_inches():
    d = SceneConfig().desk
    assert d.width_mm == pytest.approx(60 * MM_PER_IN)  # 1524 mm
    assert d.depth_mm == pytest.approx(762.0)
    assert d.height_mm == pytest.approx(736.6)


def test_monitor_active_area_matches_a_real_27_inch_16x9_panel():
    m = SceneConfig().monitor
    assert m.active_width_mm == pytest.approx(597.7, abs=0.2)
    assert m.active_height_mm == pytest.approx(336.2, abs=0.2)
    assert m.width_mm == pytest.approx(m.active_width_mm + 2 * m.bezel_mm)


def test_from_dict_overrides_nested_fields_and_keeps_the_rest():
    cfg = SceneConfig.from_dict({"desk": {"width_in": 72}, "monitor": {"bottom_above_desk_mm": 250}})
    assert cfg.desk.width_in == 72
    assert cfg.desk.depth_in == 30  # untouched default
    assert cfg.monitor.bottom_above_desk_mm == 250


def test_from_dict_rejects_unknown_settings():
    with pytest.raises(KeyError, match="widht_in"):
        SceneConfig.from_dict({"desk": {"widht_in": 72}})


def test_from_dict_ignores_comment_keys():
    cfg = SceneConfig.from_dict({"_comment": "hi", "desk": {"_note": "x", "height_in": 30}})
    assert cfg.desk.height_in == 30


def test_cameras_merge_by_name():
    cfg = SceneConfig.from_dict({"cameras": [
        {"name": "front", "lens_mm": 85},
        {"name": "detail", "location_mm": [100, -500, 900], "target_mm": [0, 0, 760]},
    ]})
    names = [c.name for c in cfg.cameras]
    assert names == ["front", "side", "overhead", "three_quarter", "detail"]
    front = cfg.cameras[0]
    assert front.lens_mm == 85
    assert front.location_mm == SceneConfig().cameras[0].location_mm  # unchanged fields survive
    assert cfg.cameras[-1].location_mm == (100.0, -500.0, 900.0)


def test_config_round_trips_through_json():
    cfg = SceneConfig.from_dict({"desk": {"width_in": 66}})
    again = SceneConfig.from_dict(json.loads(json.dumps(cfg.to_dict())))
    assert again == cfg


@pytest.mark.parametrize("path", sorted(CONFIG_DIR.glob("*.json")), ids=lambda p: p.name)
def test_shipped_config_files_load(path):
    SceneConfig.load(path)
