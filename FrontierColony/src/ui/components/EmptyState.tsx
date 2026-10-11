import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Consistent "nothing here yet" block: a muted icon, a line of text, and an optional hint or action. */
export function EmptyState({ icon = 'info', children, hint, testId }: { icon?: IconName; children: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="empty-state" data-testid={testId}>
      <Icon name={icon} size={26} className="empty-state__icon" />
      <p className="empty-state__text">{children}</p>
      {hint && <p className="empty-state__hint">{hint}</p>}
    </div>
  );
}
