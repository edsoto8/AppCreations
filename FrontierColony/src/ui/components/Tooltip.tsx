import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** Tooltip body. Falsy content disables the tooltip. */
  content: ReactNode;
  /** Optional bold heading line. */
  title?: ReactNode;
  /** Preferred side; it flips when there is no room and always stays inside the viewport. */
  side?: TooltipSide;
  /** Delay before showing, in ms (default 380). Keyboard focus shows it immediately. */
  delay?: number;
  children: ReactNode;
  className?: string;
}

const MARGIN = 8;
const GAP = 10;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pure placement maths (exported for tests): put a `w`x`h` tooltip next to `anchor`, preferring `side`,
 * flipping to the opposite side when it would overflow, then clamping into the viewport.
 */
export function placeTooltip(
  anchor: Rect,
  w: number,
  h: number,
  viewW: number,
  viewH: number,
  side: TooltipSide,
): { left: number; top: number; side: TooltipSide } {
  const fits = (s: TooltipSide): boolean => {
    switch (s) {
      case 'top':
        return anchor.top - GAP - h >= MARGIN;
      case 'bottom':
        return anchor.top + anchor.height + GAP + h <= viewH - MARGIN;
      case 'left':
        return anchor.left - GAP - w >= MARGIN;
      case 'right':
        return anchor.left + anchor.width + GAP + w <= viewW - MARGIN;
    }
  };
  const opposite: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const chosen = fits(side) ? side : fits(opposite[side]) ? opposite[side] : side;
  let left: number;
  let top: number;
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  switch (chosen) {
    case 'top':
      left = cx - w / 2;
      top = anchor.top - GAP - h;
      break;
    case 'bottom':
      left = cx - w / 2;
      top = anchor.top + anchor.height + GAP;
      break;
    case 'left':
      left = anchor.left - GAP - w;
      top = cy - h / 2;
      break;
    case 'right':
      left = anchor.left + anchor.width + GAP;
      top = cy - h / 2;
      break;
  }
  left = Math.max(MARGIN, Math.min(left, viewW - w - MARGIN));
  top = Math.max(MARGIN, Math.min(top, viewH - h - MARGIN));
  return { left, top, side: chosen };
}

/**
 * Hover/focus tooltip. Wrap any focusable element. Shows after a short delay (immediately on keyboard
 * focus), is positioned next to the wrapped element and never leaves the viewport, hides on press,
 * scroll, Escape and when the pointer leaves. Touch input does not trigger it.
 */
export function Tooltip({ content, title, side = 'bottom', delay = 380, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; side: TooltipSide } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const id = useId();
  const enabled = Boolean(content) || Boolean(title);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPos(null);
  }, [clearTimer]);
  const show = useCallback(
    (wait: number) => {
      if (!enabled) return;
      clearTimer();
      if (wait <= 0) setOpen(true);
      else {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setOpen(true);
        }, wait);
      }
    },
    [enabled, clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  // Position after the tooltip is in the DOM (so it can be measured), before paint.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    setPos(placeTooltip({ left: a.left, top: a.top, width: a.width, height: a.height }, t.width, t.height, window.innerWidth, window.innerHeight, side));
  }, [open, side, content, title]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [open, hide]);

  return (
    <span
      ref={anchorRef}
      className={className ? `tt-anchor ${className}` : 'tt-anchor'}
      aria-describedby={open ? id : undefined}
      onPointerOver={(e) => {
        // A tooltip nested inside this one owns the pointer while it is over the inner anchor.
        const own = e.target instanceof Element && e.target.closest('.tt-anchor') === anchorRef.current;
        if (!own) {
          hide();
          return;
        }
        if (e.pointerType !== 'touch' && !open && timer.current === null) show(delay);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // Only keyboard focus (focus-visible) shows it immediately; a mouse click focus would be noise.
        if (e.target instanceof HTMLElement && e.target.matches(':focus-visible')) show(0);
      }}
      onBlur={hide}
    >
      {children}
      {open &&
        enabled &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={`tooltip tooltip--${pos?.side ?? side}`}
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
          >
            {title && <div className="tooltip__title">{title}</div>}
            {content && <div className="tooltip__body">{content}</div>}
          </div>,
          document.body,
        )}
    </span>
  );
}
