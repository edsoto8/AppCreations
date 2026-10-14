import { useState, type ReactNode } from 'react';
import { ChartAreaIcon, TableIcon } from 'lucide-react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

interface ChartCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** Legend row (required for two or more series). */
  legend?: ReactNode;
  /** The chart. Size it so the x-axis band is included in its height. */
  chart: ReactNode;
  /** Accessible table twin of the chart: every value is reachable without hovering. */
  table: ReactNode;
  className?: string;
  /** Holds the previous render at reduced opacity while refetching (no skeleton flash). */
  refreshing?: boolean;
}

export function ChartCard({ title, description, legend, chart, table, className, refreshing }: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={view}
            onValueChange={(v) => v && setView(v as 'chart' | 'table')}
            aria-label="Chart or table view"
          >
            <ToggleGroupItem value="chart" aria-label="Chart view">
              <ChartAreaIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table view">
              <TableIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className={cn('transition-opacity', refreshing && 'opacity-60')}>
        {view === 'chart' ? (
          <>
            {legend && <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">{legend}</div>}
            {chart}
          </>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-lg border">{table}</div>
        )}
      </CardContent>
    </Card>
  );
}
