import type { ReactNode } from 'react';
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldInfo } from '@/components/FieldInfo';
import type { GlossaryKey } from '@/lib/glossary';
import { cn } from '@/lib/utils';

export interface StatTrend {
  direction: 'up' | 'down';
  label: ReactNode;
  /** Colour = direction × whether that direction is good. */
  tone: 'positive' | 'negative' | 'neutral';
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  info?: GlossaryKey;
  trend?: StatTrend;
  badge?: ReactNode;
  /** Shows an "Estimated" badge so the reader knows the figure is derived, not known. */
  estimated?: boolean;
  estimatedLabel?: string;
  loading?: boolean;
  className?: string;
  children?: ReactNode;
}

const toneClass: Record<StatTrend['tone'], string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-muted-foreground',
};

/** KPI tile: small muted label, big value, muted sub-text, optional trend / badges. */
export function StatCard({
  label,
  value,
  sub,
  icon,
  info,
  trend,
  badge,
  estimated,
  estimatedLabel = 'Estimated',
  loading,
  className,
  children,
}: StatCardProps) {
  return (
    <Card className={cn('gap-0 px-5 py-4', className)}>
      <div className="flex min-h-5 items-center gap-1.5 text-sm text-muted-foreground">
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
        <span className="font-medium">{label}</span>
        {info && <FieldInfo term={info} />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-32" />
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          {(estimated || badge) && (
            <span className="flex items-center gap-1.5">
              {estimated && <Badge variant="estimate">{estimatedLabel}</Badge>}
              {badge}
            </span>
          )}
        </div>
      )}
      {(sub || trend) && !loading && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {trend && (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', toneClass[trend.tone])}>
              {trend.direction === 'up' ? (
                <ArrowUpRightIcon className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownRightIcon className="size-3.5" aria-hidden />
              )}
              {trend.label}
            </span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      )}
      {children}
    </Card>
  );
}
