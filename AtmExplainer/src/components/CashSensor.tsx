import React from 'react';
import { COLORS } from '../theme';
import { Highlight } from './Highlight';

/**
 * Optical/thickness sensor gate straddling the transport: an emitter and receiver on each side of the
 * note path. `flash` lights the beam (green = OK, red = flagged note).
 */
export const CashSensor: React.FC<{ cx: number; cy: number; flash: number; state?: 'ok' | 'flag'; highlight?: number; span?: number }> = ({
  cx,
  cy,
  flash,
  state = 'ok',
  highlight = 0,
  span = 46,
}) => {
  const col = state === 'flag' ? COLORS.red : COLORS.cash;
  return (
    <g>
      <rect x={cx - span / 2 - 10} y={cy - 9} width={12} height={18} rx={2} fill={COLORS.amber} />
      <rect x={cx + span / 2 - 2} y={cy - 9} width={12} height={18} rx={2} fill={COLORS.amber} />
      <line x1={cx - span / 2 + 2} y1={cy} x2={cx + span / 2 - 2} y2={cy} stroke={col} strokeWidth={2} strokeDasharray="3 3" opacity={0.35 + 0.65 * flash} />
      {flash > 0.01 && (
        <g opacity={flash}>
          <line x1={cx - span / 2 + 2} y1={cy} x2={cx + span / 2 - 2} y2={cy} stroke={col} strokeWidth={8} filter="url(#glow)" />
          <circle cx={cx - span / 2 - 4} cy={cy} r={5} fill={col} filter="url(#glow)" />
          <circle cx={cx + span / 2 + 4} cy={cy} r={5} fill={col} filter="url(#glow)" />
        </g>
      )}
      <circle cx={cx - span / 2 - 4} cy={cy} r={2.5} fill={flash > 0.3 ? '#fff' : '#3a2c0a'} />
      <circle cx={cx + span / 2 + 4} cy={cy} r={2.5} fill={flash > 0.3 ? '#fff' : '#3a2c0a'} />
      <Highlight x={cx - span / 2 - 12} y={cy - 12} w={span + 24} h={24} level={highlight} r={6} />
    </g>
  );
};
