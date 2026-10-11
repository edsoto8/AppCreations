import { useEffect, useRef } from 'react';
import { useUiStore, type Toast } from '../../store';
import { Icon, type IconName } from './Icon';

const ICON: Record<Toast['severity'], IconName> = { info: 'info', good: 'good', warning: 'warning', danger: 'danger' };
/** How long each severity stays on screen (ms). Danger lingers longest. */
export const TOAST_LIFETIME_MS: Record<Toast['severity'], number> = { info: 4500, good: 4500, warning: 7000, danger: 9000 };

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const timer = useRef<number | null>(null);

  const arm = (ms: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => dismiss(toast.id), ms);
  };
  useEffect(() => {
    arm(TOAST_LIFETIME_MS[toast.severity]);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [toast.id, toast.updatedAt]);

  return (
    <div
      className={`toast toast--${toast.severity}`}
      role={toast.severity === 'danger' || toast.severity === 'warning' ? 'alert' : 'status'}
      onPointerEnter={() => {
        if (timer.current !== null) window.clearTimeout(timer.current);
      }}
      onPointerLeave={() => arm(2500)}
      data-testid="toast"
    >
      <Icon name={ICON[toast.severity]} size={18} className="toast__icon" />
      <span className="toast__msg">{toast.message}</span>
      {toast.count > 1 && (
        <span className="toast__count" aria-label={`${toast.count} times`}>
          &times;{toast.count}
        </span>
      )}
      <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/** Stack of toasts driven by the store (newest at the bottom, nearest the toolbar). */
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div className="toast-host" aria-live="polite" data-testid="toast-host">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
