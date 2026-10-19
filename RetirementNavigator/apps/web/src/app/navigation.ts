import {
  Activity,
  BarChart3,
  Calculator,
  Database,
  FileCheck2,
  GitCompare,
  HeartPulse,
  Landmark,
  Lightbulb,
  LayoutDashboard,
  PiggyBank,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Milestone that builds the page (shown on placeholders until then). */
  milestone: string;
  description: string;
  group: 'Plan' | 'Analyze' | 'Tools';
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    milestone: 'M3',
    group: 'Plan',
    description: 'Your retirement outlook at a glance: savings, income, spending and portfolio longevity.',
  },
  {
    path: '/profile',
    label: 'Profile',
    icon: User,
    milestone: 'M2',
    group: 'Plan',
    description: 'Ages, retirement and planning ages, filing status, spending and assumptions for you and a partner.',
  },
  {
    path: '/income',
    label: 'Income & Savings',
    icon: Wallet,
    milestone: 'M2',
    group: 'Plan',
    description: 'Salary, bonus, raises, workplace-plan contributions and employer match, with a 10-year preview.',
  },
  {
    path: '/accounts',
    label: 'Accounts',
    icon: PiggyBank,
    milestone: 'M2',
    group: 'Plan',
    description: 'Balances, contributions, returns and fees for each account.',
  },
  {
    path: '/roth-ira',
    label: 'Roth IRA',
    icon: Landmark,
    milestone: 'M2',
    group: 'Plan',
    description: 'Roth IRA eligibility, allowed contribution and limits.',
  },
  {
    path: '/hsa',
    label: 'HSA',
    icon: HeartPulse,
    milestone: 'M2',
    group: 'Plan',
    description: 'Health savings account limits and contributions.',
  },
  {
    path: '/retirement-income',
    label: 'Retirement Income',
    icon: BarChart3,
    milestone: 'M4',
    group: 'Analyze',
    description: 'Social Security, pensions, withdrawals, taxes and net income in retirement.',
  },
  {
    path: '/scenarios',
    label: 'Scenarios',
    icon: GitCompare,
    milestone: 'M5',
    group: 'Analyze',
    description: 'Compare what-if scenarios side by side.',
  },
  {
    path: '/monte-carlo',
    label: 'Monte Carlo',
    icon: Activity,
    milestone: 'M6',
    group: 'Analyze',
    description: 'Range of outcomes under market uncertainty (model-dependent estimates).',
  },
  {
    path: '/insights',
    label: 'Insights',
    icon: Lightbulb,
    milestone: 'M7b',
    group: 'Analyze',
    description: 'What-if observations computed by re-running your plan.',
  },
  {
    path: '/calculators',
    label: 'Calculators',
    icon: Calculator,
    milestone: 'M7a',
    group: 'Tools',
    description: 'Standalone calculators built on the same engine.',
  },
  {
    path: '/rules',
    label: 'Rules & Sources',
    icon: FileCheck2,
    milestone: 'M2',
    group: 'Tools',
    description: 'Every regulatory value used, its official source, retrieval date and verification status.',
  },
  {
    path: '/profiles',
    label: 'Profiles',
    icon: Users,
    milestone: 'M2',
    group: 'Tools',
    description: 'Create, switch, rename, duplicate and delete profiles.',
  },
  {
    path: '/data',
    label: 'Data & Privacy',
    icon: Database,
    milestone: 'M1',
    group: 'Tools',
    description: 'Where your data lives, import/export and deleting your data.',
  },
];
