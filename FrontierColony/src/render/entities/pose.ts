/**
 * Pure animation logic for settlers: which pose to show for an activity at a given time. No Pixi,
 * no allocation in the hot path (`computePose` fills a reusable Pose). Angles are in radians where
 * *positive means swinging forward* (towards the facing direction); the view negates them for Pixi.
 */
import type { ActivityKind, Facing } from '../../sim';

export type ToolKind = 'axe' | 'pick' | 'hammer' | 'hoe' | 'bucket';
export type BadgeId = 'chop' | 'mine' | 'build' | 'craft' | 'farm' | 'water' | 'eat' | 'sleep' | 'chat' | 'rest';
export type SpeechKind = 'dots' | 'heart' | 'note';

export interface Pose {
  legFront: number;
  legBack: number;
  armFront: number;
  armBack: number;
  /** Vertical offset of the whole body in px (negative = up). */
  bodyY: number;
  /** Forward lean of the torso/head in radians. */
  lean: number;
  headTilt: number;
  sit: boolean;
  lie: boolean;
  tool: ToolKind | null;
  /** Both hands hold something in front of the body (stone, crate). */
  armsForward: boolean;
  /** Which arm holds the tool: the front one. */
  /** 0..1 pulse right after a tool hits. */
  strike: number;
}

export function newPose(): Pose {
  return { legFront: 0, legBack: 0, armFront: 0, armBack: 0, bodyY: 0, lean: 0, headTilt: 0, sit: false, lie: false, tool: null, armsForward: false, strike: 0 };
}

export interface WorkCycle {
  /** Seconds per swing. */
  period: number;
  /** Fraction of the cycle at which the tool hits. */
  impactAt: number;
  tool: ToolKind;
  badge: BadgeId;
}

export function workCycle(kind: ActivityKind): WorkCycle | null {
  switch (kind) {
    case 'chopping':
      return { period: 1.0, impactAt: 0.62, tool: 'axe', badge: 'chop' };
    case 'mining':
      return { period: 1.25, impactAt: 0.6, tool: 'pick', badge: 'mine' };
    case 'building':
      return { period: 0.72, impactAt: 0.55, tool: 'hammer', badge: 'build' };
    case 'crafting':
      return { period: 0.8, impactAt: 0.55, tool: 'hammer', badge: 'craft' };
    case 'farming':
      return { period: 1.5, impactAt: 0.6, tool: 'hoe', badge: 'farm' };
    default:
      return null;
  }
}

/** Badge shown over a settler for an activity (null = none). */
export function badgeFor(kind: ActivityKind): BadgeId | null {
  switch (kind) {
    case 'chopping':
      return 'chop';
    case 'mining':
      return 'mine';
    case 'building':
      return 'build';
    case 'crafting':
      return 'craft';
    case 'farming':
      return 'farm';
    case 'fetchingWater':
      return 'water';
    case 'eating':
      return 'eat';
    case 'sleeping':
      return 'sleep';
    case 'resting':
      return 'rest';
    case 'socializing':
      return 'chat';
    default:
      return null;
  }
}

const TAU = Math.PI * 2;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Swing angle for a wind-up / strike / recover cycle: slow raise, fast hit, slow return. */
export function swingAngle(phase: number, impactAt: number, up: number, down: number): number {
  if (phase < impactAt) return down + (up - down) * smooth(phase / impactAt);
  const t = (phase - impactAt) / (1 - impactAt);
  // quick drop to `down` in the first 18% then hold
  return up + (down - up) * smooth(Math.min(1, t / 0.18));
}

/**
 * Fill `out` for the given activity.
 * @param time seconds (already offset per settler so crowds do not move in lockstep)
 * @param walkPhase accumulated gait phase in radians (advances with distance walked)
 */
export function computePose(out: Pose, kind: ActivityKind, moving: boolean, time: number, walkPhase: number, carrying: boolean): void {
  out.legFront = out.legBack = out.armFront = out.armBack = 0;
  out.bodyY = out.lean = out.headTilt = out.strike = 0;
  out.sit = out.lie = out.armsForward = false;
  out.tool = null;

  if (moving) {
    const s = Math.sin(walkPhase);
    out.legFront = s * 0.75;
    out.legBack = -s * 0.75;
    out.bodyY = -Math.abs(Math.cos(walkPhase)) * 1.5;
    if (carrying) {
      out.armsForward = true;
      out.armFront = 0.9;
      out.armBack = 0.9;
      out.lean = 0.05;
    } else {
      out.armFront = -s * 0.7;
      out.armBack = s * 0.7;
      out.lean = 0.04;
    }
    if (kind === 'fetchingWater') {
      out.tool = 'bucket';
      out.armFront = 0.2;
    }
    return;
  }

  const cyc = workCycle(kind);
  if (cyc) {
    const phase = (((time / cyc.period) % 1) + 1) % 1;
    out.tool = cyc.tool;
    if (cyc.tool === 'hoe') {
      out.lean = 0.28 + 0.1 * Math.sin(phase * TAU);
      out.armFront = swingAngle(phase, cyc.impactAt, 1.9, 0.55);
      out.armBack = out.armFront * 0.85;
      out.bodyY = 1.2;
    } else if (cyc.tool === 'hammer') {
      out.lean = 0.08;
      out.armFront = swingAngle(phase, cyc.impactAt, 1.6, 0.35);
      out.armBack = 0.3;
    } else if (cyc.tool === 'pick') {
      out.lean = 0.12 * Math.sin(phase * TAU) + 0.1;
      out.armFront = swingAngle(phase, cyc.impactAt, 2.5, 0.4);
      out.armBack = out.armFront * 0.9;
    } else {
      out.lean = 0.1;
      out.armFront = swingAngle(phase, cyc.impactAt, 2.4, 0.35);
      out.armBack = out.armFront * 0.55;
    }
    // hit pulse: 1 at impact decaying over 14% of the cycle
    const since = phase - cyc.impactAt;
    out.strike = since >= 0 && since < 0.14 ? 1 - since / 0.14 : 0;
    out.legFront = 0.12;
    out.legBack = -0.12;
    out.bodyY += out.strike > 0 ? 0.6 : 0;
    return;
  }

  switch (kind) {
    case 'fetchingWater': {
      const k = Math.sin(time * 6.5);
      out.tool = 'bucket';
      out.armFront = 0.9 + 0.5 * k;
      out.armBack = 0.9 - 0.5 * k;
      out.lean = 0.14;
      return;
    }
    case 'eating': {
      out.sit = true;
      out.bodyY = 5;
      out.legFront = 1.35;
      out.legBack = 1.3;
      const k = 0.5 + 0.5 * Math.sin(time * 3.4);
      out.armFront = 1.9 + 0.7 * k;
      out.armBack = 0.9;
      out.headTilt = 0.04 * k;
      return;
    }
    case 'resting': {
      out.sit = true;
      out.bodyY = 5;
      out.legFront = 1.3;
      out.legBack = 1.2;
      out.armFront = 0.3;
      out.armBack = 0.2;
      out.headTilt = 0.18 + 0.03 * Math.sin(time * 1.3);
      out.lean = 0.12;
      return;
    }
    case 'sleeping': {
      out.lie = true;
      out.armFront = 0.2;
      out.armBack = 0.1;
      out.bodyY = 0.5 * Math.sin(time * 1.5);
      return;
    }
    case 'socializing': {
      const k = Math.sin(time * 4.2);
      out.armFront = 1.3 + 0.45 * Math.max(0, k);
      out.armBack = 0.2;
      out.headTilt = 0.06 * Math.sin(time * 2.1);
      out.bodyY = Math.sin(time * 2.1) * 0.3;
      return;
    }
    default: {
      // idle: slow breathing and a small weight shift
      out.bodyY = Math.sin(time * 1.7) * 0.35;
      out.armFront = 0.06 + Math.sin(time * 1.7) * 0.03;
      out.armBack = -0.06;
      out.headTilt = Math.sin(time * 0.6) * 0.03;
    }
  }
}

/** True when a work swing crossed its impact moment between two times. Used to emit particles. */
export function strikeCrossed(kind: ActivityKind, tPrev: number, tNow: number): boolean {
  const cyc = workCycle(kind);
  if (!cyc || tNow <= tPrev) return false;
  const a = Math.floor(tPrev / cyc.period - cyc.impactAt);
  const b = Math.floor(tNow / cyc.period - cyc.impactAt);
  return b > a;
}

export interface FacingView {
  /** Show the back of the character. */
  back: boolean;
  /** 1 faces screen-right, -1 mirrors to screen-left. */
  flip: 1 | -1;
}

export function facingView(f: Facing): FacingView {
  switch (f) {
    case 'se':
      return { back: false, flip: 1 };
    case 'sw':
      return { back: false, flip: -1 };
    case 'ne':
      return { back: true, flip: 1 };
    case 'nw':
      return { back: true, flip: -1 };
  }
}

/** Iso facing for a world-space direction (+x is screen right-down, +y screen left-down). */
export function facingFromVector(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  const sx = dx - dy;
  const sy = dx + dy;
  if (sx >= 0) return sy >= 0 ? 'se' : 'ne';
  return sy >= 0 ? 'sw' : 'nw';
}
