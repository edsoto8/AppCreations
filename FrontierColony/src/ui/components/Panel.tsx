import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type PanelPlacement = 'left' | 'right' | 'center';

export interface PanelProps {
  title: string;
  icon?: IconName;
  /** Replaces the icon and plain title in the title bar (e.g. an avatar and a name). */
  titleNode?: ReactNode;
  className?: string;
  /** Plays the close animation (the owner unmounts the panel a moment later). */
  closing?: boolean;
  placement?: PanelPlacement;
  /** Preferred width in px (clamped to the viewport). */
  width?: number;
  onClose: () => void;
  /** Extra controls rendered in the title bar before the close button. */
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Move focus into a dialog when it opens, keep Tab inside it, and give focus back to whatever had it
 * before when it closes.
 */
export function useDialogFocus(ref: React.RefObject<HTMLElement | null>, focusFirstControl = true) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? (focusFirstControl ? root.querySelector<HTMLElement>(FOCUSABLE) : null);
    (first ?? root).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (!root.contains(active)) {
        e.preventDefault();
        firstItem.focus();
      } else if (e.shiftKey && active === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [ref, focusFirstControl]);
}

/**
 * Reusable window: title bar with icon and close button, scrollable body. `left`/`right` panels dock to
 * a side of the playfield and do not block the map; `center` panels are modal dialogs over a scrim.
 */
export function Panel({ title, icon, titleNode, className, closing, placement = 'right', width = 360, onClose, actions, children, testId }: PanelProps) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const modal = placement === 'center';
  // Docked panels take focus on the panel itself (so no ring lands on the close button); dialogs on their first control.
  useDialogFocus(ref, modal);

  const body = (
    <section
      ref={ref}
      className={`panel panel--${placement}${className ? ` ${className}` : ''}${closing ? ' is-closing' : ''}`}
      style={{ ['--panel-w' as string]: `${width}px` }}
      role={modal ? 'dialog' : 'complementary'}
      aria-modal={modal ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid={testId}
    >
      <header className="panel__titlebar">
        {titleNode ? (
          <div className="panel__titlenode">
            <h2 id={titleId} className="sr-only">
              {title}
            </h2>
            {titleNode}
          </div>
        ) : (
          <>
            {icon && <Icon name={icon} className="panel__icon" />}
            <h2 id={titleId} className="panel__title">
              {title}
            </h2>
          </>
        )}
        <div className="panel__actions">
          {actions}
          <button type="button" className="btn ghost icon-only panel__close" onClick={onClose} aria-label={`Close ${title}`} data-testid="panel-close">
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );

  if (!modal) return body;
  return (
    <div
      className={`modal-scrim${closing ? ' is-closing' : ''}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {body}
    </div>
  );
}
