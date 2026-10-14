import { useState } from 'react';
import { Outlet } from 'react-router';
import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { readStorage, STORAGE_KEYS, writeStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { Brand } from './Brand';
import { LoanSelector } from './LoanSelector';
import { SidebarNav } from './SidebarNav';
import { ThemeToggle } from './ThemeToggle';

/**
 * Full-width top bar (brand, loan selector, theme) over a collapsible sidebar on desktop;
 * on small screens the sidebar becomes a sheet opened from the menu button.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => readStorage(STORAGE_KEYS.sidebarCollapsed) === 'true');
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      writeStorage(STORAGE_KEYS.sidebarCollapsed, String(!c));
      return !c;
    });
  };

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <MenuIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:inline-flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          onClick={toggleCollapsed}
        >
          {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
        </Button>
        <Brand className="mr-2 hidden sm:flex" />
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <div className="min-w-0 flex-1">
          <LoanSelector />
        </div>
        <ThemeToggle />
      </header>

      <div className="flex">
        <aside
          className={cn(
            'sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-r bg-sidebar px-3 py-4 transition-[width] duration-200 ease-out lg:flex',
            collapsed ? 'w-[4.25rem]' : 'w-60',
          )}
          aria-label="Sidebar"
        >
          <SidebarNav collapsed={collapsed} />
        </aside>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
          <SheetHeader className="border-b">
            <SheetTitle asChild>
              <div>
                <Brand />
              </div>
            </SheetTitle>
            <SheetDescription className="sr-only">Navigate LoanPilot</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
