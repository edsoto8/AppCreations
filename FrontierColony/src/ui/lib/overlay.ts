/** Map overlay modes: order, labels and explanations. */
import type { OverlayMode } from '../../shared/types';

export const OVERLAY_ORDER: readonly OverlayMode[] = ['none', 'resources', 'buildable'];

export const OVERLAY_LABEL: Record<OverlayMode, string> = { none: 'Off', resources: 'Resources', buildable: 'Buildable' };

export const OVERLAY_HELP: Record<OverlayMode, string> = {
  none: 'No overlay. The map shows only the world.',
  resources: 'Highlights trees and stone you can gather, so you can see where wood and stone are.',
  buildable: 'Highlights ground where buildings can be placed. It switches on by itself while you place something.',
};

/** The next overlay in the cycle (the V key). */
export function nextOverlay(mode: OverlayMode): OverlayMode {
  return OVERLAY_ORDER[(OVERLAY_ORDER.indexOf(mode) + 1) % OVERLAY_ORDER.length]!;
}
