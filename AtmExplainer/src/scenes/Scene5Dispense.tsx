import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ATMModel } from '../components/ATMModel';
import { ATMCamera, mixCam, toScreen } from '../components/ATMCamera';
import { ATMCutaway, type BillState } from '../components/ATMCutaway';
import { AnimatedLabel } from '../components/AnimatedLabel';
import { Backdrop } from '../components/Backdrop';
import { BillDefs, BundleFront, Hand } from '../components/BillFace';
import { SceneHeading, Sfx } from '../components/SceneHeading';
import { WithdrawalScreen } from '../components/WithdrawalScreen';
import { along, CASH_SLOT, PRESENTER_TOP, REJECT_BIN, REJECT_PATH, STACKER } from '../geometry';
import { COLORS, FONT } from '../theme';
import { CAM_PRESENT, CAM_REJECT, CAM_SAFE, CAM_SLOT } from './cameras';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

// Key frames (relative to the scene)
const CLAMP = 10;
const LIFT = [28, 80] as const;
const SHUTTER_OPEN = [74, 92] as const;
const FRONT_ON = [86, 118] as const;
const BUNDLE_OUT = [96, 126] as const;
const HAND_IN = [132, 166] as const;
const GRIP = [164, 174] as const;
const HAND_OUT = [178, 214] as const;
const SHUTTER_CLOSE = [212, 230] as const;
const TO_REJECT = [236, 262] as const;
const GHOST = [256, 304] as const;

/** Scene 5 (38–49 s): the bundle travels to the shutter, is presented and taken; then the reject path is explained. */
export const Scene5Dispense: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  let cam = mixCam(CAM_SAFE, CAM_PRESENT, interpolate(frame, [0, 50], [0, 1], { ...clamp, easing: ease }));
  cam = mixCam(cam, CAM_SLOT, interpolate(frame, FRONT_ON, [0, 1], { ...clamp, easing: ease }));
  cam = mixCam(cam, CAM_REJECT, interpolate(frame, TO_REJECT, [0, 1], { ...clamp, easing: ease }));

  const front = interpolate(frame, [FRONT_ON[0], FRONT_ON[1], TO_REJECT[0], TO_REJECT[1]], [0.13, 1, 1, 0.13], clamp);
  const shutter = interpolate(frame, [SHUTTER_OPEN[0], SHUTTER_OPEN[1], SHUTTER_CLOSE[0], SHUTTER_CLOSE[1]], [0, 1, 1, 0], { ...clamp, easing: ease });
  const lift = interpolate(frame, LIFT, [0, PRESENTER_TOP.y - STACKER.stackY], { ...clamp, easing: ease });
  const belts = interpolate(frame, [LIFT[0], LIFT[1] + 10], [0, 260], clamp);
  const out = interpolate(frame, BUNDLE_OUT, [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  const handIn = interpolate(frame, HAND_IN, [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  const grip = interpolate(frame, GRIP, [0, 1], clamp);
  const away = interpolate(frame, HAND_OUT, [0, 1], { ...clamp, easing: Easing.bezier(0.5, 0, 0.75, 0) });
  const dispensed = spring({ frame: frame - 186, fps, config: { damping: 14, stiffness: 150 } });

  // Example flagged note on its way to the reject area
  const g = interpolate(frame, GHOST, [0, 1], { ...clamp, easing: Easing.bezier(0.4, 0, 0.6, 1) });
  const bills: BillState[] = [];
  if (frame >= GHOST[0] && g < 1) {
    const p = along(REJECT_PATH, g);
    bills.push({ x: p.x, y: p.y, angle: p.angle, variant: 'flag' });
  }
  const sensorPass = GHOST[0] + 12;
  const bundleX = CASH_SLOT.x + CASH_SLOT.w / 2;
  const bundleY = CASH_SLOT.y + 18 + out * 26;

  return (
    <AbsoluteFill>
      <Backdrop lightX={1200} />
      <ATMCamera cam={cam}>
        <ATMModel
          frontOpacity={front}
          shutterOpen={shutter}
          cashLight={frame > SHUTTER_OPEN[1] && frame < HAND_OUT[0] ? 0.55 + 0.45 * Math.sin(frame / 3) : 0}
          interior={
            <ATMCutaway
              opacity={1}
              stackCount={frame < BUNDLE_OUT[0] ? 5 : 0}
              stackLift={lift}
              stackClamp={interpolate(frame, [CLAMP, CLAMP + 12], [0, 1], clamp)}
              beltTravel={belts + (frame > GHOST[0] ? (frame - GHOST[0]) * 6 : 0)}
              feedAngle={belts * 3 + (frame > GHOST[0] ? (frame - GHOST[0]) * 14 : 0)}
              highlights={{ shutter: interpolate(frame, [LIFT[0], LIFT[0] + 10, SHUTTER_OPEN[1], SHUTTER_OPEN[1] + 12], [0, 0.7, 0.7, 0], clamp), reject: interpolate(frame, [270, 282, 320, 330], [0, 1, 1, 0.6], clamp) }}
              bills={bills}
              sensorFlash={interpolate(frame - sensorPass, [-3, 0, 14], [0, 1, 0], clamp)}
              sensorState="flag"
              diverter={interpolate(frame, [sensorPass + 2, sensorPass + 10], [0, 1], clamp)}
              rejectNotes={frame >= GHOST[1] ? 1 : 0}
              partLabels={1}
            />
          }
          screen={<WithdrawalScreen step={frame < HAND_OUT[1] ? 'take' : 'thanks'} />}
          overlay={
            <>
              <BillDefs />
              {frame >= BUNDLE_OUT[0] && (
                <g transform={`translate(${away * 520} ${away * 160})`} opacity={1 - interpolate(frame, [HAND_OUT[1] - 8, HAND_OUT[1]], [0, 1], clamp)}>
                  <BundleFront x={bundleX} y={bundleY} scale={0.9 + 0.3 * out} />
                </g>
              )}
              {frame >= HAND_IN[0] && frame < HAND_OUT[1] + 2 && (
                <Hand x={bundleX - 60 + (1 - handIn) * 520 + away * 520} y={bundleY - 6 + away * 160} scale={0.78} grip={grip} />
              )}
            </>
          }
        />
      </ATMCamera>

      <SceneHeading eyebrow="Step 3 · Dispense" title="Presenting the cash" note="Stacked notes move to the shutter, which opens" at={4} opacity={interpolate(frame, [TO_REJECT[0], TO_REJECT[0] + 12], [1, 0], clamp)} />

      {/* $100 dispensed badge */}
      <div
        style={{
          position: 'absolute',
          left: 110,
          top: 360,
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          padding: '20px 34px 20px 22px',
          borderRadius: 60,
          background: 'rgba(47,209,122,0.12)',
          border: `3px solid ${COLORS.cash}`,
          opacity: Math.min(1, dispensed) * interpolate(frame, [TO_REJECT[0], TO_REJECT[0] + 12], [1, 0], clamp),
          scale: `${0.85 + 0.15 * Math.min(1, dispensed)}`,
          boxShadow: '0 0 50px rgba(47,209,122,0.25)',
        }}
      >
        <div style={{ width: 66, height: 66, borderRadius: 33, background: COLORS.cash, display: 'grid', placeItems: 'center' }}>
          <svg width={36} height={36} viewBox="0 0 36 36">
            <path d="M7,18 L15,26 L30,9" stroke="#06331b" strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 64, color: COLORS.white }}>$100 Dispensed</div>
      </div>

      {/* reject explanation */}
      <SceneHeading eyebrow="Quality control" title="Misfed notes" note="Example note shown in red" at={TO_REJECT[0] + 4} opacity={frame >= TO_REJECT[0] ? 1 : 0} />
      <AnimatedLabel
        at={274}
        x={110}
        y={420}
        width={520}
        title="Reject area"
        detail="Misfed or overlapping notes can be diverted here instead of being dispensed. Uncollected cash may be retracted; handling varies by ATM."
        target={toScreen(CAM_REJECT, { x: REJECT_BIN.x + REJECT_BIN.w / 2, y: REJECT_BIN.y + 100 })}
      />

      <Sfx name="Presenter belts" file="roller-motor.wav" at={LIFT[0]} durationInFrames={LIFT[1] - LIFT[0] + 6} loop volume={0.3} />
      <Sfx name="Shutter opens" file="shutter.wav" at={SHUTTER_OPEN[0]} volume={0.6} />
      <Sfx name="Cash presented" file="ui-tap.wav" at={BUNDLE_OUT[1]} volume={0.35} />
      <Sfx name="Cash taken" file="bill-transport.wav" at={HAND_OUT[0]} volume={0.55} />
      <Sfx name="Dispensed" file="approve-chime.wav" at={186} volume={0.45} />
      <Sfx name="Shutter closes" file="shutter.wav" at={SHUTTER_CLOSE[0]} volume={0.45} />
      <Sfx name="To reject view" file="whoosh.wav" at={TO_REJECT[0]} volume={0.35} />
      <Sfx name="Flagged note" file="alert-soft.wav" at={sensorPass} volume={0.45} />
      <Sfx name="Note to reject" file="bill-transport.wav" at={sensorPass + 8} volume={0.4} />
    </AbsoluteFill>
  );
};
