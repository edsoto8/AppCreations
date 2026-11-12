import React from 'react';
import { COLORS, FONT } from '../theme';

/**
 * A stylised, illustrative $20 note seen face-on (SVG, local units 0..240 × 0..104). Deliberately
 * abstract — geometric guilloche lines and a numeral — so it can't be mistaken for real currency.
 */
export const BillFace: React.FC<{ x?: number; y?: number; scale?: number; rotate?: number; opacity?: number; denom?: number }> = ({
  x = 0,
  y = 0,
  scale = 1,
  rotate = 0,
  opacity = 1,
  denom = 20,
}) => (
  <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`} opacity={opacity}>
    <rect x={-120} y={-52} width={240} height={104} rx={8} fill="url(#billGrad)" stroke={COLORS.cashLight} strokeWidth={1.5} />
    <rect x={-112} y={-44} width={224} height={88} rx={5} fill="none" stroke="#0c5a30" strokeWidth={1.2} opacity={0.8} />
    {Array.from({ length: 7 }).map((_, i) => (
      <ellipse key={i} cx={0} cy={0} rx={28 + i * 9} ry={14 + i * 4.5} fill="none" stroke="#0f6b39" strokeWidth={0.8} opacity={0.55} />
    ))}
    <circle cx={0} cy={0} r={26} fill="#178f4f" stroke={COLORS.cashLight} strokeWidth={1.2} />
    <text x={0} y={9} textAnchor="middle" fontFamily={FONT.sans} fontWeight={800} fontSize={26} fill="#eafff2">
      {denom}
    </text>
    <text x={-100} y={-24} fontFamily={FONT.sans} fontWeight={800} fontSize={18} fill="#e7fff0">
      {denom}
    </text>
    <text x={100} y={38} textAnchor="end" fontFamily={FONT.sans} fontWeight={800} fontSize={18} fill="#e7fff0">
      {denom}
    </text>
    <text x={-100} y={38} fontFamily={FONT.sans} fontWeight={600} fontSize={8} fill="#c5f5d8" letterSpacing={1.5}>
      ILLUSTRATIVE NOTE
    </text>
  </g>
);

/** Gradient definitions BillFace needs; include once per <svg>. */
export const BillDefs: React.FC = () => (
  <defs>
    <linearGradient id="billGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#36d987" />
      <stop offset="0.5" stopColor="#1fae63" />
      <stop offset="1" stopColor="#14894a" />
    </linearGradient>
  </defs>
);

/** Front view of a bundle of notes protruding from the cash slot (SVG local units). */
export const BundleFront: React.FC<{ x: number; y: number; scale?: number; count?: number }> = ({ x, y, scale = 1, count = 5 }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    {Array.from({ length: count }).map((_, i) => (
      <g key={i} transform={`translate(${(i - count / 2) * 1.6} ${-i * 3})`}>
        <rect x={-96} y={-20} width={192} height={40} rx={4} fill={i % 2 ? '#22b86a' : '#2fd17a'} stroke={COLORS.cashLight} strokeWidth={1} />
      </g>
    ))}
    <rect x={-96} y={-20 - (count - 1) * 3} width={192} height={40} rx={4} fill="none" stroke="#eafff2" strokeWidth={1.2} />
    <text x={0} y={6 - (count - 1) * 3} textAnchor="middle" fontFamily={FONT.sans} fontWeight={800} fontSize={18} fill="#eafff2">
      $20 × {count}
    </text>
  </g>
);

/**
 * Simple, neutral stylised hand reaching in from the right (palm down, fingers pointing left), local
 * origin at the index fingertip. `grip` 0..1 curls the fingers over the cash.
 */
export const Hand: React.FC<{ x: number; y: number; scale?: number; grip?: number }> = ({ x, y, scale = 1, grip = 0 }) => {
  const skin = '#d3dbe8';
  const edge = '#9fadc4';
  const fingers = [
    { y: -30, len: 150, x0: 0 },
    { y: -10, len: 162, x0: -8 },
    { y: 10, len: 154, x0: -2 },
    { y: 30, len: 132, x0: 16 },
  ];
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <defs>
        <linearGradient id="sleeveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3d62" />
          <stop offset="1" stopColor="#16223a" />
        </linearGradient>
      </defs>
      {/* thumb, tucked under the notes */}
      <g transform={`rotate(${-18 + grip * 10} 170 44)`}>
        <rect x={84} y={34} width={104} height={24} rx={12} fill={skin} stroke={edge} strokeWidth={1.5} />
      </g>
      {/* fingers */}
      {fingers.map((f, i) => (
        <g key={i} transform={`rotate(${-grip * (6 + i * 2)} ${f.x0 + f.len} ${f.y})`}>
          <rect x={f.x0} y={f.y - 10} width={f.len + 40} height={20} rx={10} fill={skin} stroke={edge} strokeWidth={1.5} />
          <line x1={f.x0 + 34} y1={f.y - 6} x2={f.x0 + 34} y2={f.y + 6} stroke={edge} strokeWidth={1.4} opacity={0.7} />
          <line x1={f.x0 + 82} y1={f.y - 6} x2={f.x0 + 82} y2={f.y + 6} stroke={edge} strokeWidth={1.4} opacity={0.7} />
        </g>
      ))}
      {/* back of the hand */}
      <path d="M150,-44 C190,-50 250,-48 290,-40 L300,52 C260,60 200,62 150,52 C130,30 130,-24 150,-44 Z" fill={skin} stroke={edge} strokeWidth={1.5} />
      {/* sleeve */}
      <rect x={284} y={-54} width={170} height={116} rx={14} fill="url(#sleeveGrad)" />
      <rect x={284} y={-54} width={14} height={116} rx={6} fill="#3b5280" />
    </g>
  );
};
