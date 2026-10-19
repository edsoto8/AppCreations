import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { openDatabase } from '@/storage/db';
import { DocumentRepository } from '@/storage/repository';
import { useProfileStore } from '@/state/profileStore';
import { OnboardingPage } from './OnboardingPage';

let n = 0;
beforeEach(async () => {
  await useProfileStore.getState().init(new DocumentRepository(await openDatabase(`onboarding-${++n}`)));
});

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <Routes>
        <Route path="/welcome" element={<OnboardingPage />} />
        <Route path="/profile" element={<h1>Profile page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OnboardingPage', () => {
  it('starts from a sample, shows the income step and finishes', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    expect(screen.getByText(/stored unencrypted/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Use this sample' })[2]!);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /10-year income and savings preview/ })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /Finish setup/ }));
    expect(useProfileStore.getState().onboardingComplete).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Profile page' })).toBeInTheDocument();
  });

  it('creates a blank couple profile from the basics form and validates it', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: /Start blank/ }));
    const retirement = screen.getByLabelText('Your retirement age');
    await user.clear(retirement);
    await user.type(retirement, '130');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.clear(retirement);
    await user.type(retirement, '62');
    await user.click(screen.getByRole('switch', { name: /Plan with a spouse/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() => expect(Object.keys(useProfileStore.getState().profiles)).toHaveLength(1));
    const h = Object.values(useProfileStore.getState().profiles)[0]!.household;
    expect(h).toMatchObject({ filingStatus: 'marriedFilingJointly', accounts: [] });
    expect(h.people[0]!.retirementAge).toBe(62);
  });
});
