import { useId } from 'react';
import { NavLink } from 'react-router';
import { NAV_ITEMS, type NavItem } from './navigation';
import { cn } from '@/lib/utils';

const GROUPS: NavItem['group'][] = ['Plan', 'Analyze', 'Tools'];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  // Unique per instance: the desktop sidebar and the mobile drawer can both be mounted.
  const idPrefix = useId();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {GROUPS.map((group) => (
        <div key={group}>
          <p
            id={`${idPrefix}-nav-${group}`}
            className="px-3 pb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {group}
          </p>
          <ul className="flex flex-col gap-0.5" aria-labelledby={`${idPrefix}-nav-${group}`}>
            {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-active',
                      isActive && 'bg-sidebar-active font-semibold text-foreground',
                    )
                  }
                >
                  <item.icon aria-hidden="true" className="size-4 shrink-0" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
