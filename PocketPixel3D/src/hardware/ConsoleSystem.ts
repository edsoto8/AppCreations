import { BootSequence, BOOT_CHIME } from '../display/BootSequence';
import { FrameBuffer } from '../games/common/FrameBuffer';
import {
  TICK_RATE,
  type CartridgeDefinition,
  type Game,
  type GameServices,
  type HighScoreStore,
  type MusicTrack,
  type SfxSpec,
  type SoundOutput,
} from '../games/GameInterface';
import { ButtonSystem } from './ButtonSystem';
import { CartridgeSlot, type SlotResult } from './CartridgeSlot';
import { Emitter } from './Emitter';
import { PowerSystem } from './PowerSystem';
import { ContrastControl, VolumeControl } from './VolumeControl';

export type ConsoleMode = 'off' | 'boot' | 'running';

export interface ConsoleEvents extends Record<string, unknown> {
  mode: ConsoleMode;
  /** Fired when an action is refused (e.g. ejecting while powered). */
  rejected: string;
  batteryCover: boolean;
}

export interface ConsoleOptions {
  speaker: SoundOutput;
  highScores: HighScoreStore;
  random?: () => number;
  volume?: number;
  contrast?: number;
}

const TICK_SECONDS = 1 / TICK_RATE;
/** Never run more than this many catch-up ticks per frame (avoids a spiral after a tab stall). */
const MAX_TICKS_PER_UPDATE = 8;

/**
 * The console's "motherboard": owns the framebuffer and runs the boot sequence or the inserted
 * cartridge at a fixed 60 Hz. Pure TypeScript, so it is unit-testable without a browser.
 */
export class ConsoleSystem {
  readonly framebuffer = new FrameBuffer();
  readonly buttons = new ButtonSystem();
  readonly power = new PowerSystem();
  readonly slot = new CartridgeSlot();
  readonly volume: VolumeControl;
  readonly contrast: ContrastControl;
  readonly events = new Emitter<ConsoleEvents>();

  private modeValue: ConsoleMode = 'off';
  private boot: BootSequence | null = null;
  private game: Game | null = null;
  private accumulator = 0;
  private coverOpen = false;
  private totalTicks = 0;
  private readonly services: GameServices;
  private readonly speaker: SoundOutput;

  constructor(options: ConsoleOptions) {
    this.speaker = options.speaker;
    this.volume = new VolumeControl(options.volume ?? 0.6);
    this.contrast = new ContrastControl(options.contrast ?? 0.5);
    const gatedSound: SoundOutput = {
      sfx: (spec: SfxSpec) => {
        if (this.power.isOn) this.speaker.sfx(spec);
      },
      playMusic: (track: MusicTrack) => {
        if (this.power.isOn) this.speaker.playMusic(track);
      },
      stopMusic: () => this.speaker.stopMusic(),
    };
    this.services = {
      sound: gatedSound,
      highScores: options.highScores,
      random: options.random ?? Math.random,
    };
    this.power.onChange((on) => this.handlePower(on));
  }

  get mode(): ConsoleMode {
    return this.modeValue;
  }

  get isOn(): boolean {
    return this.power.isOn;
  }

  get cartridge(): CartridgeDefinition | null {
    return this.slot.cartridge;
  }

  get batteryCoverOpen(): boolean {
    return this.coverOpen;
  }

  /** Ticks run since power-on (for tests and the debug API). */
  get ticks(): number {
    return this.totalTicks;
  }

  get bootPhase(): string {
    return this.boot?.phase ?? (this.modeValue === 'running' ? 'done' : 'off');
  }

  setPower(on: boolean): void {
    this.power.set(on);
  }

  togglePower(): void {
    this.power.toggle();
  }

  insertCartridge(cart: CartridgeDefinition): SlotResult {
    const result = this.slot.insert(cart);
    if (!result.ok) this.events.emit('rejected', result.reason);
    return result;
  }

  ejectCartridge(): SlotResult {
    const result = this.slot.eject();
    if (!result.ok) this.events.emit('rejected', result.reason);
    return result;
  }

  setBatteryCover(open: boolean): void {
    if (open === this.coverOpen) return;
    this.coverOpen = open;
    this.events.emit('batteryCover', open);
  }

  /** Advance real time; runs whole fixed ticks. Returns the number of ticks run. */
  update(dtSeconds: number): number {
    if (!this.power.isOn) {
      this.accumulator = 0;
      return 0;
    }
    this.accumulator += Math.min(dtSeconds, 0.25);
    let ran = 0;
    while (this.accumulator >= TICK_SECONDS && ran < MAX_TICKS_PER_UPDATE) {
      this.accumulator -= TICK_SECONDS;
      this.step();
      ran++;
    }
    if (ran === MAX_TICKS_PER_UPDATE) this.accumulator = 0;
    return ran;
  }

  /** Runs exactly one 60 Hz tick (tests call this directly). */
  step(): void {
    if (!this.power.isOn) return;
    this.totalTicks++;
    this.buttons.latch();
    if (this.boot) {
      this.boot.tick();
      if (this.boot.finished) {
        this.startGame();
      } else {
        this.boot.render(this.framebuffer);
      }
      if (this.boot) return;
    }
    if (this.game) {
      this.game.tick(this.buttons);
      this.game.render(this.framebuffer);
    }
  }

  private startGame(): void {
    const cart = this.slot.cartridge;
    this.boot = null;
    if (!cart) return;
    this.buttons.resetEdges();
    this.game = cart.create(this.services);
    this.game.render(this.framebuffer);
    this.setMode('running');
  }

  private handlePower(on: boolean): void {
    this.slot.setLocked(on);
    this.accumulator = 0;
    if (on) {
      this.totalTicks = 0;
      this.framebuffer.clear(0);
      this.boot = new BootSequence(this.slot.cartridge !== null, () => {
        for (const spec of BOOT_CHIME) this.speaker.sfx(spec);
      });
      this.setMode('boot');
    } else {
      this.game?.dispose();
      this.game = null;
      this.boot = null;
      this.speaker.stopMusic();
      // The framebuffer keeps its last image; the LCD renderer fades it out.
      this.setMode('off');
    }
  }

  private setMode(mode: ConsoleMode): void {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    this.events.emit('mode', mode);
  }
}
