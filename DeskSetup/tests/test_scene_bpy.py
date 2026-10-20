"""Builds the real Blender scene (no rendering). Skipped when the ``bpy`` module is missing."""

import pytest

bpy = pytest.importorskip("bpy")

from mathutils import Vector  # noqa: E402

from desksetup import scene  # noqa: E402
from desksetup.config import SceneConfig  # noqa: E402


@pytest.fixture(scope="module")
def built():
    return scene.build(SceneConfig())


def world_bbox(obj):
    """World-space AABB of an object's evaluated mesh (modifiers applied), in millimetres."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    pts = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    lo = tuple(min(p[i] for p in pts) * 1000 for i in range(3))
    hi = tuple(max(p[i] for p in pts) * 1000 for i in range(3))
    return lo, hi


def test_desk_top_has_real_world_size(built):
    lo, hi = world_bbox(bpy.data.objects["Desk_Top"])
    assert hi[0] - lo[0] == pytest.approx(1524, abs=0.5)
    assert hi[1] - lo[1] == pytest.approx(762, abs=0.5)
    assert hi[2] == pytest.approx(736.6, abs=0.1)


def test_every_component_is_its_own_object_tree(built):
    for name in ("Desk", "DeskMat", "Monitor", "MonitorArm", "Laptop", "Keyboard", "Mouse", "Dock", "PowerStrip",
                 "CableManagement", "Room"):
        assert name in bpy.data.objects, name
    for name in ("Desk", "DeskMat", "Monitor", "MonitorArm", "Laptop", "Keyboard", "Mouse", "CableManagement", "Room"):
        assert name in bpy.data.collections, name


def test_monitor_and_laptop_do_not_intersect(built):
    m_lo, _ = world_bbox(bpy.data.objects["Monitor_Panel"])
    _, l_hi = world_bbox(bpy.data.objects["Laptop_Lid"])
    assert m_lo[2] > l_hi[2]  # monitor housing sits above the lid


def test_dock_is_hidden_under_the_desk(built):
    _, hi = world_bbox(bpy.data.objects["Dock_Body"])
    assert hi[2] < built.layout.desk.bottom_z


def test_materials_cover_the_required_families(built):
    names = {m.name for m in bpy.data.materials}
    assert "Walnut" in names
    assert any(n.startswith("Aluminum_") for n in names)
    assert {"Glass_Window", "Glass_Black"} <= names
    assert any(n.startswith("Plastic_") for n in names)


def test_cycles_and_four_cameras(built):
    assert bpy.context.scene.render.engine == "CYCLES"
    assert set(built.cameras) == {"front", "side", "overhead", "three_quarter"}
