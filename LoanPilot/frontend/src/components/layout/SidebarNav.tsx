import { Link, useLocation } from 'react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLoanContext } from '@/context/LoanContext';
import { cn } from '@/lib/utils';
import { isNavItemActive, NAV_ITEMS, resolveNavPath, type NavItem } from './nav';

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

/** The navigation list shared by the desktop sidebar and the mobile sheet. */
export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const { selectedLoanId } = useLoanContext();
  const { pathname } = useLocation();
  const main = NAV_ITEMS.filter((i) => !i.advanced && i.key !== 'settings');
  const advanced = NAV_ITEMS.filter((i) => i.advanced);
  const settings = NAV_ITEMS.filter((i) => i.key === 'settings');

  const renderItem = (item: NavItem) => {
    const active = isNavItemActive(item, pathname, selectedLoanId);
    const Icon = item.icon;
    const link = (
      <Link
        to={resolveNavPath(item, selectedLoanId)}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          'group flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-sidebar-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50',
          active && 'bg-sidebar-accent text-sidebar-accent-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon
          className={cn('size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground', active && 'text-primary group-hover:text-primary')}
          aria-hidden
        />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
    return (
      <li key={item.key}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        )}
      </li>
    );
  };

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6">
      <ul className="grid gap-0.5">{main.map(renderItem)}</ul>
      <div>
        {!collapsed ? (
          <div className="mb-1.5 px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Advanced</div>
        ) : (
          <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" aria-hidden />
        )}
        <ul className="grid gap-0.5">{advanced.map(renderItem)}</ul>
      </div>
      <ul className="mt-auto grid gap-0.5">{settings.map(renderItem)}</ul>
    </nav>
  );
}
