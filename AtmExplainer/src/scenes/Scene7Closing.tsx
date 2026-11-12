import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ATMModel } from '../components/ATMModel';
import { ATMCamera } from '../components/ATMCamera';
import { ATMCutaway } from '../components/ATMCutaway';
import { Backdrop } from '../components/Backdrop';
import { Sfx } from '../components/SceneHeading';
import { WithdrawalScreen } from '../components/WithdrawalScreen';
import { COLORS, FONT } from '../theme';
import { CAM_CLOSE } from './cameras';

const STEPS: Array<{ label: string; color: string }> = [
  { label: 'Request', color: COLORS.signal },
  { label: 'Authorize', color: COLORS.signal },
  { label: 'Select', color: COLORS.amber },
  { label: 'Count', color: COLORS.amber },
  { label: 'Dispense', color: COLORS.cash },
  { label: 'Record', color: COLORS.white },
];

/** Scene 7 (56–60 s): full ATM, the six-step summary, closing title, fade to black. */
export const Scene7Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleIn = spring({ frame: frame - 40, fps, config: { damping: 200 }, durationInFrames: 22 });
  const cam = { ...CAM_CLOSE, z: interpolate(frame, [0, 120], [0.9, 0.95]) };
  return (
    <AbsoluteFill>
      <Backdrop lightX={1320} />
      <ATMCamera cam={cam}>
        <ATMModel frontOpacity={1} interior={<ATMCutaway opacity={0} />} screen={<WithdrawalScreen step="thanks" />} cashLight={0} />
      </ATMCamera>
      <div style={{ position: 'absolute', left: 110, top: 240, width: 860 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          {STEPS.map((s, i) => {
            const p = spring({ frame: frame - 4 - i * 5, fps, config: { damping: 200 }, durationInFrames: 16 });
            return (
              <React.Fragment key={s.label}>
                <div
                  style={{
                    padding: '14px 22px',
                    borderRadius: 14,
                    border: `2px solid ${s.color}`,
                    background: 'rgba(15,29,61,0.85)',
                    fontFamily: FONT.sans,
                    fontWeight: 700,
                    fontSize: 36,
                    color: COLORS.white,
                    opacity: p,
                    translate: `0 ${(1 - p) * 20}px`,
                    boxShadow: `0 0 24px ${s.color}33`,
                  }}
                >
                  {s.label}
                </div>
                {i < STEPS.length - 1 && <div style={{ fontSize: 34, color: COLORS.muted, opacity: p }}>→</div>}
              </React.Fragment>
            );
          })}
        </div>
        <div style={{ marginTop: 70, opacity: titleIn, translate: `0 ${(1 - titleIn) * 24}px` }}>
          <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 30, letterSpacing: 6, color: COLORS.amber }}>INSIDE AN ATM</div>
          <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 88, lineHeight: 1.05, color: COLORS.white, marginTop: 10 }}>
            Cash Management <span style={{ color: COLORS.cash }}>in Motion</span>
          </div>
        </div>
      </div>
      <Sfx name="Closing whoosh" file="whoosh.wav" at={0} volume={0.35} />
      <Sfx name="Closing chime" file="approve-chime.wav" at={42} volume={0.3} />
    </AbsoluteFill>
  );
};
