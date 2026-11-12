import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { COLORS, FONT } from '../theme';
import type { Pt } from '../geometry';

export type AnimatedLabelProps = {
  /** Frame (relative to the parent sequence) when the label starts to appear. */
  at: number;
  /** Label box anchor (left edge, vertical centre) in frame pixels. */
  x: number;
  y: number;
  /** Optional leader-line target in frame pixels. */
  target?: Pt;
  index?: number;
  title: string;
  detail?: string;
  /** How bright the label is once shown (dims earlier labels when later ones appear). */
  emphasis?: number;
  width?: number;
};

/**
 * Callout with a numbered badge and an animated leader line that draws to the component it describes.
 * Entrance is spring-driven; everything is frame-deterministic.
 */
export const AnimatedLabel: React.FC<AnimatedLabelProps> = ({ at, x, y, target, index, title, detail, emphasis = 1, width = 520 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - at, fps, config: { damping: 200 }, durationInFrames: 18 });
  const line = interpolate(frame - at, [6, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) });
  if (frame < at) return null;
  const startX = x + width;
  const len = target ? Math.hypot(target.x - startX, target.y - y) : 0;
  return (
    <>
      {target && (
        <svg style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, overflow: 'visible', opacity: emphasis }}>
          <path
            d={`M${startX},${y} L${startX + 40},${y} L${target.x},${target.y}`}
            fill="none"
            stroke={COLORS.amber}
            strokeWidth={2.5}
            strokeDasharray={len + 60}
            strokeDashoffset={(len + 60) * (1 - line)}
          />
          <circle cx={target.x} cy={target.y} r={7 * line} fill={COLORS.amber} />
          <circle cx={target.x} cy={target.y} r={16 * line} fill="none" stroke={COLORS.amber} strokeOpacity={0.5} strokeWidth={2} />
        </svg>
      )}
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width,
          translate: `${(1 - enter) * -40}px -50%`,
          opacity: enter * (0.35 + 0.65 * emphasis),
          display: 'flex',
          gap: 18,
          alignItems: 'center',
        }}
      >
        {index !== undefined && (
          <div
            style={{
              flex: 'none',
              width: 54,
              height: 54,
              borderRadius: 27,
              background: COLORS.amber,
              color: '#1b1204',
              fontFamily: FONT.sans,
              fontWeight: 800,
              fontSize: 28,
              display: 'grid',
              placeItems: 'center',
              boxShadow: `0 0 ${24 * emphasis}px rgba(255,178,56,0.55)`,
            }}
          >
            {index}
          </div>
        )}
        <div>
          <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 38, color: COLORS.white, lineHeight: 1.1 }}>{title}</div>
          {detail && <div style={{ fontFamily: FONT.sans, fontWeight: 500, fontSize: 26, color: COLORS.muted, marginTop: 6, lineHeight: 1.3 }}>{detail}</div>}
        </div>
      </div>
    </>
  );
};
