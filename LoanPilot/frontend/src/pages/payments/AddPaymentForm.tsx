import { useId, useState, type FormEvent } from 'react';
import { ChevronDownIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { CurrencyInput } from '@/components/CurrencyInput';
import { DateInput } from '@/components/DateInput';
import { FormField } from '@/components/FormField';
import { errorMessage, isApiError, type FieldErrors } from '@/api/client';
import type { IsoDate, PaymentRecordInput } from '@/api/types';
import { formatCurrency, formatDate, todayIso } from '@/lib/format';
import { cn } from '@/lib/utils';

const FIELDS = ['date', 'amount', 'principal', 'interest', 'note'] as const;

interface AddPaymentFormProps {
  defaultAmount: number | null;
  currency: string;
  submitting: boolean;
  onSubmit: (input: PaymentRecordInput) => Promise<unknown>;
}

/** Records one payment. Server validation errors are shown next to their field. */
export function AddPaymentForm({ defaultAmount, currency, submitting, onSubmit }: AddPaymentFormProps) {
  const id = useId();
  const [date, setDate] = useState<IsoDate | null>(() => todayIso());
  const [amount, setAmount] = useState<number | null>(defaultAmount);
  const [split, setSplit] = useState(false);
  const [principal, setPrincipal] = useState<number | null>(null);
  const [interest, setInterest] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const err = (k: string) => errors[k]?.[0];
  const general = Object.entries(errors)
    .filter(([k]) => !(FIELDS as readonly string[]).includes(k))
    .flatMap(([, v]) => v);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: FieldErrors = {};
    if (!date) local.date = ['Enter the date of the payment.'];
    if (amount === null) local.amount = ['Enter the amount you paid.'];
    else if (amount <= 0) local.amount = ['The payment amount must be greater than zero.'];
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setErrors({});
    const input: PaymentRecordInput = {
      date: date!,
      amount: amount!,
      principal: split ? principal : null,
      interest: split ? interest : null,
      note: note.trim() || null,
    };
    try {
      await onSubmit(input);
      toast.success('Payment recorded', { description: `${formatCurrency(input.amount, currency)} on ${formatDate(input.date)}` });
      setPrincipal(null);
      setInterest(null);
      setNote('');
    } catch (error) {
      if (isApiError(error) && error.isValidation && Object.keys(error.errors).length > 0) {
        setErrors(error.errors);
        if (error.errors.principal || error.errors.interest) setSplit(true);
      } else {
        toast.error('Could not record the payment', { description: errorMessage(error) });
      }
    }
  };

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base">Record a payment</CardTitle>
        <CardDescription>Optional. Use your statement for the date and amount.</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4" aria-label="Record a payment">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <FormField label="Date" htmlFor={`${id}-date`}>
              <DateInput id={`${id}-date`} value={date} onValueChange={setDate} max={todayIso()} error={err('date')} />
            </FormField>
            <FormField label="Amount" htmlFor={`${id}-amount`}>
              <CurrencyInput id={`${id}-amount`} value={amount} onValueChange={setAmount} error={err('amount')} />
            </FormField>
          </div>

          <Collapsible open={split} onOpenChange={setSplit}>
            <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              {split ? 'Remove principal and interest split' : 'Add principal and interest split'}
              <ChevronDownIcon className={cn('size-4 transition-transform', split && 'rotate-180')} aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0">
              <div className="mt-3 grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <FormField label="Principal" htmlFor={`${id}-principal`} optional>
                  <CurrencyInput id={`${id}-principal`} value={principal} onValueChange={setPrincipal} error={err('principal')} />
                </FormField>
                <FormField label="Interest" htmlFor={`${id}-interest`} optional>
                  <CurrencyInput id={`${id}-interest`} value={interest} onValueChange={setInterest} error={err('interest')} />
                </FormField>
                <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2 lg:col-span-1 xl:col-span-2">
                  From your statement. Principal plus interest should equal the amount. With a split on every payment, LoanPilot can show the interest
                  you have paid to date.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <FormField label="Note" htmlFor={`${id}-note`} optional error={err('note')}>
            <Input
              id={`${id}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="e.g. Paid early, tax refund"
            />
          </FormField>

          {general.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                {general.map((m) => (
                  <p key={m}>{m}</p>
                ))}
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={submitting} className="w-full sm:w-auto sm:justify-self-start lg:w-full xl:w-auto">
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />} Add payment
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
