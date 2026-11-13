import type { ReactNode } from 'react';
import type { UiState } from '../../app/store';
import type { CameraMode, EduTopic, Overlays } from '../../app/types';
import { ROBOT } from '../../sim/robot/robotSpec';
import type { Telemetry } from '../../sim/telemetry';
import { fmtCount, fmtPct, fmtRange, humanize, toDeg, wheelSpeeds } from '../format';
import type { IconName } from '../icons';
import { DOCK_PHASE_LABEL } from '../labels';
import {
  AStarDiagram,
  CliffDiagram,
  CostmapDiagram,
  CoverageDiagram,
  DiffDriveDiagram,
  DockingDiagram,
  LidarDiagram,
  LidarPlaneDiagram,
  LogOddsDiagram,
  MopWashDiagram,
  OdometryDiagram,
  SuctionDiagram,
} from './diagrams';

export interface EduStep {
  title: string;
  body: ReactNode;
  diagram?: ReactNode;
}

export interface EduTopicDef {
  id: EduTopic;
  title: string;
  /** Short name for the topic picker. */
  short: string;
  icon: IconName;
  summary: string;
  steps: EduStep[];
  /** Live values from telemetry (label, value). */
  live: (t: Telemetry) => Array<[string, string]>;
  showMe: { camera: CameraMode; overlays?: Partial<Overlays>; extra?: Partial<UiState>; label: string };
  /** What this simulation simplifies for this topic. */
  simplifications: string[];
}

const f2 = (v: number) => v.toFixed(2);

export const EDU_TOPICS: Record<EduTopic, EduTopicDef> = {
  differentialDrive: {
    id: 'differentialDrive',
    title: 'Differential drive',
    short: 'Diff drive',
    icon: 'robot',
    summary: 'How two independently driven wheels move and steer the robot.',
    steps: [
      {
        title: 'Two wheels, one axle',
        body: (
          <p>
            The robot has two driven wheels on a common axle plus passive casters. It has no steering: it turns by driving the wheels at <em>different</em> speeds. The body&rsquo;s forward speed
            is the average of the wheel speeds and the turn rate is their difference divided by the wheel base <var>L</var>.
          </p>
        ),
        diagram: <DiffDriveDiagram />,
      },
      {
        title: 'Inverse kinematics',
        body: (
          <p>
            The navigator outputs a desired body velocity (<var>v</var>, <var>ω</var>). The drive converts it to wheel speeds: <code>vR = v + ω·L/2</code>, <code>vL = v − ω·L/2</code>. With{' '}
            <code>vR = −vL</code> the robot spins in place — which is why a round robot can always rotate out of a tight spot.
          </p>
        ),
      },
      {
        title: 'Integrating the pose',
        body: (
          <p>
            Every 20 ms simulation step the pose is advanced with the unicycle model. Real robots estimate this from wheel encoders (odometry) and an IMU, which drift; they correct the
            drift by matching LiDAR scans against the map (SLAM).
          </p>
        ),
        diagram: <OdometryDiagram />,
      },
      {
        title: 'Limits & surfaces',
        body: (
          <p>
            Commands are rate-limited (linear acceleration 0.8 m/s², angular 6 rad/s²) and the speed is capped. Carpet adds rolling resistance (drag ×1.3), so the same command produces
            less speed and more drive power — watch the drive share in the Power card when the robot crosses a rug.
          </p>
        ),
      },
    ],
    live: (t) => {
      const w = wheelSpeeds(t.velocity.v, t.velocity.w, ROBOT.wheelBase);
      return [
        ['v', `${f2(t.velocity.v)} m/s`],
        ['ω', `${f2(t.velocity.w)} rad/s`],
        ['vL / vR', `${f2(w.left)} / ${f2(w.right)} m/s`],
        ['Heading θ', `${toDeg(t.pose.theta).toFixed(0)}°`],
        ['Drive power', `${t.power.drive.toFixed(1)} W`],
        ['Surface', t.sensors.surface],
      ];
    },
    showMe: { camera: 'orbit', overlays: { trail: true, path: true }, label: 'Orbit camera + trail' },
    simplifications: ['Perfect localisation: the robot knows its true pose (no odometry drift or SLAM).', 'Wheel slip is modelled only as small noise.'],
  },

  lidar: {
    id: 'lidar',
    title: 'LiDAR sensing',
    short: 'LiDAR',
    icon: 'scan',
    summary: 'A spinning laser rangefinder measures distances all around the robot.',
    steps: [
      {
        title: 'A spinning rangefinder',
        body: (
          <p>
            The turret on top spins at 5 Hz and takes 360 range samples per revolution — 1 800 measurements per second, out to 6 m. Consumer units measure range by laser triangulation or
            time-of-flight (<code>d = c·Δt / 2</code>).
          </p>
        ),
        diagram: <LidarDiagram />,
      },
      {
        title: 'From ranges to points',
        body: (
          <p>
            A return at range <var>r</var> and bearing <var>φ</var> becomes a world point <code>(x + r·cos(θ+φ), y + r·sin(θ+φ))</code>. Accumulated points form the point cloud you can
            toggle in the View tab; each ray also feeds the occupancy map.
          </p>
        ),
      },
      {
        title: 'Noise and dropouts',
        body: (
          <p>
            Every range gets Gaussian noise (σ = 8 mm) and 1% of returns are lost. A lost return carries <em>no</em> information — it must not be treated as free space, or the map would
            develop holes through solid objects.
          </p>
        ),
      },
      {
        title: 'What it cannot see',
        body: (
          <p>
            The scan is a single horizontal plane about 9 cm above the floor. Socks, cables and pet bowls are below it; tables show up only as legs. That&rsquo;s why the robot also carries a
            forward structured-light sensor and a bumper, and why obstacles you drop can surprise it.
          </p>
        ),
        diagram: <LidarPlaneDiagram />,
      },
    ],
    live: (t) => [
      ['Rate', t.sensors.lidarSpinning ? `${fmtCount(t.sensors.lidarRate)} rays/s` : 'stopped'],
      ['Total rays', fmtCount(t.sensors.lidarRays)],
      ['Front sensor', fmtRange(t.sensors.frontNearest)],
      ['Mapped area', `${t.sensors.mapKnownArea.toFixed(1)} m²`],
      ['LiDAR power', `${t.power.lidar.toFixed(1)} W`],
    ],
    showMe: { camera: 'lidar', overlays: { lidarRays: true, pointCloud: true }, label: 'LiDAR view + rays' },
    simplifications: ['A 2D scan plane with ideal ray casting against geometry.', 'No motion distortion, multipath or reflective/black-surface effects (only random dropouts).'],
  },

  occupancy: {
    id: 'occupancy',
    title: 'Occupancy mapping',
    short: 'Mapping',
    icon: 'map',
    summary: 'Turning noisy range readings into a probabilistic grid map.',
    steps: [
      {
        title: 'A grid of beliefs',
        body: (
          <p>
            The house is divided into 5 cm cells. Each stores the <em>log-odds</em> that it is occupied, <code>l = log(p/(1−p))</code>. Unknown cells start at <code>l = 0</code> (p = 0.5). The
            2D map in this dashboard draws exactly this belief — not the true house.
          </p>
        ),
      },
      {
        title: 'Bayesian update by addition',
        body: (
          <p>
            In log-odds, Bayes&rsquo; rule becomes addition. Cells a ray passes through get <code>−0.4</code> (evidence of free space); the cell where it ends on an obstacle gets{' '}
            <code>+0.85</code>. Values are clamped to [−2, 3.5] so the map can still change when furniture moves.
          </p>
        ),
        diagram: <LogOddsDiagram />,
      },
      {
        title: 'Extra layers',
        body: (
          <p>
            Things the LiDAR can&rsquo;t see are added from other sensors: bumper hits and front-sensor detections (low obstacles, cleared again when seen empty), cliff triggers (permanent),
            and the floor type learned by the downward carpet sensor.
          </p>
        ),
      },
      {
        title: 'The costmap',
        body: (
          <p>
            For planning, obstacles are inflated by the robot radius: cells closer than 17.5 cm (+1.5 cm margin) to an obstacle are forbidden for the robot&rsquo;s <em>centre</em>, and cost
            decays exponentially out to 45 cm so paths prefer to stay clear of walls. No-go zones are lethal in the costmap.
          </p>
        ),
        diagram: <CostmapDiagram />,
      },
    ],
    live: (t) => [
      ['Mapped area', `${t.sensors.mapKnownArea.toFixed(1)} m²`],
      ['Rays integrated', fmtCount(t.sensors.lidarRays)],
      ['Bumps → map', String(t.sensors.bumps)],
      ['Cliff events', String(t.sensors.cliffEvents)],
      ['Replans', String(t.nav.replans)],
    ],
    showMe: { camera: 'topDown', overlays: { costmap: true, pointCloud: true }, label: 'Top-down + costmap' },
    simplifications: ['The map is built at the true robot pose (no SLAM pose error).', 'Fixed log-odds increments instead of a full sensor model.'],
  },

  astar: {
    id: 'astar',
    title: 'A* path planning',
    short: 'A* planning',
    icon: 'target',
    summary: 'Finding a short, safe path across the costmap.',
    steps: [
      {
        title: 'Best-first with a heuristic',
        body: (
          <p>
            A* expands grid cells in order of <code>f = g + h</code>: <var>g</var> is the cost of the best path found so far, <var>h</var> an optimistic estimate of the remaining cost (octile
            distance on an 8-connected grid). Because <var>h</var> never over-estimates, the first time the goal is popped the path is optimal.
          </p>
        ),
        diagram: <AStarDiagram />,
      },
      {
        title: 'Cost-aware steps',
        body: (
          <p>
            Each step costs its length × <code>(1 + 3·cost/252)</code>, so a path through the graded band near walls is &ldquo;longer&rdquo; than one down the middle of a corridor. Inscribed and
            lethal cells are impassable; unknown cells are allowed only while exploring.
          </p>
        ),
      },
      {
        title: 'Smoothing and following',
        body: (
          <p>
            The raw cell path is shortened by line-of-sight checks, then tracked with <em>pure pursuit</em>: steer toward a look-ahead point on the path. If the heading error is large the robot
            first rotates in place.
          </p>
        ),
      },
      {
        title: 'Replanning & recovery',
        body: (
          <p>
            The remaining path is re-validated against the live costmap. When a new obstacle blocks it, the navigator plans a detour around the blockage or a fresh path; if progress stalls it
            runs recovery behaviours (back up, rotate, escape toward the most open LiDAR direction). Try &ldquo;Drop obstacle on robot path&rdquo;.
          </p>
        ),
      },
    ],
    live: (t) => [
      ['Target', t.target],
      ['Nav state', humanize(t.nav.state)],
      ['Replans', String(t.nav.replans)],
      ['Recovery', t.nav.recovery ? humanize(t.nav.recovery) : 'none'],
      ['Last event', t.nav.lastEvent ?? '—'],
    ],
    showMe: { camera: 'topDown', overlays: { path: true, costmap: true, trail: false }, label: 'Top-down + path + costmap' },
    simplifications: ['Planning runs on a static snapshot of the costmap every replan interval.', 'No dynamic-obstacle velocity prediction.'],
  },

  coverage: {
    id: 'coverage',
    title: 'Coverage path choice',
    short: 'Coverage',
    icon: 'layers',
    summary: 'Why the robot cleans in neat lanes instead of bouncing randomly.',
    steps: [
      {
        title: 'Edges first',
        body: (
          <p>
            Whole-house and room missions start with an edge pass that follows the walls at a small gap, so the side brush can sweep debris out of the corners and skirting where lanes
            can&rsquo;t reach.
          </p>
        ),
        diagram: <CoverageDiagram />,
      },
      {
        title: 'Boustrophedon lanes',
        body: (
          <p>
            The free area of each room is swept in parallel &ldquo;ox-plough&rdquo; lanes 20 cm apart (narrower than the 22 cm brush, so lanes overlap). Obstacles split lanes into runs; runs that
            line up are chained into sweeps and visited nearest-first to minimise transit.
          </p>
        ),
      },
      {
        title: 'Touch-ups and passes',
        body: (
          <p>
            After the lanes, cells inside the target region that were never covered are found from the coverage grid and visited in a touch-up phase. With 2–3 passes the plan is repeated,
            which removes more of the remaining dirt each time.
          </p>
        ),
      },
      {
        title: 'Why not random?',
        body: (
          <p>
            Early robots bounced randomly: simple, but coverage grows slowly and corners get missed. A mapped, systematic plan reaches high coverage in roughly one pass worth of travel and can
            estimate its remaining time (the ETA in the Cleaning card).
          </p>
        ),
      },
    ],
    live: (t) => [
      ['Coverage', `${t.coverage.toFixed(1)}%`],
      ['Area', `${t.areaCleaned.toFixed(1)} / ${t.coverageTarget.toFixed(0)} m²`],
      ['Tasks', t.mission ? `${t.mission.tasksDone} / ${t.mission.tasksPlanned}` : '—'],
      ['Pass', t.mission ? `${t.mission.pass} / ${t.mission.passes}` : '—'],
      ['Phase', t.mission ? humanize(t.mission.phase) : '—'],
    ],
    showMe: { camera: 'topDown', overlays: { coverage: true, path: true, trail: true }, label: 'Top-down + coverage' },
    simplifications: ['Coverage is measured against an evaluation-only reachable floor mask.', 'Cleaning efficiency is applied once per footprint pass per cell.'],
  },

  cliff: {
    id: 'cliff',
    title: 'Cliff sensors',
    short: 'Cliff sensors',
    icon: 'alert',
    summary: 'Not falling down the stairs.',
    steps: [
      {
        title: 'Looking down',
        body: (
          <p>
            Six infrared emitter/receiver pairs under the chassis (four at the front, two at the rear) look at the floor. A normal floor reflects the beam back; over a drop-off the reflection
            disappears.
          </p>
        ),
        diagram: <CliffDiagram />,
      },
      {
        title: 'React first, then remember',
        body: (
          <p>
            A trigger immediately stops forward motion and backs the robot away. The drop-off position is written into the map&rsquo;s cliff layer, which is lethal in the costmap, so later paths
            avoid it.
          </p>
        ),
      },
      {
        title: 'Why LiDAR isn’t enough',
        body: (
          <p>
            A stairwell has no wall at LiDAR height — the scan sees straight across it. Only the downward sensors can detect it. Real cliff sensors can also be fooled by very dark carpets (which
            absorb IR); this simulation does not model that.
          </p>
        ),
      },
    ],
    live: (t) => [
      ['Cliff now', t.sensors.cliffNow ? 'DROP-OFF' : 'floor'],
      ['Cliff events', String(t.sensors.cliffEvents)],
      ['Bumper', t.sensors.bumper ? 'pressed' : 'released'],
      ['Bumps', String(t.sensors.bumps)],
    ],
    showMe: { camera: 'follow', overlays: { sensors: true }, label: 'Follow cam + sensors' },
    simplifications: ['Cliffs are ideal rectangles; no false triggers on dark floors.', 'Wheel-drop switches are not modelled.'],
  },

  docking: {
    id: 'docking',
    title: 'Automatic docking',
    short: 'Docking',
    icon: 'dock',
    summary: 'Finding the way home and landing on the charging contacts.',
    steps: [
      {
        title: 'When to go home',
        body: (
          <p>
            The robot heads back when the mission ends, when you press Dock, or mid-mission when the battery drops below 20% (or what it needs to get home), the dustbin fills or water runs out.
            After recharging to 80% it returns and resumes where it left off.
          </p>
        ),
      },
      {
        title: 'Approach point',
        body: (
          <p>
            It plans with A* to an approach pose 0.5 m in front of the dock, rotates to line up with the dock axis (real docks help with IR beacons), and drives the last stretch slowly and
            straight until the contacts touch.
          </p>
        ),
        diagram: <DockingDiagram />,
      },
      {
        title: 'Charging',
        body: (
          <p>
            Once docked the battery charges at a constant 90 W into a 30 Wh demo pack (deliberately small so recharge-and-resume shows up in a whole-home run). Real packs taper the current
            near full (CC/CV charging).
          </p>
        ),
      },
    ],
    live: (t) => [
      ['Battery', fmtPct(t.battery)],
      ['Charging', t.chargeW > 0 ? `${t.chargeW.toFixed(0)} W` : '—'],
      ['Docked', t.docked ? 'yes' : 'no'],
      ['Dock phase', DOCK_PHASE_LABEL[t.dock.phase]],
      ['Recharges', t.mission ? String(t.mission.rechargeCount) : '0'],
    ],
    showMe: { camera: 'dock', overlays: { path: true }, label: 'Dock close-up' },
    simplifications: ['The dock pose is known exactly; no beacon search.', 'Constant-power charging (no CC/CV taper or thermal limits).'],
  },

  suction: {
    id: 'suction',
    title: 'Suction & brushes',
    short: 'Suction',
    icon: 'wind',
    summary: 'How debris gets from the floor into the bin.',
    steps: [
      {
        title: 'The airflow path',
        body: (
          <p>
            The side brush flicks debris from edges into the robot&rsquo;s path, the rubber roller brush agitates and lifts it, and the fan creates a pressure drop that carries it through the
            dustbin. A filter keeps the dust in.
          </p>
        ),
        diagram: <SuctionDiagram />,
      },
      {
        title: 'The pickup model',
        body: (
          <p>
            Each time the cleaning footprint enters a cell, a fraction <var>η</var> of its dirt is removed: base 0.72 × surface (carpet 0.65, rug 0.82) × suction (Quiet 0.7 … Max 1.45) × a speed
            factor × a penalty when the bin is nearly full. More passes remove more of what&rsquo;s left.
          </p>
        ),
      },
      {
        title: 'Power trade-off',
        body: (
          <p>
            Suction dominates the energy budget: about 12 W on Quiet, 22 W Standard, 38 W Turbo and 55 W Max, versus ~9 W for driving. Max suction shortens the run noticeably — watch the Power
            card.
          </p>
        ),
      },
    ],
    live: (t) => [
      ['Suction', humanize(t.suction)],
      ['Fan power', `${t.power.suction.toFixed(1)} W`],
      ['Brushes', `${t.power.brushes.toFixed(1)} W`],
      ['Dustbin', `${fmtPct(t.dustbin)} · ${t.dustbinG.toFixed(0)} g`],
      ['Dirt removed', `${t.dirtRemovedG.toFixed(1)} g`],
    ],
    showMe: { camera: 'exploded', extra: { explode: 0.7, xray: false }, label: 'Exploded robot' },
    simplifications: ['Per-pass cleaning efficiency per 5 cm cell — no particle or airflow simulation.', 'Hair tangling and filter clogging are not modelled.'],
  },

  mopWash: {
    id: 'mopWash',
    title: 'Dock mop washing',
    short: 'Mop washing',
    icon: 'drop',
    summary: 'What the dock does after the robot comes home.',
    steps: [
      {
        title: 'Mopping on the go',
        body: (
          <p>
            Two rotating pads at the rear are pressed onto hard floors and wetted from the robot&rsquo;s clean-water tank. They pick up liquid and gradually lift stains (several passes for
            stubborn ones). On carpet and rugs mopping has no effect here (real robots lift the pads).
          </p>
        ),
      },
      {
        title: 'The service cycle',
        body: (
          <p>
            When the robot docks the station queues only what is needed: auto-empty the dustbin into the bag, scrub the pads on a ribbed tray with clean water, refill the robot&rsquo;s tank and
            drain its dirty water, then dry the pads with warm air to stop odours.
          </p>
        ),
        diagram: <MopWashDiagram />,
      },
      {
        title: 'Tanks & consumables',
        body: (
          <p>
            The dock has a 4 L clean tank, a 3.5 L dirty tank and a 2.5 kg dust bag. When one runs out the cycle can&rsquo;t complete — use the Dock service buttons in the Environment tab to
            refill, empty or replace them.
          </p>
        ),
      },
    ],
    live: (t) => [
      ['Dock phase', DOCK_PHASE_LABEL[t.dock.phase]],
      ['Progress', t.dock.phase === 'idle' || t.dock.phase === 'ready' ? '—' : fmtPct(t.dock.progress)],
      ['Clean tank', fmtPct(t.dock.cleanTank)],
      ['Dirty tank', fmtPct(t.dock.dirtyTank)],
      ['Pad soil', fmtPct(t.padSoil)],
      ['Dust bag', fmtPct(t.dock.dustBag)],
    ],
    showMe: { camera: 'dock', extra: { dockCutaway: true, dockPanels: 1 }, label: 'Dock cutaway' },
    simplifications: ['Timed phases with fixed water volumes.', 'Pad soiling is a single 0–1 value.'],
  },
};
