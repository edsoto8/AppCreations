import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';

// Each page lives in src/pages/<name>/ and is code-split, so pages can be built independently.
const LoanDetailsPage = lazy(() => import('@/pages/loan-details/LoanDetailsPage').then((m) => ({ default: m.LoanDetailsPage })));
const SimulatorPage = lazy(() => import('@/pages/simulator/SimulatorPage').then((m) => ({ default: m.SimulatorPage })));
const ComparePage = lazy(() => import('@/pages/compare/ComparePage').then((m) => ({ default: m.ComparePage })));
const SchedulePage = lazy(() => import('@/pages/schedule/SchedulePage').then((m) => ({ default: m.SchedulePage })));
const InsightsPage = lazy(() => import('@/pages/insights/InsightsPage').then((m) => ({ default: m.InsightsPage })));
const RefinancePage = lazy(() => import('@/pages/refinance/RefinancePage').then((m) => ({ default: m.RefinancePage })));
const PaymentsPage = lazy(() => import('@/pages/payments/PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const NotFoundPage = lazy(() => import('@/pages/not-found/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

function PageFallback() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="loans/new" element={<Lazy page={<LoanDetailsPage />} />} />
          <Route path="loans/:id/edit" element={<Lazy page={<LoanDetailsPage />} />} />
          <Route path="simulator" element={<Lazy page={<SimulatorPage />} />} />
          <Route path="compare" element={<Lazy page={<ComparePage />} />} />
          <Route path="schedule" element={<Lazy page={<SchedulePage />} />} />
          <Route path="insights" element={<Lazy page={<InsightsPage />} />} />
          <Route path="refinance" element={<Lazy page={<RefinancePage />} />} />
          <Route path="payments" element={<Lazy page={<PaymentsPage />} />} />
          <Route path="settings" element={<Lazy page={<SettingsPage />} />} />
          <Route path="*" element={<Lazy page={<NotFoundPage />} />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

/** Suspense inside the shell so the sidebar/top bar stay put while a page chunk loads. */
function Lazy({ page }: { page: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{page}</Suspense>;
}
