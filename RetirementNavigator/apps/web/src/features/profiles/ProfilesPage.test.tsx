import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProfile } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { ProfilesPage } from './ProfilesPage';

const count = () => Object.keys(useProfileStore.getState().profiles).length;

describe('ProfilesPage', () => {
  it('duplicates, renames, switches and deletes profiles', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<ProfilesPage />);
    expect(count()).toBe(1);
    await user.click(screen.getByRole('button', { name: /Duplicate Mid-career couple/ }));
    await waitFor(() => expect(count()).toBe(2));

    await user.click(screen.getByRole('button', { name: 'Rename Mid-career couple (sample) (copy)' }));
    const input = screen.getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'What-if');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('What-if')).toBeInTheDocument());

    const original = Object.values(useProfileStore.getState().profiles).find((p) =>
      p.household.name.startsWith('Mid-career'),
    )!;
    await user.click(screen.getByRole('button', { name: 'Make active' }));
    expect(useProfileStore.getState().activeId).toBe(original.id);

    await user.click(screen.getByRole('button', { name: 'Delete What-if' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(count()).toBe(1));
  });

  it('adds a sample profile copy', async () => {
    const user = userEvent.setup();
    await renderWithProfile(<ProfilesPage />);
    await user.selectOptions(screen.getByLabelText('Sample'), 'highEarner');
    await user.click(screen.getByRole('button', { name: 'Add sample' }));
    await waitFor(() => expect(count()).toBe(2));
    expect(
      Object.values(useProfileStore.getState().profiles).some((p) => p.household.name === 'High earner (sample)'),
    ).toBe(true);
  });
});
