import type { EventBus } from '../core/events';
import type { AnimClock } from '../animations/AnimClock';
import type { SceneManager } from '../scene/SceneManager';
import type { ViewModes } from '../scene/ViewModes';
import type { AtmModel } from '../models/types';
import type { MechanismAnimator } from '../animations/MechanismAnimator';
import type { WebAudioSfx } from '../audio/WebAudioSfx';
import type { UiCustomerPort } from '../app/UiCustomerPort';
import type { AtmScreenRenderer } from './AtmScreenRenderer';
import type { AtmSystem } from '../app/AtmSystem';
import type { ComponentId, DeviceId } from '../core/types';
import type { TroubleshootController } from './panels/troubleshootPanel';
import type { NetworkViz } from './NetworkViz';

/** Note-path arrows toggle (wraps animations/FlowArrows). */
export interface NotePath {
  visible: boolean;
  setVisible(on: boolean): void;
  toggleAll(): void;
}

export type AppMode = 'customer' | 'inspect' | 'network' | 'cash' | 'maintenance' | 'troubleshoot' | 'reconciliation';

export interface UiApi {
  select(id: ComponentId | null, opts?: { focus?: boolean }): void;
  selected: ComponentId | null;
  setMode(mode: AppMode): void;
  mode: AppMode;
  toast(text: string, kind?: 'info' | 'ok' | 'warn' | 'err'): void;
  activeCardId: string;
  setActiveCard(id: string): void;
  insertCard(method: 'chip' | 'contactless'): void;
  /** Show the right-panel tab with this id. */
  showTab(id: string): void;
  refresh(): void;
}

export interface Ctx {
  sys: AtmSystem;
  bus: EventBus;
  clock: AnimClock;
  stage: SceneManager;
  views: ViewModes;
  model: AtmModel;
  mech: MechanismAnimator;
  arrows: NotePath;
  /** Restore the whole simulator (domain + 3D + UI) to the initial training state. */
  resetAll(): void;
  troubleshoot: TroubleshootController;
  sfx: WebAudioSfx;
  port: UiCustomerPort;
  screen: AtmScreenRenderer;
  net: NetworkViz;
  ui: UiApi;
}

/** Which monitored device a 3D component belongs to (for health badges). */
export const COMPONENT_DEVICE: Partial<Record<ComponentId, DeviceId>> = {
  'card-reader': 'cardReader',
  'card-reader-module': 'cardReader',
  'contactless-reader': 'contactless',
  dispenser: 'dispenser',
  'picker-rollers': 'dispenser',
  transport: 'dispenser',
  'validation-sensors': 'dispenser',
  stacker: 'dispenser',
  'presenter-shutter': 'dispenser',
  'cash-slot': 'dispenser',
  'cassette-A': 'dispenser',
  'cassette-B': 'dispenser',
  'cassette-C': 'dispenser',
  'receipt-printer': 'printer',
  'receipt-slot': 'printer',
  'deposit-module': 'depositModule',
  'deposit-slot': 'depositModule',
  comms: 'network',
  'power-supply': 'power',
  keypad: 'keypad',
  display: 'display',
};

export const MODES: Array<{ id: AppMode; label: string; tip: string }> = [
  { id: 'customer', label: 'Customer', tip: 'Use the ATM as a customer: card, PIN, transactions' },
  { id: 'inspect', label: 'Inspect', tip: 'Explore components, X-ray, cutaway and exploded views' },
  { id: 'network', label: 'Banking network', tip: 'Watch authorization messages travel to the bank host' },
  { id: 'cash', label: 'Cash inventory', tip: 'Cassettes, note counts, dispense strategy' },
  { id: 'maintenance', label: 'Maintenance', tip: 'Operator training: cassettes, replenishment, diagnostics' },
  { id: 'troubleshoot', label: 'Troubleshooting', tip: 'Trigger failures and follow the recovery workflow' },
  { id: 'reconciliation', label: 'Reconciliation', tip: 'End-of-day balancing, journal and audit log' },
];
