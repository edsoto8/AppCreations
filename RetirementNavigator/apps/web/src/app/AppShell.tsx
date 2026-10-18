import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Compass, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Disclaimer } from '@/components/Disclaimer';
import { SidebarNav } from './SidebarNav';
import { ThemeToggle } from './ThemeToggle';
import { NAV_ITEMS } from './navigation';

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-6 py-5">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Compass aria-hidden="true" className="size-4.5" />
      </span>
      <span className="text-[0.95rem] font-semibold tracking-tight">Retirement Navigator</span>
    </div>
  );
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const current = NAV_ITEMS.find((item) => item.path === location.pathname);
  const pageLabel = current?.label ?? 'Page not found';
  const firstRender = useRef(true);

  // Per-route title (WCAG 2.4.2) and focus to the new content after client-side navigation.
  useEffect(() => {
    document.title = `${pageLabel} · Retirement Navigator`;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById('main')?.focus();
  }, [location.pathname, pageLabel]);

  return (
    <div className="min-h-dvh bg-background">
      {/* HashRouter owns the URL hash, so the skip link moves focus itself instead of navigating. */}
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-sidebar md:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <p className="border-t px-6 py-4 text-xs text-muted-foreground">Your data stays on this device.</p>
      </aside>

      <div className="flex min-h-dvh flex-col md:pl-64">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-8">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">Main sections of Retirement Navigator</SheetDescription>
              <Brand />
              <div className="flex-1 overflow-y-auto">
                <SidebarNav onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <p className="truncate text-sm font-medium text-muted-foreground">
            {current?.label ?? 'Retirement Navigator'}
          </p>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 focus:outline-none md:px-8">
          <Outlet />
        </main>

        <footer className="mx-auto w-full max-w-6xl border-t px-4 py-5 md:px-8">
          <Disclaimer />
        </footer>
      </div>
    </div>
  );
}
