import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ATMModel } from '../components/ATMModel';
import { ATMCamera, mixCam } from '../components/ATMCamera';
import { ATMCutaway, type BillState } from '../components/ATMCutaway';
import { Backdrop } from '../components/Backdrop';
import { SceneHeading, Sfx } from '../components/SceneHeading';
import { WithdrawalScreen } from '../components/WithdrawalScreen';
import { along, billPathA, SENSOR, type Pt } from '../geometry';
import { COLORS, FONT } from '../theme';
import { CAM_INSIDE, CAM_SAFE } from './cameras';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Note timing: each of the five notes is picked PICK_GAP frames after the previous one and takes TRAVEL frames. */
export const FIRST_PICK = 50;
export const PICK_GAP = 48;
export const TRAVEL = 72;
const NOTES = 5;

/** Fraction of a path at which it reaches a given point (used to time the sensor flash). */
function fractionAt(path: Pt[], target: Pt): number {
  let total = 0;
  let at = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const l = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    if (path[i + 1].x === target.x && path[i + 1].y === target.y) at = total + l;
    total += l;
  }
  return at / total;
}

/** Eased progress of one note along its path: a slow, deliberate pick, then steady belt speed. */
const noteProgress = (frame: number, i: number): number => {
  const local = frame - (FIRST_PICK + i * PICK_GAP);
  return interpolate(local, [0, 14, TRAVEL - 8, TRAVEL], [0, 0.07, 0.95, 1], { ...clamp, easing: Easing.bezier(0.4, 0, 0.6, 1) });
};

/** Frame at which note i crosses the sensor (approximate inverse of noteProgress). */
const sensorFrame = (i: number): number => {
  const f = fractionAt(billPathA(i), SENSOR);
  // invert the piecewise mapping: 0.07 at 14 frames, 0.95 at TRAVEL-8
  const local = 14 + ((f - 0.07) / (0.95 - 0.07)) * (TRAVEL - 8 - 14);
  return Math.round(FIRST_PICK + i * PICK_GAP + local);
};

/** Scene 4 (25–38 s): five $20 notes are picked, checked by the sensor, counted and stacked. */
export const Scene4Counting: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = interpolate(frame, [0, 44], [0, 1], { ...clamp, easing: Easing.bezier(0.45, 0, 0.2, 1) });
  const cam = mixCam(CAM_INSIDE, CAM_SAFE, zoom);

  const bills: BillState[] = [];
  let arrived = 0;
  let passed = 0;
  let picking = 0;
  for (let i = 0; i < NOTES; i++) {
    const t = noteProgress(frame, i);
    const start = FIRST_PICK + i * PICK_GAP;
    if (frame >= start && t < 1) {
      const p = along(billPathA(i), t);
      bills.push({ x: p.x, y: p.y, angle: p.angle });
    }
    if (t >= 1) arrived++;
    if (frame >= sensorFrame(i)) passed++;
    picking = Math.max(picking, interpolate(frame - start, [-2, 2, 14, 18], [0, 1, 1, 0], clamp));
  }
  const sensorFlash = Math.max(0, ...Array.from({ length: NOTES }, (_, i) => interpolate(frame - sensorFrame(i), [-3, 0, 8], [0, 1, 0], clamp)));
  // integrate motor speed so rollers spin up and down smoothly (deterministic per frame)
  let spin = 0;
  for (let f = 0; f < frame; f++)
    spin += interpolate(f, [FIRST_PICK - 8, FIRST_PICK, FIRST_PICK + (NOTES - 1) * PICK_GAP + TRAVEL, FIRST_PICK + (NOTES - 1) * PICK_GAP + TRAVEL + 10], [0, 1, 1, 0], clamp);

  const count = passed;
  const countPop = spring({ frame: frame - (count ? sensorFrame(count - 1) : 0), fps, config: { damping: 12, stiffness: 200 } });
  const eqDone = frame >= FIRST_PICK + (NOTES - 1) * PICK_GAP + TRAVEL;
  const checkIn = spring({ frame: frame - 300, fps, config: { damping: 200 }, durationInFrames: 22 });

  return (
    <AbsoluteFill>
      <Backdrop lightX={1200} lightY={480} />
      <ATMCamera cam={cam}>
        <ATMModel
          frontOpacity={0.13}
          interior={
            <ATMCutaway
              opacity={1}
              highlights={{ dispenser: picking * 0.6 }}
              pickAngle={spin * 14}
              feedAngle={spin * 16}
              beltTravel={spin * 5}
              sensorFlash={sensorFlash}
              bills={bills}
              stackCount={arrived}
              cassetteFill={[0.92 - arrived * 0.004, 0.7, 0.55]}
              pickNudge={picking}
              partLabels={1}
            />
          }
          screen={<WithdrawalScreen step="counting" />}
        />
      </ATMCamera>

      <SceneHeading eyebrow="Step 2 · Select and count" title="Picking $20 notes" note="Cassette A holds $20 notes · mechanism simplified" at={4} />

      {/* note counter */}
      <div style={{ position: 'absolute', left: 110, top: 290, width: 520, fontFamily: FONT.sans }}>
        <div style={{ fontSize: 26, letterSpacing: 4, color: COLORS.muted, textTransform: 'uppercase', fontWeight: 600 }}>Notes counted</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 150, lineHeight: 1, color: COLORS.cash, scale: `${1 + (count ? (1 - Math.min(1, countPop)) * 0.18 : 0)}`, textShadow: '0 0 40px rgba(47,209,122,0.45)' }}>{count}</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 56, color: COLORS.muted }}>/ 5</div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          {Array.from({ length: NOTES }).map((_, i) => (
            <div key={i} style={{ width: 70, height: 30, borderRadius: 5, background: i < count ? COLORS.cash : 'rgba(255,255,255,0.08)', border: `1px solid ${i < count ? COLORS.cashLight : 'rgba(255,255,255,0.15)'}`, boxShadow: i < count ? '0 0 14px rgba(47,209,122,0.45)' : undefined }} />
          ))}
        </div>
        <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 56, color: COLORS.white, marginTop: 20, opacity: count ? 1 : 0 }}>
          {count} × $20{' '}
          <span style={{ color: COLORS.cash, opacity: eqDone ? 1 : 0.25 }}>= ${count * 20}</span>
        </div>
      </div>

      {/* feed check explainer */}
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 620,
          width: 500,
          padding: '20px 24px',
          borderRadius: 16,
          background: 'rgba(15, 29, 61, 0.9)',
          border: `1px solid rgba(255,178,56,0.35)`,
          opacity: checkIn,
          translate: `0 ${(1 - checkIn) * 24}px`,
          fontFamily: FONT.sans,
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.amber }}>Sensors check each note</div>
        <svg viewBox="0 0 560 92" width="100%" style={{ marginTop: 10, display: 'block' }}>
          {/* single note: OK */}
          <rect x={10} y={40} width={130} height={8} rx={2} fill={COLORS.cash} />
          <line x1={75} y1={14} x2={75} y2={74} stroke={COLORS.cash} strokeWidth={2} strokeDasharray="4 4" />
          <text x={75} y={90} textAnchor="middle" fontFamily={FONT.sans} fontSize={17} fill={COLORS.text}>
            1 note ✓
          </text>
          {/* overlapping: flagged */}
          <rect x={210} y={36} width={130} height={8} rx={2} fill={COLORS.cash} />
          <rect x={230} y={44} width={130} height={8} rx={2} fill={COLORS.red} />
          <line x1={285} y1={14} x2={285} y2={74} stroke={COLORS.red} strokeWidth={2} strokeDasharray="4 4" />
          <text x={285} y={90} textAnchor="middle" fontFamily={FONT.sans} fontSize={17} fill={COLORS.text}>
            overlapping ✕
          </text>
          {/* skewed: flagged */}
          <rect x={420} y={40} width={120} height={8} rx={2} fill={COLORS.red} transform="rotate(-12 480 44)" />
          <text x={480} y={90} textAnchor="middle" fontFamily={FONT.sans} fontSize={17} fill={COLORS.text}>
            misfed ✕
          </text>
        </svg>
        <div style={{ fontSize: 22, color: COLORS.muted, marginTop: 8, lineHeight: 1.35 }}>Thickness, length and position are checked as notes pass. Problem notes are flagged and not dispensed.</div>
      </div>

      <Sfx name="Roller motor" file="roller-motor.wav" at={FIRST_PICK - 6} durationInFrames={(NOTES - 1) * PICK_GAP + TRAVEL + 16} loop volume={0.32} />
      {Array.from({ length: NOTES }).map((_, i) => (
        <React.Fragment key={i}>
          <Sfx name={`Pick note ${i + 1}`} file="bill-pick.wav" at={FIRST_PICK + i * PICK_GAP + 2} volume={0.7} />
          <Sfx name={`Transport note ${i + 1}`} file="bill-transport.wav" at={FIRST_PICK + i * PICK_GAP + 18} volume={0.35} />
          <Sfx name={`Sensor note ${i + 1}`} file="sensor-tick.wav" at={sensorFrame(i)} volume={0.45} />
          <Sfx name={`Count ${i + 1}`} file="counter-tick.wav" at={sensorFrame(i) + 2} volume={0.6} />
          <Sfx name={`Stack note ${i + 1}`} file="stack-tap.wav" at={FIRST_PICK + i * PICK_GAP + TRAVEL - 2} volume={0.5} />
        </React.Fragment>
      ))}
      <Sfx name="Sum complete" file="approve-chime.wav" at={FIRST_PICK + (NOTES - 1) * PICK_GAP + TRAVEL + 2} volume={0.25} />
    </AbsoluteFill>
  );
};
