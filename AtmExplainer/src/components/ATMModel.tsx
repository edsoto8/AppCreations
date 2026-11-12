import React from 'react';
import { COLORS, FONT } from '../theme';
import { CAB, CARD_SLOT, CASH_SLOT, KEYPAD, RECEIPT, SAFE, SCREEN, SHUTTER, VIEW } from '../geometry';

export type ATMModelProps = {
  /** 1 = solid front panels, ~0.12 = transparent cutaway. */
  frontOpacity: number;
  /** Content drawn inside the display, in screen-local units (0..SCREEN.w, 0..SCREEN.h). */
  screen?: React.ReactNode;
  /** Internal mechanism, drawn behind the front panels. */
  interior?: React.ReactNode;
  /** Things in front of the machine (presented cash, hand, labels). */
  overlay?: React.ReactNode;
  /** 0 = shutter closed, 1 = open. */
  shutterOpen?: number;
  /** Glow intensity on the cash-slot lead-through light. */
  cashLight?: number;
  cardLight?: number;
  /** Amber highlight on the shutter (scene 2). */
  shutterHighlight?: number;
};

const K = ['1', '2', '3', 'X', '4', '5', '6', '←', '7', '8', '9', '', '', '0', '', '✓'];

/**
 * Stylised modern freestanding ATM: brushed-metal housing drawn face-on with an oblique side
 * and top for depth. The front panels fade to a glass outline for the cutaway view.
 */
export const ATMModel: React.FC<ATMModelProps> = ({
  frontOpacity,
  screen,
  interior,
  overlay,
  shutterOpen = 0,
  cashLight = 0,
  cardLight = 0,
  shutterHighlight = 0,
}) => {
  const fo = frontOpacity;
  const outline = 0.35 + 0.65 * (1 - fo); // housing edges brighten as the panels go transparent
  const sideX = CAB.x + CAB.w;
  return (
    <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="metalFront" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8d99ab" />
          <stop offset="0.18" stopColor="#d9dfe8" />
          <stop offset="0.5" stopColor="#b7c0cd" />
          <stop offset="0.82" stopColor="#e3e8ef" />
          <stop offset="1" stopColor="#99a5b6" />
        </linearGradient>
        <linearGradient id="metalSide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4c586b" />
          <stop offset="1" stopColor="#2b3445" />
        </linearGradient>
        <linearGradient id="metalTop" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#c5cdd9" />
          <stop offset="1" stopColor="#eef2f7" />
        </linearGradient>
        <linearGradient id="fascia" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f2a3d" />
          <stop offset="1" stopColor="#141c2b" />
        </linearGradient>
        <linearGradient id="safeDoor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#aab4c3" />
          <stop offset="0.5" stopColor="#cfd6e0" />
          <stop offset="1" stopColor="#8e9aac" />
        </linearGradient>
        <linearGradient id="screenGlass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0d2a55" />
          <stop offset="1" stopColor="#071833" />
        </linearGradient>
        <linearGradient id="topper" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0b3f8a" />
          <stop offset="0.5" stopColor="#1867d6" />
          <stop offset="1" stopColor="#0b3f8a" />
        </linearGradient>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.4" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="floorShadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.65" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* floor contact shadow */}
      <ellipse cx={CAB.x + CAB.w / 2 + 30} cy={CAB.y + CAB.h + 12} rx={CAB.w * 0.62} ry={34} fill="url(#floorShadow)" />

      {/* oblique side + top for depth */}
      <polygon
        points={`${sideX},${CAB.y} ${sideX + CAB.depthX},${CAB.y + CAB.depthY} ${sideX + CAB.depthX},${CAB.y + CAB.h + CAB.depthY} ${sideX},${CAB.y + CAB.h}`}
        fill="url(#metalSide)"
      />
      {/* side vents */}
      {Array.from({ length: 9 }).map((_, i) => (
        <line key={i} x1={sideX + 18} y1={CAB.y + 300 + i * 14 - 18} x2={sideX + 52} y2={CAB.y + 300 + i * 14 - 38} stroke="#1a2130" strokeWidth={4} strokeLinecap="round" />
      ))}
      <polygon
        points={`${CAB.x},${CAB.y} ${CAB.x + CAB.depthX},${CAB.y + CAB.depthY} ${sideX + CAB.depthX},${CAB.y + CAB.depthY} ${sideX},${CAB.y}`}
        fill="url(#metalTop)"
      />

      {/* cabinet cavity (visible through the cutaway) */}
      <rect x={CAB.x + 6} y={CAB.y + 6} width={CAB.w - 12} height={CAB.h - 12} fill="#0a1220" />
      <rect x={CAB.x + 6} y={CAB.y + 6} width={CAB.w - 12} height={CAB.h - 12} fill="url(#sheen)" opacity={0.15} />

      {/* ---------- interior mechanism ---------- */}
      <g>{interior}</g>

      {/* ---------- front panels ---------- */}
      <g opacity={fo}>
        {/* main housing face with cut-outs approximated by layering */}
        <rect x={CAB.x} y={CAB.y} width={CAB.w} height={CAB.h} rx={10} fill="url(#metalFront)" />
        <rect x={CAB.x} y={CAB.y} width={CAB.w} height={CAB.h} rx={10} fill="url(#sheen)" />
        {/* fascia (dark customer panel) */}
        <rect x={CAB.x + 40} y={170} width={CAB.w - 80} height={470} rx={14} fill="url(#fascia)" />
        {/* safe door */}
        <rect x={SAFE.x} y={SAFE.y} width={SAFE.w} height={SAFE.h} rx={8} fill="url(#safeDoor)" stroke="#7d899b" strokeWidth={2} />
        <rect x={SAFE.x + 16} y={SAFE.y + 16} width={SAFE.w - 32} height={SAFE.h - 32} rx={6} fill="none" stroke="#9aa6b8" strokeWidth={2} opacity={0.7} />
        {/* door handle and lock housing (generic) */}
        <rect x={SAFE.x + SAFE.w - 120} y={SAFE.y + 118} width={90} height={14} rx={7} fill="#5d6a7e" />
        <circle cx={SAFE.x + SAFE.w - 75} cy={SAFE.y + 80} r={18} fill="#6f7b8f" stroke="#a7b1c1" strokeWidth={3} />
        <text x={SAFE.x + 30} y={SAFE.y + SAFE.h - 30} fill="#5d6a7e" fontFamily={FONT.sans} fontSize={14} fontWeight={600} letterSpacing={2}>
          CASH SAFE
        </text>
      </g>

      {/* glass outline of the housing (always visible, brighter in cutaway) */}
      <rect x={CAB.x} y={CAB.y} width={CAB.w} height={CAB.h} rx={10} fill="none" stroke={COLORS.signalGlow} strokeOpacity={outline * 0.55} strokeWidth={2} />
      <rect x={SAFE.x} y={SAFE.y} width={SAFE.w} height={SAFE.h} rx={8} fill="none" stroke={COLORS.signalGlow} strokeOpacity={(1 - fo) * 0.45} strokeWidth={1.5} strokeDasharray="6 6" />

      {/* topper sign */}
      <g>
        <rect x={CAB.x} y={CAB.y} width={CAB.w} height={70} rx={10} fill="url(#topper)" />
        <rect x={CAB.x} y={CAB.y} width={CAB.w} height={70} rx={10} fill="url(#sheen)" />
        <text x={CAB.x + CAB.w / 2} y={CAB.y + 46} textAnchor="middle" fill="#eaf3ff" fontFamily={FONT.sans} fontWeight={800} fontSize={30} letterSpacing={8}>
          ATM · CASH
        </text>
      </g>

      {/* screen bezel + display (stays readable in cutaway) */}
      <g opacity={Math.max(fo, 0.55)}>
        <rect x={SCREEN.x - 25} y={SCREEN.y - 22} width={SCREEN.w + 50} height={SCREEN.h + 44} rx={12} fill="#0b111c" stroke="#2f3a4f" strokeWidth={3} />
        <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={4} fill="url(#screenGlass)" />
        <svg x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} viewBox={`0 0 ${SCREEN.w} ${SCREEN.h}`}>
          {screen}
        </svg>
        <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={4} fill="url(#sheen)" opacity={0.6} />
        {/* camera dot */}
        <circle cx={SCREEN.x + SCREEN.w / 2} cy={SCREEN.y - 11} r={4} fill="#1b2433" stroke="#3a4760" />
      </g>

      {/* keypad */}
      <g opacity={Math.max(fo, 0.45)}>
        <rect x={KEYPAD.x - 10} y={KEYPAD.y - 10} width={KEYPAD.w + 20} height={KEYPAD.h + 20} rx={8} fill="#0d131e" />
        {K.map((k, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const kx = KEYPAD.x + col * 46;
          const ky = KEYPAD.y + row * 30;
          const fill = k === 'X' ? '#b73a3a' : k === '←' ? '#c99a2e' : k === '✓' ? '#2f9e5b' : '#c9d1dc';
          return (
            <g key={i}>
              <rect x={kx} y={ky} width={40} height={24} rx={4} fill={fill} opacity={k ? 1 : 0.35} />
              <text x={kx + 20} y={ky + 17} textAnchor="middle" fontFamily={FONT.sans} fontSize={13} fontWeight={700} fill="#1b2230">
                {k}
              </text>
            </g>
          );
        })}
      </g>

      {/* card reader with lead-through light */}
      <g opacity={Math.max(fo, 0.45)}>
        <rect x={CARD_SLOT.x - 8} y={CARD_SLOT.y - 14} width={CARD_SLOT.w + 16} height={CARD_SLOT.h + 28} rx={6} fill="#0d131e" />
        <rect x={CARD_SLOT.x} y={CARD_SLOT.y} width={CARD_SLOT.w} height={CARD_SLOT.h} rx={3} fill="#05080d" stroke={COLORS.cash} strokeOpacity={0.4 + cardLight * 0.6} />
        <rect x={RECEIPT.x} y={RECEIPT.y} width={RECEIPT.w} height={RECEIPT.h} rx={3} fill="#05080d" />
        <text x={RECEIPT.x + RECEIPT.w / 2} y={RECEIPT.y + 24} textAnchor="middle" fontFamily={FONT.sans} fontSize={11} fill="#7d8aa3">
          RECEIPT
        </text>
      </g>

      {/* cash dispenser slot + shutter (shutter belongs to the mechanism and stays visible) */}
      <g>
        <rect x={CASH_SLOT.x - 14} y={CASH_SLOT.y - 14} width={CASH_SLOT.w + 28} height={CASH_SLOT.h + 28} rx={10} fill="#0d131e" opacity={Math.max(fo, 0.35)} />
        {cashLight > 0 && (
          <rect x={CASH_SLOT.x - 14} y={CASH_SLOT.y - 14} width={CASH_SLOT.w + 28} height={CASH_SLOT.h + 28} rx={10} fill="none" stroke={COLORS.cash} strokeWidth={6} opacity={cashLight} filter="url(#glow)" />
        )}
        <rect x={CASH_SLOT.x} y={CASH_SLOT.y} width={CASH_SLOT.w} height={CASH_SLOT.h} rx={6} fill="#020409" />
        {/* shutter plate slides up into the fascia when open */}
        <rect
          x={SHUTTER.x}
          y={SHUTTER.y - shutterOpen * (SHUTTER.h + 2)}
          width={SHUTTER.w}
          height={SHUTTER.h * (1 - shutterOpen) + 1}
          rx={3}
          fill="#4b566a"
          stroke={shutterHighlight > 0 ? COLORS.amber : '#6f7b8f'}
          strokeWidth={shutterHighlight > 0 ? 3 : 1.5}
        />
        {Array.from({ length: 4 }).map((_, i) => (
          <line
            key={i}
            x1={SHUTTER.x + 6}
            x2={SHUTTER.x + SHUTTER.w - 6}
            y1={SHUTTER.y + 6 + i * 7 - shutterOpen * (SHUTTER.h + 2)}
            y2={SHUTTER.y + 6 + i * 7 - shutterOpen * (SHUTTER.h + 2)}
            stroke="#3a4558"
            strokeWidth={1.5}
            opacity={1 - shutterOpen}
          />
        ))}
        <text x={CASH_SLOT.x + CASH_SLOT.w / 2} y={CASH_SLOT.y + CASH_SLOT.h + 30} textAnchor="middle" fontFamily={FONT.sans} fontSize={12} fill="#7d8aa3" letterSpacing={3} opacity={fo}>
          CASH
        </text>
      </g>

      <g>{overlay}</g>
    </svg>
  );
};
