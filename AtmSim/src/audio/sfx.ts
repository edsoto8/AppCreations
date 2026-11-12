/** Names of the synthesized sound effects (all generated with WebAudio; no external assets). */
export type SfxName =
  | 'key' // keypad button press
  | 'card' // card reader motor / card in-out
  | 'count' // single note counted (short tick)
  | 'motor' // roller / belt motor burst
  | 'shutter' // presenter shutter
  | 'print' // receipt printer
  | 'beep' // confirmation beep
  | 'error' // error alert
  | 'panel' // service panel / door movement
  | 'click'; // UI click

export interface Sfx {
  play(name: SfxName, opts?: { volume?: number; durationMs?: number }): void;
}

/** Silent implementation for tests / before audio is unlocked. */
export const silentSfx: Sfx = { play() {} };
