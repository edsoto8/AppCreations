import type { ReactNode } from 'react';

/** Small inline SVG diagrams for the engineering/education panel (viewBox 360×150, CSS-themed). */

const W = 360;
const H = 150;

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg className="edu-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <marker id="edu-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="fill-accent" />
        </marker>
        <marker id="edu-arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="fill-warn" />
        </marker>
        <pattern id="edu-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="stroke-error" strokeWidth="2" />
        </pattern>
      </defs>
      {children}
    </svg>
  );
}

export function DiffDriveDiagram() {
  return (
    <Frame label="Differential drive: two wheels with speeds vL and vR rotating about the instantaneous centre of rotation">
      <circle cx="110" cy="75" r="46" className="shape" />
      <rect x="96" y="22" width="28" height="10" rx="3" className="shape-strong" />
      <rect x="96" y="118" width="28" height="10" rx="3" className="shape-strong" />
      <line x1="110" y1="27" x2="170" y2="27" className="stroke-accent" strokeWidth="2.5" markerEnd="url(#edu-arrow)" />
      <line x1="110" y1="123" x2="146" y2="123" className="stroke-accent" strokeWidth="2.5" markerEnd="url(#edu-arrow)" />
      <text x="176" y="31" className="t-accent">vL</text>
      <text x="152" y="127" className="t-accent">vR</text>
      <line x1="84" y1="27" x2="84" y2="123" className="stroke-dim" strokeDasharray="3 3" />
      <text x="62" y="79" className="t-dim">L</text>
      <line x1="110" y1="75" x2="160" y2="75" className="stroke-warn" strokeWidth="2.5" markerEnd="url(#edu-arrow-amber)" />
      <text x="140" y="68" className="t-warn">v</text>
      <text x="208" y="44" className="t-main">v = (vR + vL) / 2</text>
      <text x="208" y="68" className="t-main">ω = (vR − vL) / L</text>
      <text x="208" y="96" className="t-dim">L = 0.235 m</text>
      <text x="208" y="114" className="t-dim">vR &lt; vL → turns right</text>
    </Frame>
  );
}

export function OdometryDiagram() {
  return (
    <Frame label="Pose integration: x, y and heading theta advance each time step">
      <path d="M30 120 C 90 120, 120 60, 190 50 S 280 40, 300 30" className="stroke-dim" fill="none" strokeDasharray="4 4" />
      {[
        [30, 120, 0],
        [110, 88, -40],
        [190, 50, -12],
        [270, 38, -8],
      ].map(([x, y, a], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${a})`}>
          <circle r="11" className="shape" />
          <line x1="0" y1="0" x2="16" y2="0" className="stroke-accent" strokeWidth="2" markerEnd="url(#edu-arrow)" />
        </g>
      ))}
      <text x="20" y="20" className="t-main">x ← x + v·cos θ·Δt</text>
      <text x="20" y="40" className="t-main">y ← y + v·sin θ·Δt</text>
      <text x="20" y="60" className="t-main">θ ← θ + ω·Δt</text>
      <text x="170" y="140" className="t-dim">Δt = 20 ms fixed step</text>
    </Frame>
  );
}

export function LidarDiagram() {
  const rays = Array.from({ length: 28 }, (_, i) => (i / 28) * Math.PI * 2);
  const cx = 100;
  const cy = 78;
  const range = (a: number) => {
    // A rectangular room 200×120 around (cx, cy) with a box obstacle.
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const tx = dx > 0 ? (190 - cx) / dx : dx < 0 ? (12 - cx) / dx : Infinity;
    const ty = dy > 0 ? (140 - cy) / dy : dy < 0 ? (12 - cy) / dy : Infinity;
    let t = Math.min(tx, ty);
    // box at x 140..165, y 30..55
    for (const [x0, x1, y0, y1] of [[140, 165, 30, 55]]) {
      const t1 = (x0 - cx) / dx;
      const t2 = (x1 - cx) / dx;
      const t3 = (y0 - cy) / dy;
      const t4 = (y1 - cy) / dy;
      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
      if (tmax >= tmin && tmin > 0) t = Math.min(t, tmin);
    }
    return t;
  };
  return (
    <Frame label="LiDAR scan: rays from the spinning sensor end at walls and obstacles">
      <rect x="12" y="12" width="178" height="128" className="shape" fill="none" />
      <rect x="140" y="30" width="25" height="25" className="shape-strong" />
      {rays.map((a, i) => {
        const r = range(a);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="stroke-accent ray" />
            <circle cx={x} cy={y} r="2.2" className="fill-warn" />
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="8" className="shape-strong" />
      <text x="204" y="34" className="t-main">5 Hz × 360 samples</text>
      <text x="204" y="52" className="t-main">= 1800 rays/s</text>
      <text x="204" y="78" className="t-dim">range 6 m, σ 8 mm</text>
      <text x="204" y="96" className="t-dim">1% dropouts</text>
      <text x="204" y="122" className="t-warn">● hit points</text>
    </Frame>
  );
}

export function LidarPlaneDiagram() {
  return (
    <Frame label="Side view: the LiDAR plane at 9 cm misses low objects such as socks and cables">
      <line x1="10" y1="130" x2="310" y2="130" className="stroke-dim" />
      <rect x="30" y="104" width="64" height="20" rx="8" className="shape-strong" />
      <rect x="56" y="96" width="16" height="8" rx="2" className="shape-strong" />
      <line x1="72" y1="100" x2="310" y2="100" className="stroke-accent" strokeDasharray="5 4" />
      <text x="200" y="94" className="t-accent">LiDAR plane ≈ 9 cm</text>
      <rect x="140" y="124" width="34" height="6" rx="2" className="fill-warn" />
      <text x="124" y="146" className="t-warn">sock (3 cm) — unseen</text>
      <rect x="240" y="56" width="10" height="74" className="shape" />
      <rect x="220" y="50" width="80" height="8" className="shape" />
      <circle cx="240" cy="100" r="3" className="fill-warn" />
      <text x="214" y="40" className="t-dim">table: only legs hit</text>
      <path d="M94 122 q 20 -6 40 0" className="stroke-warn" fill="none" />
      <text x="20" y="30" className="t-main">Front structured-light sensor</text>
      <text x="20" y="48" className="t-main">+ bumper cover the gap</text>
    </Frame>
  );
}

export function LogOddsDiagram() {
  const cells = 9;
  return (
    <Frame label="Log-odds update: cells crossed by a ray become more free, the end cell more occupied">
      {Array.from({ length: cells }, (_, i) => (
        <g key={i}>
          <rect x={20 + i * 30} y={50} width={28} height={28} rx="3" className={i === cells - 1 ? 'cell-occ' : 'cell-free'} />
          <text x={34 + i * 30} y={69} textAnchor="middle" className={i === cells - 1 ? 't-warn' : 't-accent'}>
            {i === cells - 1 ? '+0.85' : '−0.4'}
          </text>
        </g>
      ))}
      <line x1="10" y1="64" x2={20 + (cells - 1) * 30 + 14} y2="64" className="stroke-accent" strokeWidth="1.5" strokeOpacity="0.5" markerEnd="url(#edu-arrow)" />
      <text x="20" y="20" className="t-main">l = log(p / (1 − p))</text>
      <text x="20" y="38" className="t-main">l ← clamp(l + Δl, −2, 3.5)</text>
      <text x="20" y="108" className="t-dim">free: l &lt; −0.3</text>
      <text x="130" y="108" className="t-dim">unknown: between</text>
      <text x="250" y="108" className="t-dim">occ: l &gt; 0.6</text>
      <text x="20" y="134" className="t-dim">traversed cells (DDA) → miss · endpoint → hit</text>
    </Frame>
  );
}

export function CostmapDiagram() {
  return (
    <Frame label="Costmap inflation: lethal wall, inscribed band equal to the robot radius, then decaying cost">
      <rect x="20" y="20" width="26" height="110" className="cell-occ" />
      <rect x="46" y="20" width="40" height="110" className="band-inscribed" />
      <rect x="86" y="20" width="90" height="110" className="band-graded" />
      <circle cx="106" cy="75" r="20" className="shape" fill="none" strokeDasharray="3 3" />
      <circle cx="106" cy="75" r="2.5" className="fill-accent" />
      <text x="24" y="146" className="t-dim">lethal</text>
      <text x="48" y="146" className="t-dim">inscribed</text>
      <text x="108" y="146" className="t-dim">graded → 0</text>
      <text x="190" y="40" className="t-main">r = 0.175 m (+1.5 cm)</text>
      <text x="190" y="60" className="t-main">decay to 0.45 m</text>
      <text x="190" y="88" className="t-dim">planner treats the robot</text>
      <text x="190" y="104" className="t-dim">as a point on this map</text>
    </Frame>
  );
}

export function AStarDiagram() {
  const open = [
    [3, 1],
    [3, 2],
    [3, 3],
    [2, 3],
  ];
  const closed = [
    [1, 2],
    [2, 1],
    [2, 2],
    [1, 1],
    [1, 3],
  ];
  const wall = [
    [4, 0],
    [4, 1],
    [4, 2],
  ];
  const s = 22;
  const ox = 16;
  const oy = 16;
  const cell = (c: number[], cls: string, k: string) => <rect key={k} x={ox + c[0] * s} y={oy + c[1] * s} width={s - 2} height={s - 2} rx="3" className={cls} />;
  return (
    <Frame label="A star search on a grid: closed set, open frontier, wall, and the resulting path">
      {Array.from({ length: 6 * 8 }, (_, k) => cell([k % 8, Math.floor(k / 8)], 'cell-free', `g${k}`))}
      {closed.map((c, i) => cell(c, 'cell-closed', `c${i}`))}
      {open.map((c, i) => cell(c, 'cell-open', `o${i}`))}
      {wall.map((c, i) => cell(c, 'cell-occ', `w${i}`))}
      <polyline points={`${ox + 1 * s + 10},${oy + 2 * s + 10} ${ox + 3 * s + 10},${oy + 4 * s + 10} ${ox + 5 * s + 10},${oy + 4 * s + 10} ${ox + 6 * s + 10},${oy + 1 * s + 10}`} className="stroke-accent" strokeWidth="2.5" fill="none" strokeDasharray="5 3" />
      <circle cx={ox + 1 * s + 10} cy={oy + 2 * s + 10} r="5" className="fill-accent" />
      <circle cx={ox + 6 * s + 10} cy={oy + 1 * s + 10} r="5" className="fill-warn" />
      <text x="200" y="34" className="t-main">f(n) = g(n) + h(n)</text>
      <text x="200" y="56" className="t-dim">g: cost so far</text>
      <text x="200" y="72" className="t-dim">h: octile distance</text>
      <rect x="200" y="88" width="10" height="10" className="cell-closed" />
      <text x="216" y="97" className="t-dim">closed</text>
      <rect x="260" y="88" width="10" height="10" className="cell-open" />
      <text x="276" y="97" className="t-dim">open</text>
      <text x="200" y="124" className="t-dim">step = len × (1 + 3·c/252)</text>
    </Frame>
  );
}

export function CoverageDiagram() {
  const lanes = 7;
  const x0 = 24;
  const x1 = 176;
  const pts: string[] = [];
  for (let i = 0; i < lanes; i++) {
    const y = 26 + i * 17;
    if (i % 2 === 0) pts.push(`${x0},${y} ${x1},${y}`);
    else pts.push(`${x1},${y} ${x0},${y}`);
  }
  return (
    <Frame label="Boustrophedon coverage: an edge pass along the walls followed by back-and-forth lanes">
      <rect x="14" y="16" width="172" height="122" rx="4" className="stroke-warn" fill="none" strokeWidth="2" strokeDasharray="6 3" />
      <polyline points={pts.join(' ')} className="stroke-accent" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <rect x="110" y="56" width="34" height="26" className="shape-strong" />
      <text x="200" y="34" className="t-warn">1 · edge pass</text>
      <text x="200" y="54" className="t-accent">2 · lanes, 0.20 m apart</text>
      <text x="200" y="74" className="t-main">3 · touch-up missed cells</text>
      <text x="200" y="104" className="t-dim">obstacles split lanes</text>
      <text x="200" y="120" className="t-dim">into separate runs</text>
    </Frame>
  );
}

export function CliffDiagram() {
  return (
    <Frame label="Cliff sensor: an infrared emitter and receiver look down; no reflection means a drop-off">
      <line x1="10" y1="110" x2="170" y2="110" className="stroke-dim" strokeWidth="2" />
      <line x1="170" y1="110" x2="170" y2="146" className="stroke-dim" strokeWidth="2" />
      <line x1="170" y1="146" x2="310" y2="146" className="stroke-dim" strokeWidth="2" />
      <rect x="110" y="70" width="90" height="24" rx="10" className="shape-strong" />
      <line x1="130" y1="94" x2="140" y2="110" className="stroke-accent" strokeWidth="2" />
      <line x1="140" y1="110" x2="150" y2="94" className="stroke-accent" strokeWidth="2" strokeDasharray="3 2" />
      <line x1="182" y1="94" x2="196" y2="146" className="stroke-error" strokeWidth="2" />
      <text x="96" y="62" className="t-accent">rear: echo ✓</text>
      <text x="196" y="88" className="t-error">front: no echo → STOP</text>
      <text x="16" y="30" className="t-main">6 IR cliff sensors (4 front, 2 rear)</text>
      <text x="16" y="48" className="t-dim">LiDAR can&rsquo;t see a stair edge</text>
    </Frame>
  );
}

export function DockingDiagram() {
  return (
    <Frame label="Docking: navigate to an approach point 0.5 m in front of the dock, align, then reverse straight onto the contacts">
      <rect x="250" y="30" width="50" height="96" rx="6" className="shape-strong" />
      <rect x="244" y="66" width="6" height="8" className="fill-warn" />
      <rect x="244" y="82" width="6" height="8" className="fill-warn" />
      <path d="M 240 78 L 150 50 M 240 78 L 150 106" className="stroke-warn" strokeOpacity="0.5" strokeDasharray="3 3" />
      <circle cx="150" cy="78" r="5" className="fill-accent" />
      <text x="118" y="70" className="t-accent">approach</text>
      <path d="M 30 130 C 70 130, 90 78, 145 78" className="stroke-dim" fill="none" strokeDasharray="4 4" />
      <line x1="160" y1="78" x2="226" y2="78" className="stroke-accent" strokeWidth="2.5" markerEnd="url(#edu-arrow)" />
      <circle cx="30" cy="130" r="10" className="shape" />
      <text x="12" y="24" className="t-main">A* → align on dock axis →</text>
      <text x="12" y="42" className="t-main">slow straight approach</text>
      <text x="200" y="146" className="t-warn">charging contacts</text>
    </Frame>
  );
}

export function SuctionDiagram() {
  return (
    <Frame label="Suction path: side brush feeds debris to the roller brush, the fan pulls air through the dustbin and filter">
      <circle cx="150" cy="75" r="62" className="shape" />
      <rect x="110" y="96" width="80" height="16" rx="8" className="shape-strong" />
      <text x="120" y="130" className="t-dim">roller brush</text>
      <circle cx="210" cy="40" r="18" className="stroke-violet" fill="none" strokeDasharray="4 3" />
      <text x="232" y="34" className="t-violet">side brush</text>
      <rect x="118" y="40" width="64" height="34" rx="6" className="shape-strong" />
      <text x="128" y="61" className="t-main">dustbin</text>
      <path d="M150 96 V 76" className="stroke-accent" strokeWidth="2.5" markerEnd="url(#edu-arrow)" />
      <path d="M182 56 H 220" className="stroke-accent" strokeWidth="2.5" markerEnd="url(#edu-arrow)" />
      <text x="226" y="60" className="t-accent">fan</text>
      <text x="10" y="22" className="t-main">removed = dirt × η</text>
      <text x="10" y="40" className="t-dim">η = 0.72 · surface</text>
      <text x="10" y="56" className="t-dim">· suction · speed · bin</text>
    </Frame>
  );
}

export function MopWashDiagram() {
  const stages = ['Auto-empty', 'Mop wash', 'Refill', 'Dry'];
  return (
    <Frame label="Dock maintenance cycle: dust extraction, mop washing, water refill, hot-air drying">
      {stages.map((s, i) => (
        <g key={s}>
          <rect x={14 + i * 76} y={44} width={66} height={40} rx="8" className={i === 1 ? 'shape-accent' : 'shape-strong'} />
          <text x={47 + i * 76} y={69} textAnchor="middle" className={i === 1 ? 't-accent' : 't-main'}>
            {s}
          </text>
          {i < stages.length - 1 && <line x1={80 + i * 76} y1={64} x2={90 + i * 76} y2={64} className="stroke-dim" markerEnd="url(#edu-arrow)" />}
        </g>
      ))}
      <text x="14" y="28" className="t-main">On docking, only the requested phases run:</text>
      <text x="14" y="110" className="t-dim">clean tank → pads scrubbed on a ribbed tray</text>
      <text x="14" y="128" className="t-dim">dirty water pumped into the dirty tank</text>
    </Frame>
  );
}
