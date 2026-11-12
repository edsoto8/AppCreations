import React from 'react';
import { COLORS, FONT } from '../theme';

export type ScreenStep = 'welcome' | 'menu' | 'amount' | 'processing' | 'approved' | 'counting' | 'take' | 'thanks';

type Btn = { id: string; label: string; col: 0 | 1; row: number };

const MENU: Btn[] = [
  { id: 'withdraw', label: 'Withdraw cash', col: 0, row: 0 },
  { id: 'balance', label: 'Balance', col: 1, row: 0 },
  { id: 'deposit', label: 'Deposit', col: 0, row: 1 },
  { id: 'transfer', label: 'Transfer', col: 1, row: 1 },
];
const AMOUNTS: Btn[] = [
  { id: '20', label: '$20', col: 0, row: 0 },
  { id: '40', label: '$40', col: 1, row: 0 },
  { id: '60', label: '$60', col: 0, row: 1 },
  { id: '100', label: '$100', col: 1, row: 1 },
  { id: '200', label: '$200', col: 0, row: 2 },
  { id: 'other', label: 'Other', col: 1, row: 2 },
];

/**
 * The customer-facing ATM display, drawn in its own 330×206 coordinate space so it can be shown both
 * on the 3D-style ATM and enlarged on its own.
 */
export const WithdrawalScreen: React.FC<{
  step: ScreenStep;
  /** Button id being pressed and the press progress 0..1 (ripple). */
  press?: { id: string; t: number };
  /** Spinner rotation in degrees for processing screens. */
  spin?: number;
}> = ({ step, press, spin = 0 }) => {
  const W = 330;
  const H = 206;
  const header = (title: string, sub?: string) => (
    <>
      <text x={18} y={36} fontFamily={FONT.sans} fontWeight={700} fontSize={17} fill={COLORS.white}>
        {title}
      </text>
      {sub && (
        <text x={18} y={54} fontFamily={FONT.sans} fontSize={10.5} fill={COLORS.muted}>
          {sub}
        </text>
      )}
    </>
  );
  const buttons = (list: Btn[], top: number, h: number) =>
    list.map((b) => {
      const bx = 18 + b.col * 152;
      const by = top + b.row * (h + 8);
      const active = press?.id === b.id;
      const t = active ? press!.t : 0;
      return (
        <g key={b.id}>
          <rect x={bx} y={by} width={142} height={h} rx={7} fill={active && t > 0 ? `rgba(62,166,255,${0.25 + 0.5 * Math.sin(Math.min(1, t) * Math.PI)})` : 'rgba(255,255,255,0.08)'} stroke={active ? COLORS.signal : 'rgba(255,255,255,0.22)'} strokeWidth={active ? 2 : 1} />
          <text x={bx + 71} y={by + h / 2 + 5} textAnchor="middle" fontFamily={FONT.sans} fontWeight={600} fontSize={13} fill={COLORS.white}>
            {b.label}
          </text>
          {active && t > 0 && t < 1 && <circle cx={bx + 100} cy={by + h / 2} r={6 + 26 * t} fill="none" stroke={COLORS.signalGlow} strokeWidth={2} opacity={1 - t} />}
        </g>
      );
    });
  const spinner = (cx: number, cy: number) => (
    <g transform={`rotate(${spin} ${cx} ${cy})`}>
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return <circle key={i} cx={cx + Math.cos(a) * 16} cy={cy + Math.sin(a) * 16} r={2.6} fill={COLORS.signal} opacity={(i + 1) / 10} />;
      })}
    </g>
  );
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} fill="#081a38" />
      <rect x={0} y={0} width={W} height={20} fill="rgba(0,0,0,0.3)" />
      <text x={10} y={14} fontFamily={FONT.sans} fontWeight={700} fontSize={9} fill="#9cc8ff" letterSpacing={1.5}>
        ATM
      </text>
      <text x={W - 10} y={14} textAnchor="end" fontFamily={FONT.sans} fontSize={9} fill="#7d8aa3">
        Illustrative screen
      </text>
      {step === 'welcome' && (
        <>
          {header('Welcome', 'Insert or tap your card to begin')}
          <rect x={115} y={92} width={100} height={64} rx={8} fill="none" stroke={COLORS.signal} strokeWidth={2} />
          <rect x={125} y={104} width={22} height={16} rx={3} fill={COLORS.amber} />
        </>
      )}
      {step === 'menu' && (
        <>
          {header('Select a transaction')}
          {buttons(MENU, 76, 46)}
        </>
      )}
      {step === 'amount' && (
        <>
          {header('Withdraw cash', 'Choose an amount')}
          {buttons(AMOUNTS, 66, 36)}
        </>
      )}
      {step === 'processing' && (
        <>
          {header('Withdraw $100', 'Checking with your bank…')}
          {spinner(165, 132)}
          <text x={165} y={178} textAnchor="middle" fontFamily={FONT.sans} fontSize={11} fill={COLORS.signalGlow}>
            Requesting authorization
          </text>
        </>
      )}
      {(step === 'approved' || step === 'counting') && (
        <>
          {header(step === 'approved' ? 'Approved' : 'Preparing your cash', step === 'approved' ? 'Your bank approved this withdrawal' : 'Counting notes…')}
          <circle cx={165} cy={128} r={26} fill="rgba(47,209,122,0.15)" stroke={COLORS.cash} strokeWidth={3} />
          <path d="M152,128 L161,138 L180,118" fill="none" stroke={COLORS.cash} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {step === 'take' && (
        <>
          {header('Please take your cash', '$100 · 5 × $20')}
          <path d="M165,176 L165,120 M150,160 L165,176 L180,160" stroke={COLORS.cash} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {step === 'thanks' && header('Thank you', 'Your transaction is complete')}
    </g>
  );
};
