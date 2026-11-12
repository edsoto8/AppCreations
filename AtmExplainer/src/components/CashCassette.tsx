import React from 'react';
import { COLORS, FONT } from '../theme';
import { Highlight } from './Highlight';

export type CashCassetteProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  denom: number;
  label: string;
  /** 0..1 fill of standing notes (pushed toward the pick end on the right). */
  fill: number;
  /** Horizontal slide offset (cassette being inserted). */
  slideX?: number;
  highlight?: number;
  /** Small forward nudge of the front note while a note is being picked. */
  pickNudge?: number;
};

/**
 * A removable cash cassette seen from the side: a locked box with a handle, a spring pusher plate and
 * notes standing on edge, pressed toward the pick opening at the right end. One denomination per cassette.
 */
export const CashCassette: React.FC<CashCassetteProps> = ({ x, y, w, h, denom, label, fill, slideX = 0, highlight = 0, pickNudge = 0 }) => {
  const pickEnd = x + w - 10;
  const stackLen = Math.max(8, (w - 70) * fill);
  const stackStart = pickEnd - stackLen;
  const lines = Math.round(stackLen / 3.2);
  return (
    <g transform={`translate(${slideX},0)`}>
      <rect x={x} y={y} width={w} height={h} rx={5} fill="#1c2638" stroke="#55627a" strokeWidth={2} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} rx={3} fill="#0e1524" />
      {/* notes standing on edge */}
      {Array.from({ length: lines }).map((_, i) => {
        const lx = stackStart + i * 3.2 + (i === lines - 1 ? pickNudge * 3 : 0);
        return <line key={i} x1={lx} y1={y + 9} x2={lx} y2={y + h - 7} stroke={i % 2 ? COLORS.cash : COLORS.cashDark} strokeWidth={2.2} />;
      })}
      {/* pusher plate + spring */}
      <rect x={stackStart - 9} y={y + 6} width={6} height={h - 12} rx={2} fill="#8a96a8" />
      <path
        d={`M${x + 34},${y + h / 2} ${Array.from({ length: 8 })
          .map((_, i) => `L${x + 34 + ((stackStart - 9 - x - 34) * (i + 0.5)) / 8},${y + h / 2 + (i % 2 ? -7 : 7)}`)
          .join(' ')} L${stackStart - 9},${y + h / 2}`}
        fill="none"
        stroke="#6d7a8f"
        strokeWidth={2}
      />
      {/* handle */}
      <rect x={x - 16} y={y + h / 2 - 9} width={20} height={18} rx={4} fill="#3a4558" stroke="#6d7a8f" strokeWidth={2} />
      {/* denomination tag */}
      <rect x={x + 8} y={y + 6} width={42} height={18} rx={4} fill={COLORS.amber} />
      <text x={x + 29} y={y + 19.5} textAnchor="middle" fontFamily={FONT.sans} fontWeight={800} fontSize={12} fill="#1a1204">
        ${denom}
      </text>
      <text x={x + 8} y={y + h - 8} fontFamily={FONT.mono} fontSize={9} fill="#7d8aa3">
        {label}
      </text>
      <Highlight x={x - 16} y={y} w={w + 16} h={h} level={highlight} />
    </g>
  );
};
