import React from 'react';
import { COLORS } from '../theme';

/** A pair of rubber-tyred pick/feed rollers. `angle` in degrees drives the rotation. */
export const CashRollers: React.FC<{ cx: number; cy: number; r?: number; angle: number; gap?: number; highlight?: number; vertical?: boolean }> = ({
  cx,
  cy,
  r = 9,
  angle,
  gap = 2,
  highlight = 0,
  vertical = false,
}) => {
  const offs = r + gap / 2;
  const centers = vertical ? [[cx - offs, cy], [cx + offs, cy]] : [[cx, cy - offs], [cx, cy + offs]];
  return (
    <g>
      {centers.map(([x, y], i) => (
        <g key={i} transform={`rotate(${i ? -angle : angle} ${x} ${y})`}>
          <circle cx={x} cy={y} r={r} fill="#232c3c" stroke={highlight ? COLORS.amber : '#7c879a'} strokeWidth={2.5} />
          <circle cx={x} cy={y} r={r * 0.38} fill="#9aa6b8" />
          {[0, 120, 240].map((a) => (
            <line key={a} x1={x} y1={y} x2={x + Math.cos((a * Math.PI) / 180) * r * 0.85} y2={y + Math.sin((a * Math.PI) / 180) * r * 0.85} stroke="#9aa6b8" strokeWidth={1.6} />
          ))}
        </g>
      ))}
    </g>
  );
};
