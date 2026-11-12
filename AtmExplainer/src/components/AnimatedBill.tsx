import React from 'react';
import { COLORS } from '../theme';

/** One banknote seen edge-on in the cutaway, oriented along its direction of travel. */
export const AnimatedBill: React.FC<{ x: number; y: number; angle: number; opacity?: number; variant?: 'ok' | 'flag' | 'ghost'; length?: number }> = ({
  x,
  y,
  angle,
  opacity = 1,
  variant = 'ok',
  length = 58,
}) => {
  const fill = variant === 'flag' ? COLORS.red : COLORS.cash;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} opacity={opacity}>
      <rect x={-length / 2} y={-3.5} width={length} height={7} rx={1.5} fill={fill} stroke={variant === 'flag' ? '#ffd0d5' : COLORS.cashLight} strokeWidth={0.8} strokeDasharray={variant === 'ghost' ? '3 2' : undefined} />
      <line x1={-length / 2 + 6} y1={0} x2={length / 2 - 6} y2={0} stroke={variant === 'flag' ? '#ffe3e6' : COLORS.cashLight} strokeWidth={0.8} opacity={0.7} />
      <rect x={-length / 2 - 4} y={-8} width={length + 8} height={16} rx={4} fill={fill} opacity={0.18} filter="url(#glow)" />
    </g>
  );
};

/** Horizontal stack of notes in the stacker (side view). */
export const StackedNotes: React.FC<{ x: number; y: number; count: number; length?: number; clamp?: number }> = ({ x, y, count, length = 76, clamp = 0 }) => (
  <g>
    {Array.from({ length: count }).map((_, i) => (
      <rect key={i} x={x - length / 2} y={y - i * 4.2 - 3.5} width={length} height={3.6} rx={1} fill={i % 2 ? COLORS.cash : '#25b866'} stroke={COLORS.cashLight} strokeWidth={0.5} />
    ))}
    {clamp > 0 && (
      <g opacity={clamp}>
        <rect x={x - length / 2 - 6} y={y - count * 4.2 - 9} width={length + 12} height={5} rx={2} fill="#8a96a8" />
        <rect x={x - length / 2 - 6} y={y + 2} width={length + 12} height={5} rx={2} fill="#8a96a8" />
      </g>
    )}
  </g>
);
