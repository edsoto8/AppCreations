/**
 * State machine with crossfades. Every active state is evaluated into its own pose and the
 * results are blended by weight, so switching states mid-motion is always smooth.
 */
import type { FoxRig } from './FoxRig';
import { Pose } from './Pose';
import { STATES, type AnimState, type StateId } from './states';

interface Track {
  state: AnimState;
  pose: Pose;
  time: number;
  weight: number;
  target: number;
  fade: number;
}

export class AnimationController {
  /** Playback speed multiplier. */
  speed = 1;
  playing = true;
  /** Blended ground speed this frame (m/s, already multiplied by playback speed). */
  groundSpeed = 0;

  private readonly tracks = new Map<StateId, Track>();
  private readonly result = new Pose();
  private currentId: StateId = 'idle';
  private clock = 0;
  private readonly listeners: ((id: StateId) => void)[] = [];

  constructor(private readonly rig: FoxRig) {
    for (const state of STATES) {
      this.tracks.set(state.id, { state, pose: new Pose(), time: 0, weight: 0, target: 0, fade: state.fadeIn });
    }
    const idle = this.tracks.get('idle')!;
    idle.weight = idle.target = 1;
  }

  get current(): StateId {
    return this.currentId;
  }

  get states(): readonly AnimState[] {
    return STATES;
  }

  onChange(cb: (id: StateId) => void): void {
    this.listeners.push(cb);
  }

  play(id: StateId): void {
    if (id === this.currentId) return;
    const next = this.tracks.get(id);
    if (!next) throw new Error(`Unknown animation '${id}'`);
    // Sitting down and standing up need a slower blend than the other transitions.
    const fade = this.currentId === 'sit' ? 0.9 : next.state.fadeIn;
    for (const track of this.tracks.values()) {
      track.target = track === next ? 1 : 0;
      track.fade = fade;
    }
    if (next.state.restart && next.weight < 0.01) next.time = 0;
    this.currentId = id;
    for (const cb of this.listeners) cb(id);
  }

  setWagLayer(on: boolean): void {
    this.rig.wagLayer = on ? 1 : 0;
  }

  /** Advances by real seconds `dt` and poses the fox. */
  update(dt: number): void {
    const step = this.playing ? dt * this.speed : 0;
    this.clock += step;

    let first = true;
    let total = 0;
    for (const track of this.tracks.values()) {
      if (step > 0) {
        const rate = step / Math.max(track.fade, 1e-3);
        track.weight = track.weight < track.target ? Math.min(track.target, track.weight + rate) : Math.max(track.target, track.weight - rate);
      }
      if (track.weight <= 0) continue;
      track.time += step;
      track.state.evaluate(track.time, track.pose);
      // Ease the weights so blends start and end gently.
      const w = track.weight * track.weight * (3 - 2 * track.weight);
      if (w <= 0) continue;
      total += w;
      if (first) {
        this.result.copy(track.pose);
        first = false;
      } else {
        this.result.blend(track.pose, w / total);
      }
    }
    if (first) this.result.reset();
    this.groundSpeed = this.result.speed * (this.playing ? this.speed : 0);
    this.rig.apply(this.result, step, this.clock);
  }
}
