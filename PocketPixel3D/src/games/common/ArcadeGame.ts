/**
 * Shared cartridge shell: title -> playing <-> paused -> game over -> playing ...
 *
 * Handles the START/SELECT flow, music switching, the pause screen, high-score submission and the
 * game-over card, so each concrete game only implements its own play logic and drawing.
 *
 * Flow:
 * - title:    START begins play; SELECT calls {@link ArcadeGame.onTitleSelect}.
 * - playing:  START pauses; otherwise {@link ArcadeGame.updatePlay} runs.
 * - paused:   START resumes. The play field is hidden.
 * - gameover: after `restartDelayTicks`, START restarts and SELECT returns to the title.
 */
import type { Game, GameServices, InputFrame, MusicTrack, SfxSpec } from '../GameInterface';
import type { FrameBuffer } from './FrameBuffer';
import { drawGameOverPanel, drawPausedScreen } from './ScreenKit';

export type ArcadePhase = 'title' | 'playing' | 'paused' | 'gameover';

export interface ArcadeSounds {
  readonly start: SfxSpec;
  readonly pause: SfxSpec;
  readonly select: SfxSpec;
  readonly gameOver: SfxSpec;
}

export interface ArcadeConfig {
  readonly id: string;
  /** Short name shown on the pause card. */
  readonly title: string;
  readonly titleMusic: MusicTrack;
  readonly playMusic: MusicTrack;
  readonly sounds: ArcadeSounds;
  /** Ticks after game over before START/SELECT are accepted. */
  readonly restartDelayTicks?: number;
}

const DEFAULT_RESTART_DELAY = 45;

export abstract class ArcadeGame implements Game {
  protected readonly services: GameServices;
  protected readonly config: ArcadeConfig;
  /** Ticks since power-on of this cartridge (drives blinking and title animation). */
  protected frame = 0;
  /** Ticks spent in the current phase. */
  protected phaseTicks = 0;
  protected highScore: number;
  protected lastScore = 0;
  protected newHighScore = false;
  protected gameOverReason = '';
  protected musicEnabled = true;
  private currentPhase: ArcadePhase = 'title';
  private musicStarted = false;

  protected constructor(services: GameServices, config: ArcadeConfig) {
    this.services = services;
    this.config = config;
    this.highScore = services.highScores.get(config.id);
  }

  get phase(): ArcadePhase {
    return this.currentPhase;
  }

  /** Stored best score for this cartridge (refreshed when a game ends). */
  get bestScore(): number {
    return this.highScore;
  }

  get isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  tick(input: InputFrame): void {
    if (!this.musicStarted) {
      this.musicStarted = true;
      this.playTrack(this.config.titleMusic);
    }
    this.frame++;
    this.phaseTicks++;
    switch (this.currentPhase) {
      case 'title':
        if (input.wasPressed('start')) {
          this.services.sound.sfx(this.config.sounds.start);
          this.beginPlay();
        } else {
          if (input.wasPressed('select')) this.onTitleSelect();
          this.updateTitle(input);
        }
        break;
      case 'playing':
        if (input.wasPressed('start')) {
          this.setPhase('paused');
          this.services.sound.stopMusic();
          this.services.sound.sfx(this.config.sounds.pause);
        } else {
          this.updatePlay(input);
        }
        break;
      case 'paused':
        if (input.wasPressed('start')) {
          this.setPhase('playing');
          this.services.sound.sfx(this.config.sounds.pause);
          this.playTrack(this.config.playMusic);
        }
        break;
      case 'gameover':
        this.updateGameOver(input);
        if (this.canRestart) {
          if (input.wasPressed('start')) {
            this.services.sound.sfx(this.config.sounds.start);
            this.beginPlay();
          } else if (input.wasPressed('select')) {
            this.services.sound.sfx(this.config.sounds.select);
            this.setPhase('title');
            this.playTrack(this.config.titleMusic);
          }
        }
        break;
    }
  }

  render(fb: FrameBuffer): void {
    fb.clear(0);
    switch (this.currentPhase) {
      case 'title':
        this.renderTitle(fb);
        break;
      case 'playing':
        this.renderPlay(fb);
        break;
      case 'paused':
        drawPausedScreen(fb, this.config.title, this.phaseTicks);
        break;
      case 'gameover':
        this.renderGameOver(fb);
        break;
    }
  }

  dispose(): void {
    this.services.sound.stopMusic();
  }

  /** Starts (or restarts) a round. */
  protected beginPlay(): void {
    this.resetPlay();
    this.newHighScore = false;
    this.gameOverReason = '';
    this.setPhase('playing');
    this.playTrack(this.config.playMusic);
  }

  /** Called by subclasses when the round is over. Submits the score and plays the jingle. */
  protected endGame(score: number, reason = ''): void {
    if (this.currentPhase !== 'playing') return;
    this.lastScore = score;
    this.gameOverReason = reason;
    this.newHighScore = this.services.highScores.submit(this.config.id, score);
    this.highScore = Math.max(this.highScore, score, this.services.highScores.get(this.config.id));
    this.services.sound.stopMusic();
    this.services.sound.sfx(this.config.sounds.gameOver);
    this.setPhase('gameover');
  }

  protected get canRestart(): boolean {
    return this.phaseTicks > (this.config.restartDelayTicks ?? DEFAULT_RESTART_DELAY);
  }

  protected toggleMusic(): void {
    this.musicEnabled = !this.musicEnabled;
    this.services.sound.sfx(this.config.sounds.select);
    if (this.musicEnabled) this.playTrack(this.config.titleMusic);
    else this.services.sound.stopMusic();
  }

  /** Plays a track if music is enabled. */
  protected playTrack(track: MusicTrack): void {
    if (this.musicEnabled) this.services.sound.playMusic(track);
    else this.services.sound.stopMusic();
  }

  private setPhase(phase: ArcadePhase): void {
    this.currentPhase = phase;
    this.phaseTicks = 0;
  }

  /** Default game-over view: the frozen play field with the score card on top. */
  protected renderGameOver(fb: FrameBuffer): void {
    this.renderPlay(fb);
    this.drawGameOverCard(fb);
  }

  protected drawGameOverCard(fb: FrameBuffer): void {
    drawGameOverPanel(fb, {
      score: this.lastScore,
      highScore: this.highScore,
      isNewHighScore: this.newHighScore,
      ticks: this.phaseTicks,
      canRestart: this.canRestart,
      reason: this.gameOverReason,
    });
  }

  /** SELECT on the title screen. */
  protected abstract onTitleSelect(): void;
  /** Title-screen animation; START/SELECT are already handled. */
  protected updateTitle(_input: InputFrame): void {}
  /** Game-over animation hook. */
  protected updateGameOver(_input: InputFrame): void {}
  /** Prepare a fresh round. */
  protected abstract resetPlay(): void;
  /** One tick of play; START is already handled. */
  protected abstract updatePlay(input: InputFrame): void;
  protected abstract renderTitle(fb: FrameBuffer): void;
  protected abstract renderPlay(fb: FrameBuffer): void;
}
