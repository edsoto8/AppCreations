import type { Command, RobotMode } from './types';

/**
 * Which user commands are accepted in which robot mode. This is the single guard used by the
 * controller and the dashboard (buttons are disabled with the returned reason). Keeping it a pure
 * table makes incompatible combinations impossible and easy to test.
 */
const ACTIVE: RobotMode[] = ['undocking', 'mapping', 'cleaning', 'returning', 'docking', 'recovering', 'diagnostic', 'maintenance', 'charging', 'manual'];

export const COMMAND_RULES: Record<Command['type'], { allowed: RobotMode[]; reason: string }> = {
  start: { allowed: ['idle', 'charging', 'maintenance', 'error'], reason: 'Stop the current activity before starting a new mission' },
  pause: { allowed: ACTIVE, reason: 'Nothing to pause' },
  resume: { allowed: ['paused'], reason: 'Only a paused robot can resume' },
  stop: { allowed: [...ACTIVE, 'paused', 'error'], reason: 'Robot is already idle' },
  dock: { allowed: ['idle', 'mapping', 'cleaning', 'manual', 'recovering', 'error', 'diagnostic'], reason: 'Robot is already docked or heading home' },
  manual: { allowed: ['idle', 'charging', 'manual', 'error'], reason: 'Stop the mission before taking manual control' },
  diagnostic: { allowed: ['idle', 'charging', 'maintenance'], reason: 'Diagnostics require an idle robot' },
  clearError: { allowed: ['error'], reason: 'No error to clear' },
};

export function canCommand(mode: RobotMode, type: Command['type']): { ok: boolean; reason?: string } {
  const rule = COMMAND_RULES[type];
  return rule.allowed.includes(mode) ? { ok: true } : { ok: false, reason: rule.reason };
}

/** Allowed internal mode transitions (autonomous behaviour must also respect these). */
export const MODE_TRANSITIONS: Record<RobotMode, RobotMode[]> = {
  idle: ['undocking', 'mapping', 'cleaning', 'returning', 'manual', 'diagnostic', 'charging', 'error'],
  undocking: ['mapping', 'cleaning', 'diagnostic', 'idle', 'paused', 'recovering', 'error', 'returning'],
  mapping: ['cleaning', 'returning', 'recovering', 'paused', 'idle', 'error'],
  cleaning: ['returning', 'recovering', 'paused', 'idle', 'error', 'mapping'],
  returning: ['docking', 'recovering', 'paused', 'idle', 'error'],
  docking: ['maintenance', 'charging', 'returning', 'paused', 'idle', 'error', 'recovering'],
  maintenance: ['charging', 'undocking', 'paused', 'idle'],
  charging: ['undocking', 'maintenance', 'idle', 'paused', 'manual'],
  manual: ['idle', 'returning', 'paused', 'error'],
  paused: ['undocking', 'mapping', 'cleaning', 'returning', 'docking', 'maintenance', 'charging', 'manual', 'recovering', 'diagnostic', 'idle'],
  recovering: ['mapping', 'cleaning', 'returning', 'docking', 'paused', 'idle', 'error'],
  diagnostic: ['idle', 'paused', 'returning', 'error'],
  error: ['idle', 'manual', 'returning', 'undocking', 'charging'],
};

export function canTransition(from: RobotMode, to: RobotMode): boolean {
  return from === to || MODE_TRANSITIONS[from].includes(to);
}
