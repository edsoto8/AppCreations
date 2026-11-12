import React from 'react';
import { AbsoluteFill } from 'remotion';
import { VIEW, type Pt } from '../geometry';

/** Base pixels per SVG unit at zoom 1 (the full ATM is ~900 px tall). */
export const BASE_UNIT = 0.85;

export type Cam = {
  /** Focus point in ATM SVG units. */
  fx: number;
  fy: number;
  /** Where that focus point sits on the 1920×1080 frame. */
  sx: number;
  sy: number;
  /** Zoom factor. */
  z: number;
  /** Small yaw (degrees) for a dimensional camera feel. */
  yaw?: number;
};

/** Map an ATM SVG point to frame pixels for a camera (used for HTML labels and leader lines). */
export const toScreen = (cam: Cam, p: Pt): Pt => ({
  x: cam.sx + (p.x - cam.fx) * BASE_UNIT * cam.z,
  y: cam.sy + (p.y - cam.fy) * BASE_UNIT * cam.z,
});

/** Linear blend between two camera states (t is already eased). */
export const mixCam = (a: Cam, b: Cam, t: number): Cam => ({
  fx: a.fx + (b.fx - a.fx) * t,
  fy: a.fy + (b.fy - a.fy) * t,
  sx: a.sx + (b.sx - a.sx) * t,
  sy: a.sy + (b.sy - a.sy) * t,
  z: a.z + (b.z - a.z) * t,
  yaw: (a.yaw ?? 0) + ((b.yaw ?? 0) - (a.yaw ?? 0)) * t,
});

/**
 * Positions the ATM drawing so the focus point lands at (sx, sy) at zoom z. The SVG is re-laid-out at
 * the target size (not bitmap-scaled), so it stays crisp at any zoom.
 */
export const ATMCamera: React.FC<{ cam: Cam; children: React.ReactNode }> = ({ cam, children }) => {
  const u = BASE_UNIT * cam.z;
  return (
    <AbsoluteFill style={{ perspective: 2600, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: cam.sx - cam.fx * u,
          top: cam.sy - cam.fy * u,
          width: VIEW.w * u,
          height: VIEW.h * u,
          rotate: `y ${cam.yaw ?? 0}deg`,
          transformOrigin: `${cam.fx * u}px ${cam.fy * u}px`,
          filter: 'drop-shadow(0 40px 60px rgba(0,0,0,0.55))',
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
