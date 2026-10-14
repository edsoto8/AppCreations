/** Route paths. Each page lives in src/pages/<name>/ and is registered in src/App.tsx. */
export const ROUTES = {
  dashboard: '/',
  newLoan: '/loans/new',
  editLoan: (id: number) => `/loans/${id}/edit`,
  simulator: '/simulator',
  compare: '/compare',
  schedule: '/schedule',
  insights: '/insights',
  refinance: '/refinance',
  payments: '/payments',
  settings: '/settings',
} as const;
