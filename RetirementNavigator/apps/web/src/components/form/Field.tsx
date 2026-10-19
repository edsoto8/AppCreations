import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { InfoTip } from '@/components/InfoTip';
import { cn } from '@/lib/utils';

export interface FieldChrome {
  label: string;
  /** Explanation shown in the info popover. */
  tip?: React.ReactNode;
  /** Plain-language example shown under the input. */
  example?: string;
  error?: string;
  className?: string;
}

export interface FieldRenderProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

/** Label + info + example + error around any input; wires ids for accessibility. */
export function Field({
  label,
  tip,
  example,
  error,
  className,
  children,
}: FieldChrome & { children: (p: FieldRenderProps) => React.ReactNode }) {
  const id = useId();
  const exampleId = `${id}-example`;
  const errorId = `${id}-error`;
  const describedBy = [example ? exampleId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        {tip ? <InfoTip term={label}>{tip}</InfoTip> : null}
      </div>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {example ? (
        <p id={exampleId} className="text-xs text-muted-foreground">
          {example}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
