import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { FieldInfo } from '@/components/FieldInfo';
import type { GlossaryKey } from '@/lib/glossary';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: ReactNode;
  htmlFor: string;
  info?: GlossaryKey;
  /** Helper text under the control (hidden while an error shows). */
  hint?: ReactNode;
  /**
   * Error text. Leave undefined for CurrencyInput / PercentInput / DateInput, which render their own
   * error (pass it to the input instead) so the message sits right under the control.
   */
  error?: string;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

export function fieldMessageId(id: string, kind: 'error' | 'hint') {
  return `${id}-${kind}`;
}

/** Label (+ optional ⓘ term) above a control, with hint or error text below. */
export function FormField({ label, htmlFor, info, hint, error, optional, className, children }: FormFieldProps) {
  return (
    <div className={cn('grid content-start gap-2', className)}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {info && <FieldInfo term={info} />}
        {optional && <span className="ml-auto text-xs text-muted-foreground">Optional</span>}
      </div>
      {children}
      {error ? (
        <FieldError id={fieldMessageId(htmlFor, 'error')}>{error}</FieldError>
      ) : hint ? (
        <p id={fieldMessageId(htmlFor, 'hint')} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs font-medium text-negative" role="alert">
      {children}
    </p>
  );
}
