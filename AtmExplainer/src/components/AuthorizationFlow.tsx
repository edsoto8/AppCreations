import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { COLORS, FONT } from '../theme';

const NODES = [
  { id: 'atm', x: 110, title: 'ATM', sub: 'Your request' },
  { id: 'net', x: 420, title: 'ATM network', sub: '/ processor' },
  { id: 'bank', x: 730, title: 'Issuer bank', sub: 'Your bank' },
] as const;
const Y = 170;
const REQ_Y = Y - 26;
const RESP_Y = Y + 26;
const HOP = 26;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Glowing data pulse with a short trail. */
const Pulse: React.FC<{ x: number; y: number; color: string; dir: 1 | -1; opacity: number }> = ({ x, y, color, dir, opacity }) => (
  <g opacity={opacity}>
    {[0, 1, 2, 3].map((i) => (
      <circle key={i} cx={x - dir * i * 14} cy={y} r={9 - i * 2} fill={color} opacity={1 - i * 0.24} filter={i === 0 ? 'url(#pulseGlow)' : undefined} />
    ))}
  </g>
);

const Icon: React.FC<{ id: string; cx: number; cy: number }> = ({ id, cx, cy }) => {
  if (id === 'atm')
    return (
      <g>
        <rect x={cx - 18} y={cy - 26} width={36} height={52} rx={4} fill="none" stroke={COLORS.metalLight} strokeWidth={2.5} />
        <rect x={cx - 11} y={cy - 19} width={22} height={14} rx={2} fill={COLORS.signal} />
        <rect x={cx - 11} y={cy + 6} width={22} height={4} rx={1} fill={COLORS.metalMid} />
      </g>
    );
  if (id === 'net')
    return (
      <g stroke={COLORS.signalGlow} strokeWidth={2.5} fill="none">
        <circle cx={cx} cy={cy - 16} r={7} />
        <circle cx={cx - 20} cy={cy + 14} r={7} />
        <circle cx={cx + 20} cy={cy + 14} r={7} />
        <path d={`M${cx - 3},${cy - 10} L${cx - 16},${cy + 8} M${cx + 3},${cy - 10} L${cx + 16},${cy + 8} M${cx - 13},${cy + 14} L${cx + 13},${cy + 14}`} />
      </g>
    );
  return (
    <g stroke={COLORS.metalLight} strokeWidth={2.5} fill="none">
      <path d={`M${cx - 26},${cy - 10} L${cx},${cy - 26} L${cx + 26},${cy - 10} Z`} />
      {[-16, -5, 6, 17].map((dx) => (
        <line key={dx} x1={cx + dx} y1={cy - 6} x2={cx + dx} y2={cy + 18} />
      ))}
      <line x1={cx - 28} y1={cy + 22} x2={cx + 28} y2={cy + 22} />
    </g>
  );
};

/**
 * Simplified authorization path: ATM → ATM network/processor → issuer bank → response.
 * Blue pulses are electronic messages. `t0` is the frame (relative to the parent sequence) when the
 * request leaves the ATM. Purely conceptual — not a specific network protocol.
 */
export const AuthorizationFlow: React.FC<{ t0: number }> = ({ t0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - t0;
  const reqX = interpolate(f, [0, HOP * 2], [NODES[0].x, NODES[2].x], { ...clamp, easing: Easing.bezier(0.45, 0, 0.55, 1) });
  const reqOn = f >= 0 && f <= HOP * 2 + 4 ? 1 : 0;
  const checkStart = HOP * 2;
  const respStart = checkStart + 22;
  const respX = interpolate(f, [respStart, respStart + HOP * 2], [NODES[2].x, NODES[0].x], { ...clamp, easing: Easing.bezier(0.45, 0, 0.55, 1) });
  const respOn = f >= respStart && f <= respStart + HOP * 2 + 4 ? 1 : 0;
  const approved = spring({ frame: f - (respStart + HOP * 2 - 4), fps, config: { damping: 14, stiffness: 160 } });
  const nodeIn = (i: number) => spring({ frame: frame - i * 6, fps, config: { damping: 200 }, durationInFrames: 20 });
  const active = (i: number) => {
    const hits = [0, HOP, HOP * 2, respStart, respStart + HOP, respStart + HOP * 2].map((t, k) => ({ t, node: [0, 1, 2, 2, 1, 0][k] }));
    let v = 0;
    for (const hh of hits) if (hh.node === i) v = Math.max(v, interpolate(f, [hh.t - 4, hh.t, hh.t + 14], [0, 1, 0], clamp));
    if (i === 2) v = Math.max(v, interpolate(f, [checkStart, checkStart + 4, respStart, respStart + 6], [0, 0.8, 0.8, 0], clamp));
    return v;
  };
  const checks = ['Card and account valid', 'Funds available'];
  return (
    <svg viewBox="0 0 840 520" width="100%" height="100%" style={{ overflow: 'visible' }}>
      <defs>
        <filter id="pulseGlow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker id="arrR" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 Z" fill="#2c5ea8" />
        </marker>
      </defs>
      {/* lanes */}
      <line x1={NODES[0].x + 70} y1={REQ_Y} x2={NODES[2].x - 70} y2={REQ_Y} stroke="#2c5ea8" strokeWidth={2} strokeDasharray="6 8" markerEnd="url(#arrR)" opacity={nodeIn(2)} />
      <line x1={NODES[2].x - 70} y1={RESP_Y} x2={NODES[0].x + 70} y2={RESP_Y} stroke="#2c5ea8" strokeWidth={2} strokeDasharray="6 8" markerEnd="url(#arrR)" opacity={nodeIn(2)} />
      <text x={(NODES[0].x + NODES[1].x) / 2} y={REQ_Y - 14} textAnchor="middle" fontFamily={FONT.mono} fontSize={15} fill={COLORS.signalGlow} opacity={interpolate(f, [-10, 0], [0, 1], clamp)}>
        request: $100
      </text>
      <text x={(NODES[0].x + NODES[1].x) / 2} y={RESP_Y + 28} textAnchor="middle" fontFamily={FONT.mono} fontSize={15} fill={COLORS.cash} opacity={interpolate(f, [respStart, respStart + 10], [0, 1], clamp)}>
        response: approved
      </text>

      {NODES.map((n, i) => {
        const a = active(i);
        const s = nodeIn(i);
        return (
          <g key={n.id} opacity={s} transform={`translate(0 ${(1 - s) * 20})`}>
            <rect x={n.x - 70} y={Y - 60} width={140} height={120} rx={18} fill="#0f2147" stroke={COLORS.signal} strokeOpacity={0.35 + a * 0.65} strokeWidth={2 + a * 2} />
            {a > 0.01 && <rect x={n.x - 70} y={Y - 60} width={140} height={120} rx={18} fill="none" stroke={COLORS.signal} strokeWidth={10} opacity={a * 0.5} filter="url(#pulseGlow)" />}
            <Icon id={n.id} cx={n.x} cy={Y} />
            <text x={n.x} y={Y + 98} textAnchor="middle" fontFamily={FONT.sans} fontWeight={700} fontSize={26} fill={COLORS.white}>
              {n.title}
            </text>
            <text x={n.x} y={Y + 126} textAnchor="middle" fontFamily={FONT.sans} fontSize={20} fill={COLORS.muted}>
              {n.sub}
            </text>
          </g>
        );
      })}

      <Pulse x={reqX} y={REQ_Y} color={COLORS.signal} dir={1} opacity={reqOn} />
      <Pulse x={respX} y={RESP_Y} color={COLORS.signalGlow} dir={-1} opacity={respOn} />

      {/* issuer checks */}
      {checks.map((c, i) => {
        const o = interpolate(f, [checkStart + 2 + i * 9, checkStart + 10 + i * 9], [0, 1], clamp);
        return (
          <g key={c} opacity={o} transform={`translate(${NODES[2].x - 108} ${Y + 160 + i * 34})`}>
            <circle cx={10} cy={-6} r={10} fill="rgba(47,209,122,0.18)" stroke={COLORS.cash} strokeWidth={2} />
            <path d="M5,-6 L9,-2 L15,-11" stroke={COLORS.cash} strokeWidth={2.5} fill="none" strokeLinecap="round" />
            <text x={28} y={0} fontFamily={FONT.sans} fontSize={19} fill={COLORS.text}>
              {c}
            </text>
          </g>
        );
      })}

      {/* approval badge */}
      <g opacity={Math.min(1, approved)} transform={`translate(${NODES[0].x + 200} 430) scale(${0.8 + 0.2 * approved})`}>
        <rect x={-200} y={-42} width={400} height={84} rx={42} fill="rgba(47,209,122,0.14)" stroke={COLORS.cash} strokeWidth={3} />
        <circle cx={-152} cy={0} r={22} fill={COLORS.cash} />
        <path d="M-163,0 L-155,9 L-141,-9" stroke="#06331b" strokeWidth={4.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x={-114} y={11} fontFamily={FONT.sans} fontWeight={800} fontSize={32} fill={COLORS.white}>
          Withdrawal Approved
        </text>
      </g>
    </svg>
  );
};

/** Frame (relative to t0) when the response arrives back at the ATM. */
export const AUTH_RESPONSE_ARRIVES = 2 * HOP + 22 + 2 * HOP;
