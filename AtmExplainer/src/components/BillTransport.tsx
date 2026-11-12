import React from 'react';
import { COLORS } from '../theme';
import { pathD, type Pt } from '../geometry';

/**
 * Belt-and-roller transport drawn along a path: two guide rails with small idler rollers and moving
 * belt dashes (`travel` shifts the dash pattern so the belt visibly runs).
 */
export const BillTransport: React.FC<{ path: Pt[]; travel: number; highlight?: number; width?: number; color?: string; showRollers?: boolean }> = ({
  path,
  travel,
  highlight = 0,
  width = 22,
  color = '#5d6a7e',
  showRollers = true,
}) => {
  const d = pathD(path);
  return (
    <g>
      <path d={d} fill="none" stroke="#141c2b" strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.35} />
      <path d={d} fill="none" stroke="#0a0f18" strokeWidth={width - 8} strokeLinejoin="round" strokeLinecap="round" />
      {/* moving belt */}
      <path d={d} fill="none" stroke="#8e9bb0" strokeWidth={1.6} strokeDasharray="5 9" strokeDashoffset={-travel} strokeLinejoin="round" />
      {showRollers &&
        path.slice(1, -1).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={5} fill="#3a4558" stroke="#8e9bb0" strokeWidth={1.5} />)}
      {highlight > 0.001 && (
        <g opacity={highlight}>
          <path d={d} fill="none" stroke={COLORS.amber} strokeWidth={width + 8} strokeOpacity={0.35} strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />
          <path d={d} fill="none" stroke={COLORS.amberGlow} strokeWidth={2} strokeLinejoin="round" />
        </g>
      )}
    </g>
  );
};
