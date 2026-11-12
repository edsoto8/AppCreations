import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppController } from './AppController';
import { AppContext } from './context';

/**
 * Creates the single AppController once the viewport element exists and provides it to the UI.
 * `children` render around the viewport; they must place <ViewportSlot /> where the 3D view goes —
 * we render the canvas host here and the UI positions it via the `viewport` render prop.
 */
export function AppProvider({ children }: { children: (viewport: ReactNode) => ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<AppController | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ctrl = new AppController(host);
    setApi(ctrl);
    (window as unknown as { __robovac?: AppController }).__robovac = ctrl;
    return () => {
      ctrl.dispose();
      setApi(null);
    };
  }, []);

  const viewport = <div ref={hostRef} className="viewport-host" data-testid="viewport" />;
  return <AppContext.Provider value={api}>{children(viewport)}</AppContext.Provider>;
}
