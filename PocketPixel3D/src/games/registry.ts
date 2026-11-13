/** The cartridge library, in shelf order. */
import type { CartridgeDefinition } from './GameInterface';
import { PIXEL_BLOCKS_CARTRIDGE } from './PixelBlocks';
import { PIXEL_SNAKE_CARTRIDGE } from './PixelSnake';
import { RETRO_RACER_CARTRIDGE } from './RetroRacer';

export const CARTRIDGES: readonly CartridgeDefinition[] = [
  PIXEL_BLOCKS_CARTRIDGE,
  PIXEL_SNAKE_CARTRIDGE,
  RETRO_RACER_CARTRIDGE,
];

export function getCartridge(id: string): CartridgeDefinition | undefined {
  return CARTRIDGES.find((cartridge) => cartridge.id === id);
}
