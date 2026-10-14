import { AlertTriangleIcon, InfoIcon, OctagonAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { CalcWarning, Severity } from '@/api/types';

const config: Record<Severity, { variant: 'info' | 'warning' | 'destructive'; title: string; Icon: typeof InfoIcon }> = {
  info: { variant: 'info', title: 'Note', Icon: InfoIcon },
  warning: { variant: 'warning', title: 'Heads up', Icon: AlertTriangleIcon },
  critical: { variant: 'destructive', title: 'Needs attention', Icon: OctagonAlertIcon },
};

const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Merges warning lists, drops duplicate codes, and sorts by severity. */
export function mergeWarnings(...lists: (CalcWarning[] | null | undefined)[]): CalcWarning[] {
  const seen = new Set<string>();
  const out: CalcWarning[] = [];
  for (const list of lists) {
    for (const w of list ?? []) {
      const key = `${w.code}|${w.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
  }
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Calculation warnings as alerts; the icon and title carry the severity, never colour alone. */
export function WarningList({ warnings, compact = false }: { warnings: CalcWarning[]; compact?: boolean }) {
  if (warnings.length === 0) return null;
  return (
    <div className="grid gap-2">
      {warnings.map((w) => {
        const { variant, title, Icon } = config[w.severity];
        return (
          <Alert key={`${w.code}-${w.message}`} variant={variant} data-severity={w.severity}>
            <Icon />
            {!compact && <AlertTitle>{title}</AlertTitle>}
            <AlertDescription className={compact ? 'text-foreground' : undefined}>
              <p>{w.message}</p>
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
