/**
 * Static description of every panel: used by the toolbar, the panel host and the keyboard shortcuts.
 * To make a panel real (M3+): keep its entry here and replace its placeholder in PanelHost.tsx.
 */
import type { PanelId } from '../../store';
import type { IconName } from '../components/Icon';
import type { PanelPlacement } from '../components/Panel';
import { PANEL_HOTKEYS } from '../lib/hotkeys';

export interface PanelDef {
  id: PanelId;
  title: string;
  /** Toolbar label. */
  short: string;
  icon: IconName;
  placement: PanelPlacement;
  width: number;
  /** One-line description (toolbar tooltip). */
  blurb: string;
  /** Milestone that fills the panel in; null when it is already functional. */
  comingIn: string | null;
  /** Shown on the toolbar. */
  inToolbar: boolean;
}

export const PANEL_DEFS: Record<PanelId, PanelDef> = {
  build: {
    id: 'build',
    title: 'Build',
    short: 'Build',
    icon: 'build',
    placement: 'left',
    width: 380,
    blurb: 'Place houses, farms, camps and workshops.',
    comingIn: null,
    inToolbar: true,
  },
  settlers: {
    id: 'settlers',
    title: 'Settlers',
    short: 'Settlers',
    icon: 'settlers',
    placement: 'right',
    width: 380,
    blurb: 'See who lives here, what they are doing and how they feel.',
    comingIn: null,
    inToolbar: true,
  },
  priorities: {
    id: 'priorities',
    title: 'Work Priorities',
    short: 'Priorities',
    icon: 'priorities',
    placement: 'right',
    width: 430,
    blurb: 'Tell the colony which jobs matter most.',
    comingIn: null,
    inToolbar: true,
  },
  events: {
    id: 'events',
    title: 'Colony Log',
    short: 'Events',
    icon: 'events',
    placement: 'right',
    width: 400,
    blurb: 'A running history of arrivals, weather, accidents and discoveries.',
    comingIn: null,
    inToolbar: true,
  },
  stats: {
    id: 'stats',
    title: 'Statistics',
    short: 'Stats',
    icon: 'chart',
    placement: 'right',
    width: 400,
    blurb: 'Charts of stock and population over time.',
    comingIn: null,
    inToolbar: true,
  },
  saveLoad: {
    id: 'saveLoad',
    title: 'Save & Load',
    short: 'Save / Load',
    icon: 'save',
    placement: 'center',
    width: 560,
    blurb: 'Save your colony to a slot, or load an earlier one.',
    comingIn: null,
    inToolbar: true,
  },
  help: {
    id: 'help',
    title: 'How to Play',
    short: 'Help',
    icon: 'info',
    placement: 'center',
    width: 640,
    blurb: 'Controls, the core loop, survival tips, and how to win or lose.',
    comingIn: null,
    inToolbar: false,
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    short: 'Settings',
    icon: 'settings',
    placement: 'center',
    width: 520,
    blurb: 'Interface size, autosave, tooltips and the tutorial.',
    comingIn: null,
    inToolbar: true,
  },
};

export const TOOLBAR_PANELS: PanelDef[] = (['build', 'settlers', 'priorities', 'events', 'stats', 'saveLoad', 'settings'] as const).map(
  (id) => PANEL_DEFS[id],
);

/** The keyboard shortcut (upper-case letter) for a panel, or null. */
export function hotkeyFor(panel: PanelId): string | null {
  const entry = Object.entries(PANEL_HOTKEYS).find(([, id]) => id === panel);
  return entry ? entry[0].toUpperCase() : null;
}
