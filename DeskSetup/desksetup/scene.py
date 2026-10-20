"""Builds the complete scene from a :class:`SceneConfig`."""

from __future__ import annotations

import json
from dataclasses import dataclass

import bpy

from . import cameras as cameras_mod
from . import geometry as geo
from . import layout as layout_mod
from . import lighting, render
from .components import cable_management, desk, desk_mat, keyboard, laptop, monitor, monitor_arm, mouse, room
from .config import SceneConfig


@dataclass
class BuiltScene:
    layout: layout_mod.Layout
    cameras: dict[str, bpy.types.Object]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "DeskSetup"
    us = scene.unit_settings
    us.system = "METRIC"
    us.scale_length = 1.0
    us.length_unit = "MILLIMETERS"


def build(cfg: SceneConfig) -> BuiltScene:
    lay = layout_mod.solve(cfg)  # fails fast, before touching Blender, if the layout is impossible
    reset()

    root = bpy.context.scene.collection
    c_desk = geo.collection("Desk", root)
    c_ws = geo.collection("Workstation", root)
    c_cables = geo.collection("CableManagement", root)
    c_room = geo.collection("Room", root)
    c_light = geo.collection("Lighting", root)
    c_cams = geo.collection("Cameras", root)

    brightness = cfg.lighting.screen_brightness
    desk.build(cfg, lay, geo.collection("DeskFrame", c_desk), grommet_xy=cable_management.grommet_xy(cfg, lay))
    desk_mat.build(cfg, lay, geo.collection("DeskMat", c_desk))
    mon = monitor.build(cfg, lay, geo.collection("Monitor", c_ws), brightness)
    monitor_arm.build(cfg, lay, geo.collection("MonitorArm", c_ws), mon)
    laptop.build(cfg, lay, geo.collection("Laptop", c_ws), brightness * 0.9)
    keyboard.build(cfg, lay, geo.collection("Keyboard", c_ws))
    mouse.build(cfg, lay, geo.collection("Mouse", c_ws))
    cable_management.build(cfg, lay, c_cables)
    room.build(cfg, lay, c_room)
    lighting.build(cfg, lay, c_light)
    cams = cameras_mod.build(cfg.cameras, c_cams)
    render.configure(cfg.render)
    bpy.context.scene.camera = next(iter(cams.values()))

    # Keep the inputs inside the .blend so a saved project documents how it was made.
    txt = bpy.data.texts.new("desksetup_config.json")
    txt.write(json.dumps(cfg.to_dict(), indent=2))
    rep = bpy.data.texts.new("desksetup_layout_report.json")
    rep.write(json.dumps({"report": lay.report, "warnings": lay.warnings}, indent=2))
    return BuiltScene(lay, cams)
