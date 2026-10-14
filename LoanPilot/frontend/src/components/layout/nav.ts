import {
  CarFrontIcon,
  GitCompareArrowsIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  ReceiptIcon,
  RefreshCcwIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TablePropertiesIcon,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Static path, or a function of the selected loan id (Loan Details). */
  to: string | ((selectedLoanId: number | null) => string);
  /** Extra path prefixes that should mark this item active. */
  activePrefixes?: string[];
  end?: boolean;
  advanced?: boolean;
}

/** Sidebar order is part of the product spec — keep it. */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboardIcon, to: '/', end: true },
  {
    key: 'loan',
    label: 'Loan Details',
    icon: CarFrontIcon,
    to: (id) => (id === null ? '/loans/new' : `/loans/${id}/edit`),
    activePrefixes: ['/loans/'],
  },
  { key: 'simulator', label: 'Payoff Simulator', icon: SlidersHorizontalIcon, to: '/simulator' },
  { key: 'compare', label: 'Scenario Comparison', icon: GitCompareArrowsIcon, to: '/compare' },
  { key: 'schedule', label: 'Amortization Schedule', icon: TablePropertiesIcon, to: '/schedule' },
  { key: 'insights', label: 'Insights', icon: LightbulbIcon, to: '/insights' },
  { key: 'refinance', label: 'Refinance', icon: RefreshCcwIcon, to: '/refinance', advanced: true },
  { key: 'payments', label: 'Payments', icon: ReceiptIcon, to: '/payments', advanced: true },
  { key: 'settings', label: 'Settings', icon: SettingsIcon, to: '/settings' },
];

export function resolveNavPath(item: NavItem, selectedLoanId: number | null): string {
  return typeof item.to === 'function' ? item.to(selectedLoanId) : item.to;
}

export function isNavItemActive(item: NavItem, pathname: string, selectedLoanId: number | null): boolean {
  const path = resolveNavPath(item, selectedLoanId);
  if (item.end) return pathname === path;
  if (pathname === path || pathname.startsWith(`${path}/`)) return true;
  return item.activePrefixes?.some((p) => pathname.startsWith(p)) ?? false;
}
