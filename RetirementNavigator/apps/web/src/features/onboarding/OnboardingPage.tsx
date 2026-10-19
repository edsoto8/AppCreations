import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, FileText, ShieldCheck, Sparkles } from 'lucide-react';
import { SAMPLE_PROFILES } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Field } from '@/components/form/Field';
import { IntegerInput, MoneyInput } from '@/components/form/inputs';
import { Disclaimer } from '@/components/Disclaimer';
import { useActiveProfile, useProfileStore } from '@/state/profileStore';
import { CURRENT_YEAR } from '@/app/env';
import { IncomeForm } from '@/features/income/IncomeSavingsPage';
import { blankHousehold, type Basics } from './blankHousehold';

type Step = 'start' | 'basics' | 'income';

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'start', label: 'Start' },
    { id: 'basics', label: 'About you' },
    { id: 'income', label: 'Income & savings' },
  ];
  const current = steps.findIndex((s) => s.id === step);
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Setup progress">
      {steps.map((s, i) => (
        <li
          key={s.id}
          aria-current={i === current ? 'step' : undefined}
          className={i === current ? 'font-semibold text-foreground' : 'text-muted-foreground'}
        >
          {i + 1}. {s.label}
          {i < steps.length - 1 ? <span aria-hidden="true"> ·</span> : null}
        </li>
      ))}
    </ol>
  );
}

function BasicsForm({ onCreated }: { onCreated: () => void }) {
  const createProfile = useProfileStore((s) => s.createProfile);
  const [b, setB] = useState<Basics>({
    name: 'My plan',
    yourName: 'You',
    birthYear: CURRENT_YEAR - 40,
    retirementAge: 65,
    partner: null,
    salaryCents: 8_000_000,
    spendingCents: 6_000_000,
  });
  const [errors, setErrors] = useState<string[]>([]);
  const updatePartner = (patch: Partial<NonNullable<Basics['partner']>>) => {
    if (b.partner) setB({ ...b, partner: { ...b.partner, ...patch } });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = blankHousehold(CURRENT_YEAR, b);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    await createProfile(result.household);
    onCreated();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>About you</CardTitle>
          <CardDescription>A few basics to start. You can change everything later.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name" example="Shown in the profile switcher.">
            {(a) => <Input {...a} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />}
          </Field>
          <Field label="Your name" example="Used only on this device.">
            {(a) => <Input {...a} value={b.yourName} onChange={(e) => setB({ ...b, yourName: e.target.value })} />}
          </Field>
          <Field label="Your birth year" example={`Age this year: ${CURRENT_YEAR - b.birthYear}.`}>
            {(a) => <IntegerInput {...a} value={b.birthYear} onChange={(v) => setB({ ...b, birthYear: v })} />}
          </Field>
          <Field
            label="Your retirement age"
            tip="Retirement starts January 1 of the year you reach this age."
            example="For example 65."
          >
            {(a) => <IntegerInput {...a} value={b.retirementAge} onChange={(v) => setB({ ...b, retirementAge: v })} />}
          </Field>
          <Field label="Your annual salary" example="Gross base pay; $0 if not working.">
            {(a) => <MoneyInput {...a} value={b.salaryCents} onChange={(v) => setB({ ...b, salaryCents: v })} />}
          </Field>
          <Field
            label="Household spending per year"
            tip="Current spending, excluding savings and taxes."
            example="For example $60,000."
          >
            {(a) => <MoneyInput {...a} value={b.spendingCents} onChange={(v) => setB({ ...b, spendingCents: v })} />}
          </Field>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              id="onboarding-partner"
              checked={b.partner !== null}
              onCheckedChange={(on) =>
                setB({
                  ...b,
                  partner: on ? { name: 'Partner', birthYear: b.birthYear, retirementAge: b.retirementAge } : null,
                })
              }
            />
            <Label htmlFor="onboarding-partner">Plan with a spouse (married filing jointly)</Label>
          </div>
          {b.partner ? (
            <>
              <Field label="Spouse’s name">
                {(a) => (
                  <Input
                    {...a}
                    value={b.partner?.name ?? ''}
                    onChange={(e) => updatePartner({ name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Spouse’s birth year">
                {(a) => (
                  <IntegerInput
                    {...a}
                    value={b.partner?.birthYear ?? null}
                    onChange={(v) => updatePartner({ birthYear: v })}
                  />
                )}
              </Field>
              <Field label="Spouse’s retirement age">
                {(a) => (
                  <IntegerInput
                    {...a}
                    value={b.partner?.retirementAge ?? null}
                    onChange={(v) => updatePartner({ retirementAge: v })}
                  />
                )}
              </Field>
            </>
          ) : null}
        </CardContent>
      </Card>
      {errors.length > 0 ? (
        <Alert variant="destructive">
          <ul role="alert" className="flex list-none flex-col gap-1">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div>
        <Button type="submit">
          Continue <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}

export function OnboardingPage() {
  const [step, setStep] = useState<Step>('start');
  const createProfile = useProfileStore((s) => s.createProfile);
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const profile = useActiveProfile();
  const navigate = useNavigate();

  const finish = () => {
    completeOnboarding();
    navigate('/profile');
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Welcome to Retirement Navigator"
        description="Plan and stress-test your retirement with transparent, documented assumptions. Everything stays on this device."
      />
      <StepIndicator step={step} />

      {step === 'start' ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="size-4" /> Private by design
                </CardTitle>
                <CardDescription>
                  No account, no server, no tracking. Data is stored unencrypted in this browser.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText aria-hidden="true" className="size-4" /> Sourced rules
                </CardTitle>
                <CardDescription>
                  Tax and contribution limits come only from official sources. Unverified values are never filled in;
                  the features that need them say so.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles aria-hidden="true" className="size-4" /> Estimates, not advice
                </CardTitle>
                <Disclaimer className="text-sm" />
              </CardHeader>
            </Card>
          </div>

          <section aria-labelledby="start-heading" className="flex flex-col gap-3">
            <h2 id="start-heading" className="text-lg font-semibold">
              How would you like to start?
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Start with your own numbers</CardTitle>
                  <CardDescription>Answer a few questions; add accounts afterwards.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => setStep('basics')}>
                    Start blank <ArrowRight aria-hidden="true" />
                  </Button>
                </CardContent>
              </Card>
              {SAMPLE_PROFILES.map((sample) => (
                <Card key={sample.id}>
                  <CardHeader>
                    <CardTitle>{sample.title}</CardTitle>
                    <CardDescription>{sample.summary}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        await createProfile(sample.build(CURRENT_YEAR));
                        setStep('income');
                      }}
                    >
                      Use this sample
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {step === 'basics' ? <BasicsForm onCreated={() => setStep('income')} /> : null}

      {step === 'income' && profile ? (
        <div className="flex flex-col gap-6">
          <IncomeForm key={profile.household.id} household={profile.household} />
          <div className="flex flex-wrap gap-3">
            <Button onClick={finish}>
              Finish setup <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
