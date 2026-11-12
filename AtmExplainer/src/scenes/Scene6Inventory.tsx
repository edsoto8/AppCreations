import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { CashInventoryDashboard } from '../components/CashInventoryDashboard';
import { SceneHeading, Sfx } from '../components/SceneHeading';

const COUNT_AT = 34;
const EVENTS_AT = 26;

/** Scene 6 (49–56 s): the cassette count drops by five and the ATM's event record is shown. */
export const Scene6Inventory: React.FC = () => (
  <AbsoluteFill>
    <Backdrop lightX={960} lightY={500} />
    <SceneHeading eyebrow="Step 4 · Record" title="The ATM updates its records" note="Cash and transaction records support monitoring and reconciliation" at={2} />
    <div style={{ position: 'absolute', left: 110, top: 300, width: 1700 }}>
      <CashInventoryDashboard countAt={COUNT_AT} eventsAt={EVENTS_AT} />
    </div>
    {[0, 1, 2, 3, 4].map((i) => (
      <Sfx key={i} name={`Inventory tick ${i + 1}`} file="counter-tick.wav" at={COUNT_AT + 4 + i * 8} volume={0.55} />
    ))}
    {[0, 1, 2, 3, 4].map((i) => (
      <Sfx key={`e${i}`} name={`Record event ${i + 1}`} file="sensor-tick.wav" at={EVENTS_AT + i * 12} volume={0.22} />
    ))}
  </AbsoluteFill>
);
