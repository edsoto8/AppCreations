import React from 'react';
import { interpolate, useCurrentFrame, Easing } from 'remotion';
import { COLORS, FONT } from '../theme';

/**
 * One narration caption (lower third). Place it in a `Sequence` whose timing matches the voice-over line;
 * it fades in and out at the sequence edges.
 */
export const Caption: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.33, 0, 0.2, 1),
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 46,
        display: 'flex',
        justifyContent: 'center',
        opacity: o,
        translate: `0 ${(1 - o) * 10}px`,
      }}
    >
      <div
        style={{
          maxWidth: 1500,
          padding: '14px 30px',
          borderRadius: 14,
          background: 'rgba(5, 11, 26, 0.78)',
          border: '1px solid rgba(124, 196, 255, 0.18)',
          fontFamily: FONT.sans,
          fontSize: 38,
          fontWeight: 500,
          lineHeight: 1.3,
          color: COLORS.white,
          textAlign: 'center',
          boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
        }}
      >
        {text}
      </div>
    </div>
  );
};
