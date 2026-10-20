"""Product-photography cameras: full-frame (36 mm) sensor, physical focal lengths and apertures,
focused on their target point."""

from __future__ import annotations

import math

import bpy
from mathutils import Euler, Vector

from . import geometry as geo
from .config import CameraConfig


def build(cameras: list[CameraConfig], col) -> dict[str, bpy.types.Object]:
    result = {}
    for c in cameras:
        cam = bpy.data.cameras.new(f"Camera_{c.name}")
        cam.lens = c.lens_mm
        cam.sensor_fit = "HORIZONTAL"
        cam.sensor_width = 36.0
        cam.clip_start = 0.02
        cam.clip_end = 60.0
        loc, target = geo.v(c.location_mm), geo.v(c.target_mm)
        cam.dof.use_dof = True
        cam.dof.focus_distance = (target - loc).length
        cam.dof.aperture_fstop = c.fstop
        cam.dof.aperture_blades = 7
        obj = bpy.data.objects.new(f"Camera_{c.name}", cam)
        col.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = aim(loc, target)
        result[c.name] = obj
    return result


def aim(location: Vector, target: Vector) -> Euler:
    """Rotation that points a camera at ``target`` with the horizon level. A camera looking
    straight down keeps world +Y at the top of the frame."""
    d = (target - location).normalized()
    if abs(d.z) > 0.999:
        return Euler((0.0, 0.0, 0.0) if d.z < 0 else (math.pi, 0.0, 0.0))
    return d.to_track_quat("-Z", "Y").to_euler()
