import { useState, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createQueryClient } from '@/api/queries';
import { LoanProvider } from '@/context/LoanContext';
import { PreferencesProvider } from '@/context/PreferencesContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * Provider stack (outer → inner): React Query → preferences (GET/PUT /preferences, localStorage
 * fallback) → theme → tooltips → selected loan. Must sit inside a router.
 */
export function AppProviders({ children, queryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <PreferencesProvider>
        <ThemeProvider>
          <TooltipProvider>
            <LoanProvider>
              {children}
              <Toaster />
            </LoanProvider>
          </TooltipProvider>
        </ThemeProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
