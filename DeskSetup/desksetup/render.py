"""Cycles settings, PNG export and .blend saving."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import bpy

from .config import RenderConfig


def configure(rc: RenderConfig):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    cy.samples = rc.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = rc.adaptive_threshold
    cy.use_denoising = rc.denoise
    if rc.denoise:
        cy.denoiser = "OPENIMAGEDENOISE"
        cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
        cy.denoising_prefilter = "ACCURATE"
    cy.max_bounces = rc.max_bounces
    cy.diffuse_bounces = 4
    cy.glossy_bounces = 6
    cy.transmission_bounces = 8
    cy.transparent_max_bounces = 16
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    cy.sample_clamp_direct = 0.0
    cy.sample_clamp_indirect = 8.0
    cy.light_sampling_threshold = 0.01
    cy.use_light_tree = True

    r = scene.render
    r.resolution_x = rc.resolution_x
    r.resolution_y = rc.resolution_y
    r.resolution_percentage = 100
    r.film_transparent = False
    r.use_persistent_data = True  # keep the scene in memory between views
    if rc.threads:
        r.threads_mode = "FIXED"
        r.threads = rc.threads
    img = r.image_settings
    img.file_format = "PNG"
    img.color_mode = "RGB"
    img.color_depth = "8"
    img.compression = 15


def render_views(cameras: dict[str, bpy.types.Object], out_dir: Path, views: Iterable[str] | None = None,
                 log=print) -> list[Path]:
    scene = bpy.context.scene
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name in views or cameras:
        if name not in cameras:
            raise KeyError(f"no camera named '{name}' (have: {', '.join(cameras)})")
        scene.camera = cameras[name]
        path = out_dir / f"desk_{name}.png"
        scene.render.filepath = str(path)
        log(f"rendering {name} -> {path}")
        bpy.ops.render.render(write_still=True)
        written.append(path)
    return written


def save_blend(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True, relative_remap=True)
