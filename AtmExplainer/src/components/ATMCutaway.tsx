import React from 'react';
import { COLORS, FONT } from '../theme';
import { CASSETTES, DIVERTER, PICK_Y, REJECT_BIN, SAFE, SENSOR, STACKER, TRANSPORT, type Pt } from '../geometry';
import { CashCassette } from './CashCassette';
import { CashRollers } from './CashRollers';
import { BillTransport } from './BillTransport';
import { CashSensor } from './CashSensor';
import { AnimatedBill, StackedNotes } from './AnimatedBill';
import { Highlight } from './Highlight';

export type HighlightKey = 'cassettes' | 'dispenser' | 'transport' | 'sensor' | 'reject' | 'shutter';

export type BillState = { x: number; y: number; angle: number; opacity?: number; variant?: 'ok' | 'flag' | 'ghost' };

export type ATMCutawayProps = {
  /** Mechanism visibility (fades in with the cutaway). */
  opacity: number;
  cassetteSlide?: [number, number, number];
  cassetteFill?: [number, number, number];
  highlights?: Partial<Record<HighlightKey, number>>;
  /** Rotation of the pick rollers on cassette A, degrees. */
  pickAngle?: number;
  /** Rotation of feed rollers / stacker wheel, degrees. */
  feedAngle?: number;
  /** Belt travel (dash offset) for transport and presenter belts. */
  beltTravel?: number;
  sensorFlash?: number;
  sensorState?: 'ok' | 'flag';
  /** 0 = diverter routes to the stacker, 1 = to the reject area. */
  diverter?: number;
  bills?: BillState[];
  /** Notes gathered in the stacker, and the bundle's vertical travel toward the shutter (negative = up). */
  stackCount?: number;
  stackLift?: number;
  stackClamp?: number;
  rejectNotes?: number;
  pickNudge?: number;
  /** Show labels on the internal parts. */
  partLabels?: number;
};

const vMain: Pt[] = [
  { x: TRANSPORT.x, y: TRANSPORT.bottom },
  { x: TRANSPORT.x, y: TRANSPORT.top + 20 },
];
const toStacker: Pt[] = [
  { x: DIVERTER.x, y: DIVERTER.y },
  { x: STACKER.wheelX - 10, y: DIVERTER.y },
];
const toReject: Pt[] = [
  { x: DIVERTER.x, y: DIVERTER.y },
  { x: REJECT_BIN.x + REJECT_BIN.w / 2, y: DIVERTER.y },
  { x: REJECT_BIN.x + REJECT_BIN.w / 2, y: REJECT_BIN.y + 4 },
];

/** Generic, simplified internals of a cash dispenser inside the ATM safe (educational illustration). */
export const ATMCutaway: React.FC<ATMCutawayProps> = ({
  opacity,
  cassetteSlide = [0, 0, 0],
  cassetteFill = [0.92, 0.7, 0.55],
  highlights = {},
  pickAngle = 0,
  feedAngle = 0,
  beltTravel = 0,
  sensorFlash = 0,
  sensorState = 'ok',
  diverter = 0,
  bills = [],
  stackCount = 0,
  stackLift = 0,
  stackClamp = 0,
  rejectNotes = 0,
  pickNudge = 0,
  partLabels = 0,
}) => {
  const hl = (k: HighlightKey) => highlights[k] ?? 0;
  const presenterPath = (x: number): Pt[] => [
    { x, y: STACKER.stackY + 12 },
    { x, y: 704 },
  ];
  const label = (x: number, y: number, t: string, anchor: 'start' | 'end' | 'middle' = 'start') => (
    <text x={x} y={y} textAnchor={anchor} fontFamily={FONT.sans} fontSize={11} fontWeight={600} fill={COLORS.muted} letterSpacing={1} opacity={partLabels}>
      {t}
    </text>
  );
  return (
    <g opacity={opacity}>
      {/* upper module (behind the fascia): controller and card reader, shown faintly */}
      <g opacity={0.55}>
        <rect x={96} y={455} width={120} height={150} rx={6} fill="#121b2c" stroke="#2f3b52" />
        {Array.from({ length: 6 }).map((_, i) => (
          <rect key={i} x={108} y={470 + i * 20} width={96} height={10} rx={2} fill="#1a2538" />
        ))}
        <text x={156} y={598} textAnchor="middle" fontFamily={FONT.sans} fontSize={10} fill="#6e7d99" letterSpacing={1}>
          CONTROLLER
        </text>
        <rect x={470} y={452} width={140} height={44} rx={5} fill="#121b2c" stroke="#2f3b52" />
        <text x={540} y={510} textAnchor="middle" fontFamily={FONT.sans} fontSize={10} fill="#6e7d99" letterSpacing={1}>
          CARD READER
        </text>
      </g>

      {/* safe body (thick walls) */}
      <rect x={SAFE.x} y={SAFE.y} width={SAFE.w} height={SAFE.h} rx={6} fill="#0c1424" stroke="#3b475d" strokeWidth={8} />
      <rect x={SAFE.x + 8} y={SAFE.y + 8} width={SAFE.w - 16} height={SAFE.h - 16} fill="#0a1120" />
      {/* opening in the safe roof for the presenter */}
      <rect x={292} y={SAFE.y - 6} width={96} height={14} fill="#0a1120" />

      {/* presenter belts (stacker → shutter) */}
      <BillTransport path={presenterPath(292)} travel={beltTravel} width={10} highlight={hl('shutter')} showRollers={false} />
      <BillTransport path={presenterPath(388)} travel={beltTravel} width={10} highlight={hl('shutter')} showRollers={false} />

      {/* transport paths */}
      <BillTransport path={vMain} travel={beltTravel} highlight={hl('transport')} />
      {CASSETTES.map((c, i) => (
        <BillTransport
          key={c.id}
          path={[
            { x: 408, y: PICK_Y(i) - 4 },
            { x: TRANSPORT.x, y: PICK_Y(i) - 4 },
          ]}
          travel={beltTravel}
          width={16}
          highlight={hl('transport')}
          showRollers={false}
        />
      ))}
      <BillTransport path={toStacker} travel={beltTravel} width={16} highlight={hl('transport')} showRollers={false} />
      <BillTransport path={toReject} travel={diverter > 0.5 ? beltTravel : 0} width={16} highlight={Math.max(hl('transport'), hl('reject') * 0.6)} showRollers={false} />

      {/* feed roller pairs along the vertical transport */}
      {[960, 900, 840].map((y) => (
        <CashRollers key={y} cx={TRANSPORT.x} cy={y} r={7} angle={feedAngle} vertical gap={14} />
      ))}

      {/* reject / retract area */}
      <rect x={REJECT_BIN.x} y={REJECT_BIN.y} width={REJECT_BIN.w} height={REJECT_BIN.h} rx={5} fill="#1c2638" stroke="#55627a" strokeWidth={2} />
      <rect x={REJECT_BIN.x + 5} y={REJECT_BIN.y + 22} width={REJECT_BIN.w - 10} height={REJECT_BIN.h - 27} rx={3} fill="#0e1524" />
      {Array.from({ length: rejectNotes }).map((_, i) => (
        <rect key={i} x={REJECT_BIN.x + 14} y={REJECT_BIN.y + REJECT_BIN.h - 12 - i * 5} width={REJECT_BIN.w - 28} height={4} rx={1} fill={COLORS.red} opacity={0.85} />
      ))}
      <text x={REJECT_BIN.x + REJECT_BIN.w / 2} y={REJECT_BIN.y + 15} textAnchor="middle" fontFamily={FONT.sans} fontWeight={700} fontSize={9.5} fill={COLORS.amber} letterSpacing={0.8}>
        REJECT / RETRACT
      </text>
      <Highlight x={REJECT_BIN.x} y={REJECT_BIN.y} w={REJECT_BIN.w} h={REJECT_BIN.h} level={hl('reject')} />

      {/* cassettes */}
      {CASSETTES.map((c, i) => (
        <CashCassette
          key={c.id}
          x={c.x}
          y={c.y}
          w={c.w}
          h={c.h}
          denom={c.denom}
          label={`CASSETTE ${c.id}`}
          fill={cassetteFill[i]}
          slideX={cassetteSlide[i]}
          highlight={hl('cassettes')}
          pickNudge={i === 0 ? pickNudge : 0}
        />
      ))}

      {/* pick rollers at the pick end of each cassette */}
      {CASSETTES.map((c, i) => (
        <CashRollers key={c.id} cx={412} cy={PICK_Y(i) - 4} r={8} gap={7} angle={i === 0 ? pickAngle : 0} highlight={hl('dispenser') > 0.3 ? 1 : 0} />
      ))}
      <Highlight x={384} y={CASSETTES[0].y - 12} w={110} h={CASSETTES[2].y + CASSETTES[2].h - CASSETTES[0].y + 20} level={hl('dispenser')} />

      {/* sensor gate */}
      <CashSensor cx={SENSOR.x} cy={SENSOR.y} flash={sensorFlash} state={sensorState} highlight={hl('sensor')} />

      {/* diverter gate */}
      <g transform={`rotate(${-35 + diverter * 70} ${DIVERTER.x} ${DIVERTER.y})`}>
        <path d={`M${DIVERTER.x - 2},${DIVERTER.y} L${DIVERTER.x - 18},${DIVERTER.y - 5} L${DIVERTER.x - 18},${DIVERTER.y + 5} Z`} fill={COLORS.amber} />
      </g>
      <circle cx={DIVERTER.x} cy={DIVERTER.y} r={4} fill="#c9d1dc" />

      {/* stacker wheel */}
      <g transform={`rotate(${feedAngle * 0.6} ${STACKER.wheelX} ${STACKER.wheelY})`}>
        <circle cx={STACKER.wheelX} cy={STACKER.wheelY} r={15} fill="#1c2638" stroke="#7c879a" strokeWidth={2} />
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <path
              key={i}
              d={`M${STACKER.wheelX + Math.cos(a) * 5},${STACKER.wheelY + Math.sin(a) * 5} Q${STACKER.wheelX + Math.cos(a + 0.5) * 14},${STACKER.wheelY + Math.sin(a + 0.5) * 14} ${STACKER.wheelX + Math.cos(a + 0.9) * 19},${STACKER.wheelY + Math.sin(a + 0.9) * 19}`}
              stroke="#9aa6b8"
              strokeWidth={2}
              fill="none"
            />
          );
        })}
      </g>
      {/* stacking platform */}
      <rect x={STACKER.stackX - 44} y={STACKER.stackY + 4} width={88} height={6} rx={2} fill="#55627a" />

      {/* gathered bundle (moves up the presenter) */}
      <g transform={`translate(0 ${stackLift})`}>
        <StackedNotes x={STACKER.stackX} y={STACKER.stackY} count={stackCount} clamp={stackClamp} />
      </g>

      {/* notes in flight */}
      {bills.map((b, i) => (
        <AnimatedBill key={i} x={b.x} y={b.y} angle={b.angle} opacity={b.opacity ?? 1} variant={b.variant} length={44} />
      ))}

      {/* small part labels */}
      <g transform={`rotate(-90 ${TRANSPORT.x + 27} 935)`}>{label(TRANSPORT.x + 27, 935, 'TRANSPORT', 'middle')}</g>
      {label(SENSOR.x - 38, SENSOR.y - 7, 'SENSOR', 'end')}
      {label(STACKER.stackX, STACKER.stackY + 24, 'STACKER', 'middle')}
      {label(282, 752, 'PRESENTER', 'end')}
    </g>
  );
};
