import { describe, expect, it } from 'vitest';
import { SAMPLE_PROFILES } from './profiles';
import { previewAccumulation } from '../income/preview';
import { fixtureRules, FIXTURE_YEAR } from '../testing/fixtureRules';

describe('sample profiles', () => {
  it('provides the four required samples', () => {
    expect(SAMPLE_PROFILES.map((s) => s.id)).toEqual([
      'earlyCareer',
      'midCareerCouple',
      'nearRetirement',
      'highEarner',
    ]);
  });

  it.each(SAMPLE_PROFILES)('$id builds a valid household that previews without errors', (sample) => {
    const h = sample.build(FIXTURE_YEAR);
    expect(h.people.length).toBe(sample.id === 'midCareerCouple' ? 2 : 1);
    const p = previewAccumulation(h, { currentYear: FIXTURE_YEAR, rules: fixtureRules() }, 10);
    expect(p.status).toBe('ok');
  });
});
