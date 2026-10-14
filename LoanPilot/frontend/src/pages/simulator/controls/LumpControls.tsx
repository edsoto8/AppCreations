import { CurrencyInput } from '@/components/CurrencyInput';
import { DateInput } from '@/components/DateInput';
import { FormField } from '@/components/FormField';
import { Input } from '@/components/ui/input';
import { FieldError } from '@/components/FormField';
import { formatDate } from '@/lib/format';
import { fieldIds, type Draft } from '../scenarioDraft';
import type { ControlsContext } from './context';
import { AlreadyPaidNote } from './AlreadyPaidNote';

interface LumpControlsProps {
  value: Draft['lump'];
  onChange: (next: Draft['lump']) => void;
  errors: Record<string, string>;
  ctx: ControlsContext;
}

export function lumpTimingNote(ctx: ControlsContext): string {
  return ctx.accrualMethod === 'dailySimple'
    ? 'With daily simple interest, a lump sum posts on its own date and stops interest on that principal from that day.'
    : 'With monthly interest, a lump sum is credited with the first payment due on or after its date.';
}

export function LumpControls({ value, onChange, errors, ctx }: LumpControlsProps) {
  const noteError = errors[fieldIds.lumpNote];
  return (
    <div className="grid gap-5">
      <FormField label="Lump-sum amount" htmlFor="lump-amount" info="lumpSum" hint="Goes entirely to principal.">
        <CurrencyInput
          id="lump-amount"
          value={value.amount}
          onValueChange={(amount) => onChange({ ...value, amount })}
          error={errors[fieldIds.lumpAmount]}
          placeholder="e.g. 2,000"
        />
      </FormField>
      <FormField label="Payment date" htmlFor="lump-date" hint={`On or after ${formatDate(ctx.minDate)}, when the projection starts.`}>
        <DateInput
          id="lump-date"
          value={value.date}
          min={ctx.minDate}
          onValueChange={(date) => onChange({ ...value, date })}
          error={errors[fieldIds.lumpDate]}
        />
        <AlreadyPaidNote date={value.date} balanceDate={ctx.minDate} />
      </FormField>
      <FormField label="Note" htmlFor="lump-note" optional>
        <Input
          id="lump-note"
          value={value.note}
          maxLength={200}
          placeholder="e.g. Tax refund"
          aria-invalid={noteError ? true : undefined}
          aria-describedby={noteError ? 'lump-note-error' : undefined}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
        {noteError && <FieldError id="lump-note-error">{noteError}</FieldError>}
      </FormField>
      <p className="text-xs leading-relaxed text-muted-foreground">{lumpTimingNote(ctx)}</p>
    </div>
  );
}
