import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from './AppShell';
import { NAV_ITEMS } from './navigation';
import { PlaceholderPage } from '@/features/placeholder/PlaceholderPage';
import { NotFoundPage } from '@/features/placeholder/NotFoundPage';
import { DataPage } from '@/features/data/DataPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { IncomeSavingsPage } from '@/features/income/IncomeSavingsPage';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { RothIraPage } from '@/features/roth-ira/RothIraPage';
import { HsaPage } from '@/features/hsa/HsaPage';
import { RetirementIncomePage } from '@/features/retirement-income/RetirementIncomePage';
import { ScenariosPage } from '@/features/scenarios/ScenariosPage';
import { MonteCarloPage } from '@/features/monte-carlo/MonteCarloPage';
import { InsightsPage } from '@/features/insights/InsightsPage';
import { CalculatorsPage } from '@/features/calculators/CalculatorsPage';
import { PrintSummaryPage } from '@/features/print/PrintSummary';
import { RulesPage } from '@/features/rules/RulesPage';
import { ProfilesPage } from '@/features/profiles/ProfilesPage';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';
import { useProfileStore } from '@/state/profileStore';
import { getRepository } from '@/storage/instance';

const PAGES: Record<string, () => React.ReactElement> = {
  '/': () => <DashboardPage />,
  '/profile': () => <ProfilePage />,
  '/income': () => <IncomeSavingsPage />,
  '/accounts': () => <AccountsPage />,
  '/roth-ira': () => <RothIraPage />,
  '/hsa': () => <HsaPage />,
  '/retirement-income': () => <RetirementIncomePage />,
  '/scenarios': () => <ScenariosPage />,
  '/monte-carlo': () => <MonteCarloPage />,
  '/insights': () => <InsightsPage />,
  '/calculators': () => <CalculatorsPage />,
  '/rules': () => <RulesPage />,
  '/profiles': () => <ProfilesPage />,
  '/data': () => <DataPage />,
};

/** First-run: send people without a profile (or who have not finished onboarding) to the welcome flow. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const status = useProfileStore((s) => s.status);
  const hasProfiles = useProfileStore((s) => Object.keys(s.profiles).length > 0);
  const onboarded = useProfileStore((s) => s.onboardingComplete);
  const location = useLocation();
  const exempt = ['/welcome', '/data', '/rules'].includes(location.pathname);
  if (status === 'ready' && !exempt && (!hasProfiles || !onboarded)) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {NAV_ITEMS.map((item) => {
          const page = PAGES[item.path];
          return (
            <Route
              key={item.path}
              path={item.path}
              element={<OnboardingGate>{page ? page() : <PlaceholderPage item={item} />}</OnboardingGate>}
            />
          );
        })}
        <Route path="/welcome" element={<OnboardingPage />} />
        <Route
          path="/print"
          element={
            <OnboardingGate>
              <PrintSummaryPage />
            </OnboardingGate>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function Boot({ children }: { children: React.ReactNode }) {
  const status = useProfileStore((s) => s.status);
  const error = useProfileStore((s) => s.error);
  useEffect(() => {
    if (useProfileStore.getState().status === 'idle') {
      void getRepository().then((repo) => useProfileStore.getState().init(repo));
    }
    const flush = () => void useProfileStore.getState().flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);
  if (status === 'error') {
    return (
      <div role="alert" className="p-8">
        <h1 className="text-xl font-semibold">Could not open local storage</h1>
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (status !== 'ready') {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-muted-foreground" role="status">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading your plans…
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Boot>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </Boot>
  );
}
