import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { ATMModel } from '../components/ATMModel';
import { ATMCamera, toScreen } from '../components/ATMCamera';
import { ATMCutaway, type HighlightKey } from '../components/ATMCutaway';
import { AnimatedLabel } from '../components/AnimatedLabel';
import { Backdrop } from '../components/Backdrop';
import { SceneHeading, Sfx } from '../components/SceneHeading';
import { WithdrawalScreen } from '../components/WithdrawalScreen';
import { CASH_SLOT, CASSETTES, PICK_Y, REJECT_BIN, SENSOR, TRANSPORT } from '../geometry';
import { CAM_INSIDE } from './cameras';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** The six components in narrative order; `slot` is the label's vertical position (sorted by target to avoid crossing leader lines). */
const PARTS: Array<{ key: HighlightKey; title: string; detail: string; at: number; slot: number; target: { x: number; y: number } }> = [
  { key: 'cassettes', title: 'Cash cassettes', detail: 'Removable boxes, one denomination each', at: 40, slot: 2, target: { x: 200, y: CASSETTES[0].y + 27 } },
  { key: 'dispenser', title: 'Dispenser mechanism', detail: 'Pick rollers take one note at a time', at: 78, slot: 3, target: { x: 412, y: PICK_Y(1) - 4 } },
  { key: 'transport', title: 'Transport pathway', detail: 'Belts and rollers move each note', at: 116, slot: 4, target: { x: TRANSPORT.x, y: 930 } },
  { key: 'sensor', title: 'Bill sensors', detail: 'Check every note as it passes', at: 154, slot: 1, target: { x: SENSOR.x - 33, y: SENSOR.y } },
  { key: 'reject', title: 'Reject / retract area', detail: 'Holds notes not to be dispensed', at: 192, slot: 5, target: { x: REJECT_BIN.x + REJECT_BIN.w / 2, y: REJECT_BIN.y + 90 } },
  { key: 'shutter', title: 'Cash exit shutter', detail: 'Opens only to present the cash', at: 230, slot: 0, target: { x: CASH_SLOT.x + CASH_SLOT.w / 2, y: CASH_SLOT.y + 20 } },
];

/** Scene 2 (6–16 s): the front turns to glass and the six main cash-handling components are introduced. */
export const Scene2Inside: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = { ...CAM_INSIDE, z: interpolate(frame, [0, 300], [CAM_INSIDE.z, CAM_INSIDE.z * 1.04], clamp) };
  const glass = interpolate(frame, [0, 34], [0.62, 0.13], { ...clamp, easing: Easing.bezier(0.45, 0, 0.2, 1) });
  const slide = (i: number): number =>
    interpolate(frame, [18 + i * 7, 48 + i * 7], [-360, 0], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  const highlights: Partial<Record<HighlightKey, number>> = {};
  for (const p of PARTS) highlights[p.key] = interpolate(frame, [p.at, p.at + 8, p.at + 40, p.at + 56], [0, 1, 1, 0.12], clamp);
  const newest = PARTS.filter((p) => frame >= p.at).length - 1;
  return (
    <AbsoluteFill>
      <Backdrop lightX={1250} />
      <ATMCamera cam={cam}>
        <ATMModel
          frontOpacity={glass}
          interior={
            <ATMCutaway
              opacity={interpolate(frame, [0, 20], [0.5, 1], clamp)}
              cassetteSlide={[slide(0), slide(1), slide(2)]}
              highlights={highlights}
              beltTravel={frame * 1.5}
              feedAngle={frame * 4}
              pickAngle={frame * 4}
              sensorFlash={interpolate(frame, [154, 162, 190], [0, 1, 0.2], clamp)}
              partLabels={interpolate(frame, [240, 270], [0, 1], clamp)}
            />
          }
          screen={<WithdrawalScreen step="welcome" />}
          shutterHighlight={highlights.shutter}
        />
      </ATMCamera>
      <SceneHeading eyebrow="Inside the ATM" title="Six parts handle the cash" note="Simplified, generic illustration — designs vary by manufacturer" at={6} />
      {PARTS.map((p, i) => (
        <AnimatedLabel
          key={p.key}
          at={p.at}
          x={110}
          y={300 + p.slot * 100}
          width={640}
          index={i + 1}
          title={p.title}
          detail={p.detail}
          emphasis={i === newest ? 1 : 0.55}
          target={toScreen(cam, p.target)}
        />
      ))}
      <Sfx name="Cassettes slide in" file="stack-tap.wav" at={46} volume={0.5} />
      {PARTS.map((p) => (
        <Sfx key={p.key} name={`Label ${p.title}`} file="sensor-tick.wav" at={p.at} volume={0.3} />
      ))}
    </AbsoluteFill>
  );
};
