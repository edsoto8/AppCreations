import { describe, expect, it } from 'vitest';
import { describeIssuePath, fileSlug, issueLine, technicalPath } from './fileUtils';

describe('data file helpers', () => {
  it('describes issue paths in plain words', () => {
    const path = ['profiles', 0, 'household', 'people', 1, 'birthYear'];
    expect(describeIssuePath(path)).toBe('Profile 1 › person 2 › birth year');
    expect(technicalPath(path)).toBe('profiles[0].household.people[1].birthYear');
    expect(describeIssuePath(['scenarios', 2, 'scenario', 'ops', 0, 'path'])).toBe('Scenario 3 › change 1 › path');
    expect(describeIssuePath(['settings', 'activeProfileId'])).toBe('Settings › active profile id');
    expect(describeIssuePath([])).toBe('The file');
    expect(describeIssuePath(['profiles', 'x', 3])).toBe('Profiles › x › item 4');
    expect(issueLine({ path: ['format'], message: 'Not an export' })).toBe('Format: Not an export');
  });

  it('makes safe file-name slugs', () => {
    expect(fileSlug('Mid-career couple (sample)')).toBe('mid-career-couple-sample');
    expect(fileSlug('***')).toBe('profile');
    expect(fileSlug('a'.repeat(60))).toHaveLength(40);
  });
});
