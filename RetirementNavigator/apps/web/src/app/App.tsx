import { HashRouter, Route, Routes } from 'react-router';
import { AppShell } from './AppShell';
import { NAV_ITEMS } from './navigation';
import { PlaceholderPage } from '@/features/placeholder/PlaceholderPage';
import { DataPage } from '@/features/data/DataPage';
import { NotFoundPage } from '@/features/placeholder/NotFoundPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {NAV_ITEMS.map((item) =>
          item.path === '/data' ? (
            <Route key={item.path} path={item.path} element={<DataPage />} />
          ) : (
            <Route key={item.path} path={item.path} element={<PlaceholderPage item={item} />} />
          ),
        )}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}
