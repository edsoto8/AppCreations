import { createContext, useContext } from 'react';
import type { AppApi } from './types';

export const AppContext = createContext<AppApi | null>(null);

/** Access the AppController API from React components. */
export function useApp(): AppApi {
  const api = useContext(AppContext);
  if (!api) throw new Error('useApp() outside <AppContext.Provider>');
  return api;
}
