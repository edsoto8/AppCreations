import { Suspense, lazy, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from './AppShell';
import { NAV_ITEMS } from './navigation';
import { PageErrorBoundary } from '@/components/PageErrorBoundary';
import { PlaceholderPage } from '@/features/placeholder/PlaceholderPage';
import { NotFoundPage } from '@/features/placeholder/NotFoundPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { useProfileStore } from '@/state/profileStore';
import { getRepository } from '@/storage/instance';

/** Pages other than the dashboard (onboarding included) load on first visit (route-level code splitting, M8 performance). */
const OnboardingPage = lazy(() =>
  import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
);
const DataPage = lazy(() => import('@/features/data/DataPage').then((m) => ({ default: m.DataPage })));
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const IncomeSavingsPage = lazy(() =>
  import('@/features/income/IncomeSavingsPage').then((m) => ({ default: m.IncomeSavingsPage })),
);
const AccountsPage = lazy(() => import('@/features/accounts/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const RothIraPage = lazy(() => import('@/features/roth-ira/RothIraPage').then((m) => ({ default: m.RothIraPage })));
const HsaPage = lazy(() => import('@/features/hsa/HsaPage').then((m) => ({ default: m.HsaPage })));
const RetirementIncomePage = lazy(() =>
  import('@/features/retirement-income/RetirementIncomePage').then((m) => ({ default: m.RetirementIncomePage })),
);
const ScenariosPage = lazy(() =>
  import('@/features/scenarios/ScenariosPage').then((m) => ({ default: m.ScenariosPage })),
);
const MonteCarloPage = lazy(() =>
  import('@/features/monte-carlo/MonteCarloPage').then((m) => ({ default: m.MonteCarloPage })),
);
const InsightsPage = lazy(() => import('@/features/insights/InsightsPage').then((m) => ({ default: m.InsightsPage })));
const CalculatorsPage = lazy(() =>
  import('@/features/calculators/CalculatorsPage').then((m) => ({ default: m.CalculatorsPage })),
);
const PrintSummaryPage = lazy(() =>
  import('@/features/print/PrintSummary').then((m) => ({ default: m.PrintSummaryPage })),
);
const RulesPage = lazy(() => import('@/features/rules/RulesPage').then((m) => ({ default: m.RulesPage })));
const ProfilesPage = lazy(() => import('@/features/profiles/ProfilesPage').then((m) => ({ default: m.ProfilesPage })));

function PageLoading() {
  return (
    <div role="status" className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading…
    </div>
  );
}

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
              element={
                <OnboardingGate>
                  <PageErrorBoundary resetKey={item.path}>
                    <Suspense fallback={<PageLoading />}>{page ? page() : <PlaceholderPage item={item} />}</Suspense>
                  </PageErrorBoundary>
                </OnboardingGate>
              }
            />
          );
        })}
        <Route
          path="/welcome"
          element={
            <PageErrorBoundary resetKey="/welcome">
              <Suspense fallback={<PageLoading />}>
                <OnboardingPage />
              </Suspense>
            </PageErrorBoundary>
          }
        />
        <Route
          path="/print"
          element={
            <OnboardingGate>
              <PageErrorBoundary resetKey="/print">
                <Suspense fallback={<PageLoading />}>
                  <PrintSummaryPage />
                </Suspense>
              </PageErrorBoundary>
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
