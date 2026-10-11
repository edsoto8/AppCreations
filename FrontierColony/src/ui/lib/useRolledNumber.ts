import { useEffect, useRef, useState } from 'react';

/** Ease-out cubic. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** True when the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * A number that rolls to its new value over `ms` instead of jumping. The first value is shown at once,
 * and with reduced motion every change is immediate.
 */
export function useRolledNumber(target: number, ms = 420): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (current.current === target) return;
    if (prefersReducedMotion() || ms <= 0) {
      current.current = target;
      setShown(target);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const value = from + (target - from) * easeOut(t);
      current.current = value;
      setShown(value);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}
