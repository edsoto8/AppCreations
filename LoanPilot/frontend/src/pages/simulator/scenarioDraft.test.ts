import { describe, expect, it } from 'vitest';
import { buildSimulationRequest, draftFromScenario, initialDraft, mapFieldErrors, scenarioForSave, strategyKey } from './scenarioDraft';
import { makeScenario } from './testFixtures';

const base = () => initialDraft({ defaultLumpDate: '2026-10-14', defaultTargetDate: '2028-01-01' });

describe('scenarioDraft', () => {
  it('picks the simplest mode that represents a saved scenario', () => {
    expect(draftFromScenario(makeScenario({ recurringExtras: [{ amount: 50 }], lumpSums: [] }), base()).mode).toBe('extra');
    expect(draftFromScenario(makeScenario({ recurringExtras: [], lumpSums: [{ amount: 900, date: '2027-01-01' }] }), base()).mode).toBe('lump');
    expect(draftFromScenario(makeScenario({ budgetPayment: 700, recurringExtras: [], lumpSums: [] }), base()).mode).toBe('budget');
    // An end date or a mix needs the combined editor.
    expect(draftFromScenario(makeScenario({ recurringExtras: [{ amount: 50, endDate: '2027-01-01' }], lumpSums: [] }), base()).mode).toBe('combined');
    expect(draftFromScenario(makeScenario(), base()).mode).toBe('combined');
  });

  it('round-trips a saved strategy through the editor unchanged', () => {
    for (const s of [makeScenario(), makeScenario({ budgetPayment: 650, recurringExtras: [{ amount: 25, startDate: '2027-01-01', endDate: null }], lumpSums: [] })]) {
      const draft = draftFromScenario(s, base());
      const saved = scenarioForSave(draft, null);
      expect(saved && strategyKey(saved)).toBe(strategyKey(s));
    }
  });

  it('maps server errors through the indexes actually posted', () => {
    const draft = base();
    draft.mode = 'combined';
    draft.combined.recurring = [
      { id: 'r-empty', amount: null, startDate: null, endDate: null },
      { id: 'r-real', amount: 40, startDate: null, endDate: null },
    ];
    const { input, errorTargets } = buildSimulationRequest(draft);
    expect(input.recurringExtras).toEqual([{ amount: 40, startDate: null, endDate: null }]);
    const { byField, general } = mapFieldErrors({ 'recurringExtras[0].amount': ['Too big'], body: ['Unreadable'] }, errorTargets);
    expect(byField).toEqual({ 'combined.recurring.r-real.amount': 'Too big' });
    expect(general).toEqual(['Unreadable']);
  });

  it('saves the solved amount in target mode and nothing when there is no plan', () => {
    const draft = { ...base(), mode: 'target' as const };
    expect(scenarioForSave(draft, 274.95)).toEqual({ budgetPayment: null, recurringExtras: [{ amount: 274.95, startDate: null, endDate: null }], lumpSums: [] });
    expect(scenarioForSave(draft, null)).toBeNull();
    expect(scenarioForSave({ ...base(), extra: { amount: null, startDate: null } }, null)).toBeNull();
  });
});
