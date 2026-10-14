import type { ReactNode } from 'react';
import { CalendarRangeIcon, PlusIcon, Trash2Icon, WalletIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/CurrencyInput';
import { DateInput } from '@/components/DateInput';
import { FieldError, FormField } from '@/components/FormField';
import { FieldInfo } from '@/components/FieldInfo';
import { fieldIds, newRowId, type Draft, type LumpRow, type RecurringRow } from '../scenarioDraft';
import type { ControlsContext } from './context';
import { lumpTimingNote } from './LumpControls';

interface CombinedControlsProps {
  value: Draft['combined'];
  onChange: (next: Draft['combined']) => void;
  errors: Record<string, string>;
  ctx: ControlsContext;
}

const MAX_ROWS = 12;

export function CombinedControls({ value, onChange, errors, ctx }: CombinedControlsProps) {
  const setRecurring = (recurring: RecurringRow[]) => onChange({ ...value, recurring });
  const setLumps = (lumps: LumpRow[]) => onChange({ ...value, lumps });
  const patchRecurring = (id: string, patch: Partial<RecurringRow>) => setRecurring(value.recurring.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const patchLump = (id: string, patch: Partial<LumpRow>) => setLumps(value.lumps.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <div className="grid gap-6">
      <section aria-labelledby="combined-recurring-heading" className="grid gap-3">
        <SectionHeading id="combined-recurring-heading" icon={<CalendarRangeIcon />} title="Recurring extras" info="recurringExtra">
          Use several rows to change the amount over time, e.g. +$50 this year, then +$150.
        </SectionHeading>
        {value.recurring.length === 0 && <p className="text-sm text-muted-foreground">No recurring extras.</p>}
        {value.recurring.map((row, i) => (
          <RowCard key={row.id} title={`Extra #${i + 1}`} onRemove={() => setRecurring(value.recurring.filter((r) => r.id !== row.id))} removeLabel={`Remove recurring extra ${i + 1}`}>
            <FormField label={`Amount ${ctx.perPeriodLabel}`} htmlFor={`${row.id}-amount`}>
              <CurrencyInput
                id={`${row.id}-amount`}
                value={row.amount}
                onValueChange={(amount) => patchRecurring(row.id, { amount })}
                error={errors[fieldIds.recurring(row.id, 'amount')]}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="From" htmlFor={`${row.id}-start`} optional>
                <DateInput
                  id={`${row.id}-start`}
                  value={row.startDate}
                  min={ctx.minDate}
                  onValueChange={(startDate) => patchRecurring(row.id, { startDate })}
                  error={errors[fieldIds.recurring(row.id, 'startDate')]}
                />
              </FormField>
              <FormField label="Until" htmlFor={`${row.id}-end`} optional>
                <DateInput
                  id={`${row.id}-end`}
                  value={row.endDate}
                  min={row.startDate ?? ctx.minDate}
                  onValueChange={(endDate) => patchRecurring(row.id, { endDate })}
                  error={errors[fieldIds.recurring(row.id, 'endDate')]}
                />
              </FormField>
            </div>
          </RowCard>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          disabled={value.recurring.length >= MAX_ROWS}
          onClick={() => setRecurring([...value.recurring, { id: newRowId('r'), amount: null, startDate: null, endDate: null }])}
        >
          <PlusIcon /> Add recurring extra
        </Button>
      </section>

      <section aria-labelledby="combined-lumps-heading" className="grid gap-3">
        <SectionHeading id="combined-lumps-heading" icon={<WalletIcon />} title="Lump sums" info="lumpSum">
          {lumpTimingNote(ctx)}
        </SectionHeading>
        {value.lumps.length === 0 && <p className="text-sm text-muted-foreground">No lump sums.</p>}
        {value.lumps.map((row, i) => {
          const noteError = errors[fieldIds.lumpRow(row.id, 'note')];
          return (
            <RowCard key={row.id} title={`Lump sum #${i + 1}`} onRemove={() => setLumps(value.lumps.filter((l) => l.id !== row.id))} removeLabel={`Remove lump sum ${i + 1}`}>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Amount" htmlFor={`${row.id}-amount`}>
                  <CurrencyInput
                    id={`${row.id}-amount`}
                    value={row.amount}
                    onValueChange={(amount) => patchLump(row.id, { amount })}
                    error={errors[fieldIds.lumpRow(row.id, 'amount')]}
                  />
                </FormField>
                <FormField label="Date" htmlFor={`${row.id}-date`}>
                  <DateInput
                    id={`${row.id}-date`}
                    value={row.date}
                    min={ctx.minDate}
                    onValueChange={(date) => patchLump(row.id, { date })}
                    error={errors[fieldIds.lumpRow(row.id, 'date')]}
                  />
                </FormField>
              </div>
              <FormField label="Note" htmlFor={`${row.id}-note`} optional>
                <Input
                  id={`${row.id}-note`}
                  value={row.note}
                  maxLength={200}
                  placeholder="e.g. Annual bonus"
                  aria-invalid={noteError ? true : undefined}
                  aria-describedby={noteError ? `${row.id}-note-error` : undefined}
                  onChange={(e) => patchLump(row.id, { note: e.target.value })}
                />
                {noteError && <FieldError id={`${row.id}-note-error`}>{noteError}</FieldError>}
              </FormField>
            </RowCard>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          disabled={value.lumps.length >= MAX_ROWS}
          onClick={() => setLumps([...value.lumps, { id: newRowId('l'), amount: null, date: ctx.defaultLumpDate, note: '' }])}
        >
          <PlusIcon /> Add lump sum
        </Button>
      </section>

      <FormField
        label={`Fixed budget ${ctx.perPeriodLabel}`}
        htmlFor="combined-budget"
        optional
        hint="Pay this amount every period instead of the scheduled payment; the difference goes to principal, on top of the extras above."
      >
        <CurrencyInput
          id="combined-budget"
          value={value.budget}
          onValueChange={(budget) => onChange({ ...value, budget })}
          error={errors[fieldIds.combinedBudget]}
          placeholder="Not used"
        />
      </FormField>
    </div>
  );
}

function SectionHeading({ id, icon, title, info, children }: { id: string; icon: ReactNode; title: string; info: 'recurringExtra' | 'lumpSum'; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        <FieldInfo term={info} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function RowCard({ title, onRemove, removeLabel, children }: { title: string; onRemove: () => void; removeLabel: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="-mt-1 -mr-1 flex items-center justify-between">
        <legend className="float-left text-xs font-medium text-muted-foreground">{title}</legend>
        <Button variant="ghost" size="icon-sm" aria-label={removeLabel} onClick={onRemove} className="size-7 text-muted-foreground hover:text-negative">
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
      {children}
    </fieldset>
  );
}

