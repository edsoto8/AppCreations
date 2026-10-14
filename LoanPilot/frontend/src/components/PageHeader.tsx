import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** Browser tab title when `title` is not plain text. */
  documentTitle?: string;
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, className, documentTitle }: PageHeaderProps) {
  // Each page announces itself in the browser tab and history.
  const tabTitle = documentTitle ?? (typeof title === 'string' ? title : null);
  useEffect(() => {
    if (tabTitle === null) return;
    document.title = `${tabTitle} · LoanPilot`;
    return () => {
      document.title = 'LoanPilot';
    };
  }, [tabTitle]);

  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
