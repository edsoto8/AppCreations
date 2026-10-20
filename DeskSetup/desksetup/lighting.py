"""Daylight rig: physical sky, sun through the curtained window, a light portal in the window
to guide Cycles' sampling, and one large, dim softbox standing in for room bounce."""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

from . import geometry as geo
from .config import SceneConfig
from .layout import Layout


def sun_direction(elevation_deg: float, azimuth_deg: float) -> Vector:
    """Unit vector pointing *towards* the sun (azimuth counter-clockwise from +X)."""
    el, az = math.radians(elevation_deg), math.radians(azimuth_deg)
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def build(cfg: SceneConfig, lay: Layout, col):
    L, r = cfg.lighting, cfg.room
    scene = bpy.context.scene

    world = bpy.data.worlds.new("Daylight")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = False  # the sun lamp provides the direct light
    sky.sun_elevation = math.radians(L.sun_elevation_deg)
    sky.sun_rotation = math.radians(L.sun_azimuth_deg + 90.0)  # Cycles measures from -Y
    sky.altitude = 120.0
    sky.air_density = 1.0
    sky.aerosol_density = 1.4  # slight haze: softer, whiter sky
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = L.sky_strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    to_sun = sun_direction(L.sun_elevation_deg, L.sun_azimuth_deg)
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = L.sun_strength
    sun.angle = math.radians(L.sun_angle_deg)
    sun.color = (1.0, 0.96, 0.90)
    sun_obj = bpy.data.objects.new("Sun", sun)
    col.objects.link(sun_obj)
    sun_obj.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    sun_obj.location = geo.v((r.left_wall_x_mm - 1500, r.window_center_y_mm, 3500))

    # Portal over the window opening, facing into the room.
    portal = bpy.data.lights.new("WindowPortal", "AREA")
    portal.shape = "RECTANGLE"
    portal.size = geo.m(r.window_height_mm)
    portal.size_y = geo.m(r.window_width_mm)
    portal.cycles.is_portal = True
    p_obj = bpy.data.objects.new("WindowPortal", portal)
    col.objects.link(p_obj)
    p_obj.location = geo.v((r.left_wall_x_mm - 125.0, r.window_center_y_mm, r.window_sill_mm + r.window_height_mm / 2))
    p_obj.rotation_euler = (0.0, -math.pi / 2, 0.0)

    # Soft fill from front-right, like light bouncing off the rest of the room.
    fill = bpy.data.lights.new("RoomFill", "AREA")
    fill.shape = "RECTANGLE"
    fill.size, fill.size_y = 2.2, 1.4
    fill.energy = L.fill_strength_w
    fill.color = (1.0, 0.97, 0.93)
    f_obj = bpy.data.objects.new("RoomFill", fill)
    col.objects.link(f_obj)
    f_obj.location = geo.v((1500.0, -2600.0, 2300.0))
    target = Vector(geo.v((0.0, 0.0, lay.desk.top_z)))
    f_obj.rotation_euler = (target - f_obj.location).to_track_quat("-Z", "Y").to_euler()
    f_obj.visible_camera = False

    scene.view_settings.view_transform = "AgX"
    looks = [i.identifier for i in scene.view_settings.bl_rna.properties["look"].enum_items]
    for wanted in ("AgX - Medium High Contrast", "Medium High Contrast"):
        if wanted in looks:
            scene.view_settings.look = wanted
            break
    scene.view_settings.exposure = L.exposure
    return sun_obj
