/**
 * One animated settler: a small sprite rig (legs, torso, arms, head, hair, hat) driven by the pure
 * pose logic in pose.ts. Tinted from `Appearance`, flipped for the four iso facings, with tools and
 * carried goods, activity badges, speech bubbles and a soft shadow.
 */
import { Container, Sprite } from 'pixi.js';
import type { Facing, Settler } from '../../sim';
import type { TextureSet } from '../textures';
import { lookFor, type SettlerLook } from './palettes';
import { badgeFor, computePose, facingFromVector, facingView, newPose, strikeCrossed, workCycle, type Pose, type SpeechKind, type ToolKind } from './pose';
import { hash01 } from '../util/noise';

const BODY_SCALE = 0.8;
const SHOULDER_Y = -16.2;
const HIP_Y = -9.2;

interface ArmRig {
  root: Container;
  sleeve: Sprite;
  hand: Sprite;
  tool: Sprite;
}

function makeArm(tex: TextureSet): ArmRig {
  const root = new Container();
  const sleeve = new Sprite(tex.rig.sleeve);
  const hand = new Sprite(tex.rig.hand);
  hand.position.set(0, 7.4);
  const tool = new Sprite(tex.tools.axe);
  tool.visible = false;
  tool.position.set(0, 7.4);
  root.addChild(sleeve, hand, tool);
  return { root, sleeve, hand, tool };
}

export interface SettlerEffectsHook {
  /** Called when a tool hits something: world pixel of the impact. */
  strike(kind: Settler['activity']['kind'], x: number, y: number): void;
  zzz(x: number, y: number): void;
}

export class SettlerView {
  readonly id: number;
  readonly root = new Container();
  private readonly shadow: Sprite;
  private readonly ring: Sprite;
  private readonly body = new Container();
  private readonly legBack: Sprite;
  private readonly legFront: Sprite;
  private readonly armBack: ArmRig;
  private readonly armFront: ArmRig;
  private readonly torso: Sprite;
  private readonly head: Sprite;
  private readonly hair: Sprite;
  private readonly hat: Sprite;
  private readonly carry: Sprite;
  private readonly blanket: Sprite;
  private readonly badge: Sprite;
  private readonly bubble: Sprite;
  private readonly tex: TextureSet;
  private readonly look: SettlerLook;
  private readonly pose: Pose = newPose();
  private readonly offset: number;

  /** Last interpolated position (tile units). */
  x = 0;
  y = 0;
  private walkPhase = 0;
  private facing: Facing = 'se';
  private lastTime = 0;
  nextZ = 0;
  hidden = false;
  seen = true;
  private carryKey = '';
  private toolKey: ToolKind | '' = '';
  private bucketFull = false;
  private backShown = false;
  private badgeKey = '';
  private bubbleKey = '';

  constructor(s: Settler, tex: TextureSet) {
    this.id = s.id;
    this.tex = tex;
    this.look = lookFor(s.appearance);
    this.offset = (s.id * 0.731) % 7;
    this.facing = s.facing;
    this.shadow = new Sprite(tex.softShadow);
    this.shadow.scale.set(0.62);
    this.ring = new Sprite(tex.selectionRing);
    this.ring.visible = false;
    this.legBack = new Sprite(tex.rig.leg);
    this.legFront = new Sprite(tex.rig.leg);
    this.legBack.tint = 0xb8b8b8;
    this.legBack.position.set(-1.9, HIP_Y);
    this.legFront.position.set(1.9, HIP_Y);
    this.armBack = makeArm(tex);
    this.armFront = makeArm(tex);
    for (const a of [this.armBack, this.armFront]) {
      a.sleeve.tint = this.look.shirt;
      a.hand.tint = this.look.skin;
    }
    this.armBack.root.position.set(-4.6, SHOULDER_Y);
    this.armFront.root.position.set(4.6, SHOULDER_Y);
    this.armBack.sleeve.tint = shade(this.look.shirt, 0.82);
    this.torso = new Sprite(tex.rig.torsoFront);
    this.torso.tint = this.look.shirt;
    this.torso.position.set(0, HIP_Y);
    this.head = new Sprite(tex.rig.headFront);
    this.head.tint = this.look.skin;
    this.head.position.set(0, -19.2);
    this.hair = new Sprite(tex.rig.hairFront[this.look.hairStyle]!);
    this.hair.tint = this.look.hair;
    this.hair.position.copyFrom(this.head.position);
    this.hat = new Sprite(tex.rig.hat);
    this.hat.position.set(0, -20.2);
    this.hat.visible = this.look.hat;
    this.carry = new Sprite(tex.carry.logs);
    this.carry.visible = false;
    this.blanket = new Sprite(tex.fx.blanket);
    this.blanket.visible = false;
    this.badge = new Sprite(tex.badges.chop);
    this.badge.visible = false;
    this.badge.position.set(0, -38);
    this.bubble = new Sprite(tex.fx.dots);
    this.bubble.visible = false;
    this.bubble.position.set(8, -33);
    this.body.addChild(this.legBack, this.armBack.root, this.legFront, this.torso, this.carry, this.head, this.hair, this.hat, this.armFront.root);
    this.body.scale.set(BODY_SCALE);
    this.root.addChild(this.ring, this.shadow, this.body, this.blanket, this.badge, this.bubble);
    this.x = s.pos.x;
    this.y = s.pos.y;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  setSelected(on: boolean, timeSec: number): void {
    this.ring.visible = on && !this.hidden;
    if (on) this.ring.scale.set(0.92 + 0.06 * Math.sin(timeSec * 4));
  }

  /**
   * Update from the sim state. (x, y) is the interpolated tile position, `lift` the ground height in px.
   * `indoors` hides the settler (sleeping inside a building).
   */
  update(s: Settler, x: number, y: number, moved: number, timeSec: number, zoom: number, indoors: boolean, fx: SettlerEffectsHook, px: number, py: number, realTime: number): void {
    const kind = s.activity.kind;
    const t = timeSec + this.offset;
    const prevX = this.x;
    const prevY = this.y;
    this.x = x;
    this.y = y;
    const moving = moved > 0.0004;
    this.walkPhase += moved * 4.4;

    this.hidden = indoors;
    this.root.visible = !indoors;
    if (indoors) {
      this.lastTime = t;
      return;
    }

    // facing: movement first, then the work target, else the sim facing with an occasional look-around
    let facing = s.facing;
    if (moving) {
      facing = facingFromVector(x - prevX, y - prevY, this.facing);
    } else if (s.activity.targetTile && workCycle(kind)) {
      facing = facingFromVector(s.activity.targetTile.x + 0.5 - x, s.activity.targetTile.y + 0.5 - y, s.facing);
    } else if (kind === 'idle' || kind === 'wandering') {
      const n = Math.floor(t / 3.7);
      const frac = t / 3.7 - n;
      if (frac < 0.3 && hash01(n, this.id, 4) > 0.55) facing = mirror(s.facing);
    }
    this.facing = facing;
    const fv = facingView(facing);

    computePose(this.pose, kind, moving, t, this.walkPhase, s.carrying !== null);
    const p = this.pose;
    this.applyPose(p, fv.flip, fv.back, s);

    // impact effects
    if (this.lastTime !== 0 && strikeCrossed(kind, this.lastTime, t)) {
      const dir = facingVec(facing);
      fx.strike(kind, px + dir[0] * 12, py - 6 + dir[1] * 6);
    }
    this.lastTime = t;

    // outdoor sleepers puff little z's
    if ((kind === 'sleeping' || kind === 'resting') && realTime > this.nextZ) {
      this.nextZ = realTime + 1.8 + hash01(this.id, Math.floor(realTime), 2);
      if (kind === 'sleeping') fx.zzz(px + 8, py - 14);
    }

    this.updateBadges(kind, zoom, t);
  }

  private applyPose(p: Pose, flip: 1 | -1, back: boolean, s: Settler): void {
    if (back !== this.backShown) {
      this.backShown = back;
      this.torso.texture = back ? this.tex.rig.torsoBack : this.tex.rig.torsoFront;
      this.head.texture = back ? this.tex.rig.headBack : this.tex.rig.headFront;
      this.hair.texture = (back ? this.tex.rig.hairBack : this.tex.rig.hairFront)[this.look.hairStyle]!;
    }
    const body = this.body;
    body.scale.x = BODY_SCALE * flip;
    if (p.lie) {
      body.rotation = -1.5 * flip;
      body.position.set(flip * 9, -2.5);
      this.blanket.visible = true;
      this.blanket.position.set(flip * 2, -4);
      this.blanket.scale.x = flip;
      this.shadow.scale.set(0.9, 0.62);
    } else {
      body.rotation = 0;
      body.position.set(0, p.bodyY * BODY_SCALE);
      this.blanket.visible = false;
      this.shadow.scale.set(0.62);
    }
    // torso lean pivots at the waist: approximate with horizontal head/torso shear
    this.torso.rotation = -p.lean;
    this.head.rotation = -p.lean * 1.2 - p.headTilt;
    this.hair.rotation = this.head.rotation;
    this.hat.rotation = this.head.rotation;
    const lx = Math.sin(p.lean) * 6;
    this.head.x = this.hair.x = lx;
    this.hat.x = lx;
    this.armFront.root.x = 4.6 + lx * 0.6;
    this.armBack.root.x = -4.6 + lx * 0.6;
    this.legFront.rotation = -p.legFront;
    this.legBack.rotation = -p.legBack;
    this.armFront.root.rotation = -p.armFront;
    this.armBack.root.rotation = -p.armBack;
    if (p.armsForward) {
      this.armFront.root.rotation = -1.0;
      this.armBack.root.rotation = -1.0;
    }

    // tool in the front hand
    const tool = p.tool;
    const wantBucketFull = s.carrying?.resource === 'water';
    const car = s.carrying;
    const carryKey = car ? car.resource : '';
    if (tool !== this.toolKey || wantBucketFull !== this.bucketFull) {
      this.toolKey = tool ?? '';
      this.bucketFull = wantBucketFull;
      this.setTool(this.armFront, tool, wantBucketFull);
    }
    if (carryKey !== this.carryKey) {
      this.carryKey = carryKey;
      this.setCarry(car?.resource ?? null);
    }
    // keep a hung bucket upright whatever the arm does
    if (this.armFront.tool.visible && this.toolKey === 'bucket') this.armFront.tool.rotation = p.armFront;
    // water carried without a "fetching" activity: bucket in the hand
    if (!tool && car?.resource === 'water') {
      this.armFront.tool.visible = true;
      this.armFront.tool.texture = this.tex.tools.bucketFull;
      this.armFront.tool.rotation = this.armFront.root.rotation * -1;
      this.armFront.tool.anchor.set(0.5, 0.14);
    } else if (!tool && this.armFront.tool.visible) {
      this.armFront.tool.visible = false;
    }
  }

  private setTool(arm: ArmRig, tool: ToolKind | null, full: boolean): void {
    const t = arm.tool;
    if (!tool) {
      t.visible = false;
      return;
    }
    const tx = this.tex.tools;
    t.texture = tool === 'axe' ? tx.axe : tool === 'pick' ? tx.pick : tool === 'hammer' ? tx.hammer : tool === 'hoe' ? tx.hoe : full ? tx.bucketFull : tx.bucket;
    t.anchor.set(t.texture.defaultAnchor?.x ?? 0.5, t.texture.defaultAnchor?.y ?? 0.5);
    // tools continue along the arm beyond the hand (blade forward); the bucket hangs
    t.rotation = tool === 'bucket' ? 0 : Math.PI - 0.25;
    t.visible = true;
  }

  private setCarry(res: string | null): void {
    const c = this.carry;
    if (res === null || res === 'water') {
      c.visible = false;
      return;
    }
    c.visible = true;
    switch (res) {
      case 'wood':
        c.texture = this.tex.carry.logs;
        c.anchor.set(0.5);
        c.position.set(-1, -20.5);
        c.rotation = -0.25;
        break;
      case 'stone':
        c.texture = this.tex.carry.rock;
        c.anchor.set(0.5);
        c.position.set(4, -12);
        c.rotation = 0;
        break;
      case 'food':
        c.texture = this.tex.carry.sack;
        c.anchor.set(0.5);
        c.position.set(-4.4, -15);
        c.rotation = 0.2;
        break;
      default:
        c.texture = this.tex.carry.crate;
        c.anchor.set(0.5);
        c.position.set(4, -12);
        c.rotation = 0;
    }
  }

  private updateBadges(kind: Settler['activity']['kind'], zoom: number, t: number): void {
    const badge = kind === 'socializing' ? null : badgeFor(kind);
    const show = zoom >= 1.15 && badge !== null && !this.hidden;
    if (show && badge !== null) {
      if (badge !== this.badgeKey) {
        this.badgeKey = badge;
        this.badge.texture = this.tex.badges[badge];
      }
      this.badge.visible = true;
      this.badge.y = -38 + Math.sin(t * 3) * 1;
      this.badge.alpha = Math.min(1, (zoom - 1.15) / 0.2);
    } else this.badge.visible = false;

    let sp: SpeechKind | null = null;
    if (kind === 'socializing' && zoom >= 0.9) {
      const k = (t % 3.2) / 3.2;
      if (k < 0.7) sp = k < 0.25 ? 'dots' : k < 0.5 ? 'note' : 'heart';
    }
    if (sp) {
      if (sp !== this.bubbleKey) {
        this.bubbleKey = sp;
        this.bubble.texture = sp === 'dots' ? this.tex.fx.dots : sp === 'heart' ? this.tex.fx.heart : this.tex.fx.note;
      }
      this.bubble.visible = true;
      this.bubble.y = -30 - Math.sin(t * 5) * 0.8;
    } else this.bubble.visible = false;
  }
}

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

function mirror(f: Facing): Facing {
  return f === 'se' ? 'sw' : f === 'sw' ? 'se' : f === 'ne' ? 'nw' : 'ne';
}

/** Screen-space unit-ish direction of an iso facing (x right, y down). */
function facingVec(f: Facing): [number, number] {
  switch (f) {
    case 'se':
      return [1, 0.5];
    case 'sw':
      return [-1, 0.5];
    case 'ne':
      return [1, -0.5];
    case 'nw':
      return [-1, -0.5];
  }
}
