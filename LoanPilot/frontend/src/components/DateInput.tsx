import { useId, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { FieldError } from '@/components/FormField';
import type { IsoDate } from '@/api/types';
import { isValidIsoDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface DateInputProps extends Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'min' | 'max'> {
  value: IsoDate | null;
  onValueChange: (value: IsoDate | null) => void;
  min?: IsoDate;
  max?: IsoDate;
  error?: string;
}

/** Native date picker (yyyy-MM-dd in and out, no timezone conversion), styled like the other inputs. */
export function DateInput({
  value,
  onValueChange,
  min,
  max,
  error,
  className,
  id: idProp,
  'aria-describedby': describedBy,
  ...props
}: DateInputProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const errorId = `${id}-error`;
  return (
    <div className="grid content-start gap-1.5">
      <Input
        {...props}
        id={id}
        type="date"
        value={value ?? ''}
        min={min}
        max={max}
        aria-invalid={error ? true : undefined}
        aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
        className={cn('num block [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100', className)}
        onChange={(e) => {
          const next = e.target.value;
          onValueChange(next && isValidIsoDate(next) ? next : null);
        }}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
