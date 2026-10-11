import { useEffect, useRef } from 'react';
import { useGameController } from '../game';

/** Full-viewport host for the Pixi canvas. Mounts the controller's renderer and loop. */
export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const controller = useGameController();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    controller.mount(host).catch((err: unknown) => {
      console.error('Failed to start the renderer', err);
    });
    return () => controller.unmount();
  }, [controller]);

  return <div ref={hostRef} className="game-host" data-testid="game-host" />;
}
