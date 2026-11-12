import React from 'react';
import { COLORS } from '../theme';

/** Amber glow outline used to call out a component. `level` 0..1. */
export const Highlight: React.FC<{ x: number; y: number; w: number; h: number; level: number; r?: number }> = ({ x, y, w, h, level, r = 8 }) =>
  level <= 0.001 ? null : (
    <g opacity={level}>
      <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={r} fill="none" stroke={COLORS.amber} strokeWidth={6} filter="url(#glow)" />
      <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={r} fill={COLORS.amber} fillOpacity={0.06} stroke={COLORS.amberGlow} strokeWidth={2} />
    </g>
  );
