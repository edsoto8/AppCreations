import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';

/**
 * Wraps a scene with a smooth entrance and exit: fade + slight scale/blur at both ends of the
 * sequence, so consecutive scenes dissolve into each other without hard cuts.
 */
export const SceneTransition: React.FC<{ children: React.ReactNode; durationInFrames: number; fadeIn?: number; fadeOut?: number }> = ({
  children,
  durationInFrames,
  fadeIn = 12,
  fadeOut = 12,
}) => {
  const frame = useCurrentFrame();
  const opts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.33, 0, 0.2, 1) } as const;
  const inP = fadeIn > 0 ? interpolate(frame, [0, fadeIn], [0, 1], opts) : 1;
  const outP = fadeOut > 0 ? interpolate(frame, [durationInFrames - fadeOut, durationInFrames], [1, 0], opts) : 1;
  const p = Math.min(inP, outP);
  return (
    <AbsoluteFill
      style={{
        opacity: p,
        scale: 0.985 + 0.015 * p,
        filter: p < 0.999 ? `blur(${(1 - p) * 6}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
