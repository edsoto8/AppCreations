import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { COLORS, FONT } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

type Row = { id: string; denom: string; before: number; after: number; capacity: number };
const ROWS: Row[] = [
  { id: 'A', denom: '$20', before: 500, after: 495, capacity: 600 },
  { id: 'B', denom: '$50', before: 400, after: 400, capacity: 600 },
  { id: 'C', denom: '$100', before: 250, after: 250, capacity: 600 },
];

const EVENTS: Array<{ text: string; color: string; time: string }> = [
  { text: 'Authorization approved by issuer', color: COLORS.signal, time: '10:42:07' },
  { text: '5 × $20 picked, checked and stacked', color: COLORS.cash, time: '10:42:09' },
  { text: 'Cash presented at the shutter', color: COLORS.amber, time: '10:42:11' },
  { text: 'Customer took the cash', color: COLORS.cash, time: '10:42:13' },
  { text: 'Transaction completed and recorded', color: COLORS.white, time: '10:42:13' },
];

/**
 * Simplified ATM cash-inventory dashboard: cassette counts update after the withdrawal, alongside the
 * sequence of distinct events the ATM records. `countAt` is the frame the counter starts dropping.
 */
export const CashInventoryDashboard: React.FC<{ countAt: number; eventsAt: number }> = ({ countAt, eventsAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const panel = (i: number) => spring({ frame: frame - i * 8, fps, config: { damping: 200 }, durationInFrames: 22 });
  const box: React.CSSProperties = {
    background: 'linear-gradient(180deg, rgba(20,38,78,0.92), rgba(12,24,52,0.92))',
    border: '1px solid rgba(124,196,255,0.22)',
    borderRadius: 22,
    padding: '30px 36px',
    boxShadow: '0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
  };
  const step = (from: number, to: number) => {
    // count down one note at a time (5 visible ticks)
    const k = Math.floor(interpolate(frame, [countAt, countAt + 40], [0, from - to], clamp));
    return from - k;
  };
  const totalBefore = ROWS.reduce((s, r) => s + r.before * Number(r.denom.slice(1)), 0);
  const totalNow = ROWS.reduce((s, r) => s + step(r.before, r.after) * Number(r.denom.slice(1)), 0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 36, width: '100%', fontFamily: FONT.sans, color: COLORS.white }}>
      <div style={{ ...box, opacity: panel(0), translate: `0 ${(1 - panel(0)) * 30}px` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 40, fontWeight: 800 }}>Cash inventory</div>
          <div style={{ fontSize: 22, color: COLORS.muted }}>Illustrative ATM</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', marginTop: 26, fontSize: 21, color: COLORS.muted, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          <div>Cassette</div>
          <div style={{ textAlign: 'right' }}>Bills</div>
          <div style={{ textAlign: 'right' }}>Value</div>
        </div>
        {ROWS.map((r) => {
          const n = step(r.before, r.after);
          const changing = r.before !== r.after;
          const flash = changing ? interpolate(frame, [countAt, countAt + 10, countAt + 50, countAt + 70], [0, 1, 1, 0.35], clamp) : 0;
          return (
            <div key={r.id} style={{ marginTop: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', alignItems: 'baseline', fontSize: 36 }}>
                <div style={{ fontWeight: 700 }}>
                  <span style={{ color: COLORS.amber }}>{r.denom}</span> <span style={{ fontSize: 24, color: COLORS.muted }}>cassette {r.id}</span>
                </div>
                <div style={{ textAlign: 'right', fontFamily: FONT.mono, fontWeight: 700, color: changing ? `rgb(${255 - flash * 208}, ${255 - flash * 46}, ${255 - flash * 133})` : COLORS.white }}>{n}</div>
                <div style={{ textAlign: 'right', fontFamily: FONT.mono, color: COLORS.text }}>${(n * Number(r.denom.slice(1))).toLocaleString('en-US')}</div>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.08)', marginTop: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(n / r.capacity) * 100}%`, borderRadius: 5, background: `linear-gradient(90deg, ${COLORS.cashDark}, ${COLORS.cash})` }} />
              </div>
              {changing && (
                <div style={{ fontSize: 24, color: COLORS.cash, marginTop: 8, opacity: interpolate(frame, [countAt + 40, countAt + 52], [0, 1], clamp) }}>
                  −5 bills · {r.before} → {r.after}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(124,196,255,0.18)', fontSize: 28 }}>
          <span style={{ color: COLORS.muted }}>Total cash in cassettes</span>
          <span style={{ fontFamily: FONT.mono, fontWeight: 700 }}>
            ${totalNow.toLocaleString('en-US')}
            {totalNow !== totalBefore && <span style={{ color: COLORS.cash, fontSize: 22 }}> (−$100)</span>}
          </span>
        </div>
      </div>

      <div style={{ ...box, opacity: panel(1), translate: `0 ${(1 - panel(1)) * 30}px` }}>
        <div style={{ fontSize: 40, fontWeight: 800 }}>Transaction record</div>
        <div style={{ fontSize: 22, color: COLORS.muted, marginTop: 6 }}>Each step is logged as a separate event</div>
        <div style={{ marginTop: 22 }}>
          {EVENTS.map((e, i) => {
            const o = interpolate(frame, [eventsAt + i * 12, eventsAt + i * 12 + 10], [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
            return (
              <div key={e.text} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '11px 0', opacity: o, translate: `${(1 - o) * 24}px 0` }}>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: e.color, boxShadow: `0 0 12px ${e.color}`, flex: 'none' }} />
                <div style={{ fontFamily: FONT.mono, fontSize: 21, color: COLORS.muted, flex: 'none' }}>{e.time}</div>
                <div style={{ fontSize: 27 }}>{e.text}</div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 22,
            lineHeight: 1.4,
            color: COLORS.text,
            padding: '14px 18px',
            borderRadius: 12,
            background: 'rgba(255,178,56,0.08)',
            border: '1px solid rgba(255,178,56,0.3)',
            opacity: interpolate(frame, [eventsAt + 66, eventsAt + 80], [0, 1], clamp),
          }}
        >
          Dispensing, customer collection and posting are related but distinct events. Exact handling varies by ATM and processor.
        </div>
      </div>
    </div>
  );
};
