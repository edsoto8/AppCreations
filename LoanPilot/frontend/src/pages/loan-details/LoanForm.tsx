import { useMemo, useState, type FocusEvent, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AlertCircleIcon, HistoryIcon, LoaderCircleIcon, SaveIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CurrencyInput } from '@/components/CurrencyInput';
import { DateInput } from '@/components/DateInput';
import { FieldInfo } from '@/components/FieldInfo';
import { fieldMessageId, FormField } from '@/components/FormField';
import { NumberField } from '@/components/NumberField';
import { PercentInput } from '@/components/PercentInput';
import { errorMessage, isApiError, type FieldErrors } from '@/api/client';
import { useLoanMutations } from '@/api/queries';
import type { AccrualMethod, DayCountBasis, Loan, PaymentFrequency } from '@/api/types';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency } from '@/context/PreferencesContext';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatCurrency, todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  FIELD_ORDER,
  fieldId,
  formToInput,
  previewInput,
  TERM_QUICK_PICKS,
  validateLoanForm,
  type LoanFormField,
  type LoanFormValues,
} from './loanForm';
import { LoanPreviewPanel, useLoanPreview } from './LoanPreviewPanel';

const FREQUENCIES: { value: PaymentFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'biweekly', label: 'Every two weeks (biweekly)' },
  { value: 'weekly', label: 'Weekly' },
];

const ACCRUAL_OPTIONS: { value: AccrualMethod; title: string; description: string }[] = [
  {
    value: 'monthly',
    title: 'Monthly periodic',
    description: 'Interest is APR ÷ periods per year (÷ 12 when monthly) of the balance each period, no matter how many days it has. Matches most payment calculators.',
  },
  {
    value: 'dailySimple',
    title: 'Daily simple interest',
    description: 'Interest builds every day on the principal. Common for U.S. auto loans; paying early saves a little, paying late costs a little.',
  },
];

const DAY_COUNT_OPTIONS: { value: DayCountBasis; label: string }[] = [
  { value: 'actual365', label: 'Actual/365 (always 365 days)' },
  { value: 'actualActual', label: 'Actual/Actual (366 in leap years)' },
];

const DEBOUNCE_MS = 300;

interface LoanFormProps {
  mode: 'create' | 'edit';
  initialValues: LoanFormValues;
  loan?: Loan;
}

export function LoanForm({ mode, initialValues, loan }: LoanFormProps) {
  const navigate = useNavigate();
  const currency = useCurrency();
  const { setSelectedLoanId } = useLoanContext();
  const { create, update } = useLoanMutations();

  const [values, setValues] = useState<LoanFormValues>(initialValues);
  const [touched, setTouched] = useState<ReadonlySet<LoanFormField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const today = todayIso();
  const clientErrors = useMemo(() => validateLoanForm(values, today), [values, today]);
  const debouncedValues = useDebouncedValue(values, DEBOUNCE_MS);
  const preview = useMemo(() => previewInput(debouncedValues, today), [debouncedValues, today]);
  const previewQuery = useLoanPreview(preview);
  const standardPayment = preview ? previewQuery.data?.status.standardPayment : undefined;

  const saving = create.isPending || update.isPending;

  function set<K extends LoanFormField>(field: K, value: LoanFormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }));
    if (serverErrors[field]) {
      setServerErrors(({ [field]: _removed, ...rest }) => rest);
    }
  }

  function errorFor(field: LoanFormField): string | undefined {
    const server = serverErrors[field]?.[0];
    if (server) return server;
    if (submitted || touched.has(field)) return clientErrors[field];
    return undefined;
  }

  function onBlurCapture(e: FocusEvent<HTMLFormElement>) {
    const id = e.target.id;
    if (!id?.startsWith('loan-')) return;
    const field = id.slice('loan-'.length) as LoanFormField;
    if (!touched.has(field)) setTouched((t) => new Set(t).add(field));
  }

  function focusField(field: LoanFormField) {
    const el = document.getElementById(fieldId(field));
    el?.focus();
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    const invalid = FIELD_ORDER.filter((f) => clientErrors[f]);
    if (invalid.length > 0) {
      setFormError(invalid.length === 1 ? 'One field needs attention.' : `${invalid.length} fields need attention.`);
      focusField(invalid[0]);
      return;
    }

    const input = formToInput(values);
    try {
      if (mode === 'create') {
        const created = await create.mutateAsync(input);
        setSelectedLoanId(created.id);
        toast.success(`${created.name} added`, { description: 'Your dashboard is ready.' });
        navigate('/');
      } else if (loan) {
        await update.mutateAsync({ id: loan.id, input });
        setServerErrors({});
        toast.success('Changes saved');
      }
    } catch (err) {
      if (isApiError(err) && err.isValidation) {
        const known: FieldErrors = {};
        const other: string[] = [];
        for (const [key, messages] of Object.entries(err.errors)) {
          if ((FIELD_ORDER as string[]).includes(key)) known[key] = messages;
          else other.push(...messages);
        }
        setServerErrors(known);
        const firstServerField = FIELD_ORDER.find((f) => known[f]);
        setFormError(other.length > 0 ? other.join(' ') : firstServerField ? 'The server could not accept some values.' : err.message);
        if (firstServerField) focusField(firstServerField);
      } else {
        setFormError(errorMessage(err));
      }
    }
  }

  const describedBy = (field: LoanFormField, hasHint = false) =>
    errorFor(field) ? fieldMessageId(fieldId(field), 'error') : hasHint ? fieldMessageId(fieldId(field), 'hint') : undefined;

  return (
    <form noValidate onSubmit={onSubmit} onBlurCapture={onBlurCapture} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="grid min-w-0 gap-6">
        {formError && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Check the highlighted fields</AlertTitle>
            <AlertDescription>
              <p>{formError}</p>
            </AlertDescription>
          </Alert>
        )}

        <Section title="Vehicle" description="How this loan appears across LoanPilot.">
          <FormField label="Loan name" htmlFor={fieldId('name')} error={errorFor('name')} className="sm:col-span-2">
            <Input
              id={fieldId('name')}
              value={values.name}
              placeholder="e.g. 2024 Toyota RAV4"
              maxLength={120}
              aria-invalid={errorFor('name') ? true : undefined}
              aria-describedby={describedBy('name')}
              onChange={(e) => set('name', e.target.value)}
              autoFocus={mode === 'create'}
            />
          </FormField>
          <FormField label="Make" htmlFor={fieldId('vehicleMake')} optional>
            <Input id={fieldId('vehicleMake')} value={values.vehicleMake} placeholder="e.g. Toyota" onChange={(e) => set('vehicleMake', e.target.value)} />
          </FormField>
          <FormField label="Model" htmlFor={fieldId('vehicleModel')} optional>
            <Input id={fieldId('vehicleModel')} value={values.vehicleModel} placeholder="e.g. RAV4" onChange={(e) => set('vehicleModel', e.target.value)} />
          </FormField>
          <FormField label="Year" htmlFor={fieldId('vehicleYear')} optional>
            <NumberField
              id={fieldId('vehicleYear')}
              value={values.vehicleYear}
              onValueChange={(v) => set('vehicleYear', v)}
              decimals={0}
              grouping={false}
              error={errorFor('vehicleYear')}
            />
          </FormField>
        </Section>

        <Section title="Original terms" description="Copy these from your retail installment contract.">
          <FormField label="Original loan amount" htmlFor={fieldId('originalAmount')} info="principal" hint="The amount you financed, after your down payment.">
            <CurrencyInput
              id={fieldId('originalAmount')}
              value={values.originalAmount}
              onValueChange={(v) => set('originalAmount', v)}
              error={errorFor('originalAmount')}
              aria-describedby={describedBy('originalAmount', true)}
            />
          </FormField>
          <FormField label="Down payment" htmlFor={fieldId('downPayment')} info="downPayment" optional>
            <CurrencyInput
              id={fieldId('downPayment')}
              value={values.downPayment}
              onValueChange={(v) => set('downPayment', v)}
              placeholder="0.00"
              error={errorFor('downPayment')}
            />
          </FormField>
          <FormField label="APR" htmlFor={fieldId('aprPercent')} info="apr">
            <PercentInput
              id={fieldId('aprPercent')}
              value={values.aprPercent}
              onValueChange={(v) => set('aprPercent', v)}
              error={errorFor('aprPercent')}
            />
          </FormField>
          <div className="grid content-start gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={fieldId('termMonths')}>Term</Label>
              <FieldInfo term="amortization" />
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <div className="w-28">
                <NumberField
                  id={fieldId('termMonths')}
                  value={values.termMonths}
                  onValueChange={(v) => set('termMonths', v)}
                  decimals={0}
                  grouping={false}
                  suffix="mo"
                  suffixPaddingClassName="pr-10"
                  error={errorFor('termMonths')}
                />
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                aria-label="Common terms"
                value={values.termMonths !== null && (TERM_QUICK_PICKS as readonly number[]).includes(values.termMonths) ? String(values.termMonths) : ''}
                onValueChange={(v) => v && set('termMonths', Number(v))}
              >
                {TERM_QUICK_PICKS.map((m) => (
                  <ToggleGroupItem key={m} value={String(m)} className="num px-3" aria-label={`${m} months`}>
                    {m}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
          <FormField label="Start date" htmlFor={fieldId('startDate')}>
            <DateInput id={fieldId('startDate')} value={values.startDate} onValueChange={(v) => set('startDate', v)} error={errorFor('startDate')} />
          </FormField>
          <FormField label="First payment date" htmlFor={fieldId('firstPaymentDate')}>
            <DateInput
              id={fieldId('firstPaymentDate')}
              value={values.firstPaymentDate}
              min={values.startDate ?? undefined}
              onValueChange={(v) => set('firstPaymentDate', v)}
              error={errorFor('firstPaymentDate')}
            />
          </FormField>
          <FormField label="Payment frequency" htmlFor={fieldId('paymentFrequency')} error={errorFor('paymentFrequency')}>
            <Select value={values.paymentFrequency} onValueChange={(v) => set('paymentFrequency', v as PaymentFrequency)}>
              <SelectTrigger id={fieldId('paymentFrequency')} aria-invalid={errorFor('paymentFrequency') ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={fieldId('useStandardPayment')}>Use standard payment</Label>
                  <FieldInfo term="scheduledPayment" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {values.useStandardPayment
                    ? standardPayment !== undefined
                      ? `LoanPilot will use ${formatCurrency(standardPayment, currency)}, the payment that pays the loan off exactly on term.`
                      : 'LoanPilot will use the payment that pays the loan off exactly on term.'
                    : 'Enter the payment shown on your statement if it differs from the standard amount.'}
                </p>
              </div>
              <Switch
                id={fieldId('useStandardPayment')}
                checked={values.useStandardPayment}
                onCheckedChange={(checked) => {
                  set('useStandardPayment', checked);
                  if (!checked && values.scheduledPayment === null && standardPayment !== undefined) {
                    set('scheduledPayment', standardPayment);
                  }
                }}
              />
            </div>
            {!values.useStandardPayment && (
              <FormField label="Scheduled payment" htmlFor={fieldId('scheduledPayment')} className="max-w-xs">
                <CurrencyInput
                  id={fieldId('scheduledPayment')}
                  value={values.scheduledPayment}
                  onValueChange={(v) => set('scheduledPayment', v)}
                  error={errorFor('scheduledPayment')}
                />
              </FormField>
            )}
          </div>
        </Section>

        <Section title="Interest calculation" description="How your lender charges interest. Check your contract if you are unsure.">
          <div className="grid gap-3 sm:col-span-2">
            <div className="flex items-center gap-1.5">
              <span id="accrual-label" className="text-sm font-medium">
                Accrual method
              </span>
              <FieldInfo term="accrualMethod" />
            </div>
            <RadioGroup
              id={fieldId('accrualMethod')}
              aria-labelledby="accrual-label"
              value={values.accrualMethod}
              onValueChange={(v) => set('accrualMethod', v as AccrualMethod)}
              className="grid gap-3 sm:grid-cols-2"
            >
              {ACCRUAL_OPTIONS.map((opt) => (
                <Label
                  key={opt.value}
                  htmlFor={`accrual-${opt.value}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-4 leading-normal font-normal transition-colors hover:bg-accent/50',
                    values.accrualMethod === opt.value && 'border-primary bg-primary/5 ring-1 ring-primary/30',
                  )}
                >
                  <RadioGroupItem id={`accrual-${opt.value}`} value={opt.value} className="mt-0.5" />
                  <span className="grid gap-1">
                    <span className="text-sm font-medium">{opt.title}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{opt.description}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {errorFor('accrualMethod') && <p className="text-xs font-medium text-negative">{errorFor('accrualMethod')}</p>}
          </div>
          {values.accrualMethod === 'dailySimple' && (
            <FormField label="Day-count basis" htmlFor={fieldId('dayCountBasis')} info="dayCountBasis" error={errorFor('dayCountBasis')}>
              <Select value={values.dayCountBasis} onValueChange={(v) => set('dayCountBasis', v as DayCountBasis)}>
                <SelectTrigger id={fieldId('dayCountBasis')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_COUNT_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        </Section>

        <Section title="Current status" description="For a loan you have already been paying.">
          <div className="flex items-start justify-between gap-4 sm:col-span-2">
            <div className="grid gap-1">
              <Label htmlFor={fieldId('inProgress')}>This loan is already in progress</Label>
              <p className="text-xs text-muted-foreground">Turn on to start projections from your latest statement balance.</p>
            </div>
            <Switch id={fieldId('inProgress')} checked={values.inProgress} onCheckedChange={(c) => set('inProgress', c)} />
          </div>
          {values.inProgress && (
            <>
              <FormField label="Current principal balance" htmlFor={fieldId('currentBalance')} info="payoffQuote">
                <CurrencyInput
                  id={fieldId('currentBalance')}
                  value={values.currentBalance}
                  onValueChange={(v) => set('currentBalance', v)}
                  error={errorFor('currentBalance')}
                />
              </FormField>
              <FormField label="Balance as of" htmlFor={fieldId('balanceAsOf')} info="balanceAsOf">
                <DateInput
                  id={fieldId('balanceAsOf')}
                  value={values.balanceAsOf}
                  max={today}
                  onValueChange={(v) => set('balanceAsOf', v)}
                  error={errorFor('balanceAsOf')}
                />
              </FormField>
              <FormField label="Payments made" htmlFor={fieldId('paymentsMade')} optional hint="Leave blank and LoanPilot will estimate it from the dates.">
                <NumberField
                  id={fieldId('paymentsMade')}
                  value={values.paymentsMade}
                  onValueChange={(v) => set('paymentsMade', v)}
                  decimals={0}
                  grouping={false}
                  error={errorFor('paymentsMade')}
                  aria-describedby={describedBy('paymentsMade', true)}
                />
              </FormField>
              <FormField label="Interest paid to date" htmlFor={fieldId('interestPaidToDate')} optional hint="From your statements. If blank, interest paid so far stays unknown and lifetime cost is not shown.">
                <CurrencyInput
                  id={fieldId('interestPaidToDate')}
                  value={values.interestPaidToDate}
                  onValueChange={(v) => set('interestPaidToDate', v)}
                  error={errorFor('interestPaidToDate')}
                  aria-describedby={describedBy('interestPaidToDate', true)}
                />
              </FormField>
              <Alert variant="info" className="sm:col-span-2">
                <HistoryIcon />
                <AlertTitle>Projections start from the as-of date</AlertTitle>
                <AlertDescription>
                  <p>
                    LoanPilot projects forward from this balance and date. Your past payment history is not reconstructed, so
                    anything before the as-of date is only shown when you enter it or record payments.
                  </p>
                </AlertDescription>
              </Alert>
            </>
          )}
        </Section>

        <Section title="Optional details" description="Used for equity and your own reference.">
          <FormField label="Lender" htmlFor={fieldId('lender')} optional>
            <Input id={fieldId('lender')} value={values.lender} placeholder="e.g. Ally, Capital One" onChange={(e) => set('lender', e.target.value)} />
          </FormField>
          <FormField label="Vehicle value" htmlFor={fieldId('vehicleValue')} info="equity" optional hint="Today's estimated value, used to show your equity.">
            <CurrencyInput
              id={fieldId('vehicleValue')}
              value={values.vehicleValue}
              onValueChange={(v) => set('vehicleValue', v)}
              error={errorFor('vehicleValue')}
              aria-describedby={describedBy('vehicleValue', true)}
            />
          </FormField>
          <FormField label="Notes" htmlFor={fieldId('notes')} optional error={errorFor('notes')} className="sm:col-span-2">
            <Textarea
              id={fieldId('notes')}
              value={values.notes}
              rows={3}
              placeholder="Account number hint, payoff address, anything useful."
              aria-invalid={errorFor('notes') ? true : undefined}
              onChange={(e) => set('notes', e.target.value)}
            />
          </FormField>
        </Section>

        <Card className="py-4">
          <CardFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => (mode === 'create' ? navigate('/') : navigate(-1))} disabled={saving} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
              {mode === 'create' ? 'Save loan' : 'Save changes'}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-20">
        <LoanPreviewPanel input={preview} preview={previewQuery} currency={currency} inProgress={values.inProgress} />
      </aside>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}
