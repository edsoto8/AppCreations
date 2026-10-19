import { useState } from 'react';
import { UserPlus, UserMinus } from 'lucide-react';
import type { Control } from 'react-hook-form';
import { RULES, type Household, type HouseholdInput } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { IntegerField, MoneyField, PercentField, SelectField, TextField } from '@/components/form/fields';
import { useHouseholdForm } from '@/hooks/useHouseholdForm';
import { CURRENT_YEAR } from '@/app/env';
import { newId } from '@/lib/ids';

type HouseholdControl = Control<HouseholdInput, unknown, Household>;

const RULE_YEARS = Object.keys(RULES.years).sort();

function PersonCard({
  control,
  index,
  person,
}: {
  control: HouseholdControl;
  index: number;
  person: Household['people'][number];
}) {
  const age = CURRENT_YEAR - person.birthYear;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{person.name || `Person ${index + 1}`}</CardTitle>
        <CardDescription>
          Age {age} in {CURRENT_YEAR}. Retires January 1, {person.birthYear + person.retirementAge} (age{' '}
          {person.retirementAge}); planned through age {person.planningAge}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <TextField control={control} name={`people.${index}.name`} label="Name" example="Used only on this device." />
        <IntegerField
          control={control}
          name={`people.${index}.birthYear`}
          label="Birth year"
          tip="Ages are computed as the calendar year minus the birth year, so a person born in 1985 is treated as 41 throughout 2026."
          example={`Age this year: ${age}.`}
        />
        <IntegerField
          control={control}
          name={`people.${index}.retirementAge`}
          label="Retirement age"
          tip="Retirement takes effect January 1 of the year you reach this age; there is no salary that year."
          example="For example 65."
        />
        <IntegerField
          control={control}
          name={`people.${index}.planningAge`}
          label="Planning age"
          tip="How long the plan should last for this person (a longevity assumption). The household is modeled until the longer-lived person's planning age."
          example="Default 100."
        />
      </CardContent>
    </Card>
  );
}

function ProfileForm({ household }: { household: Household }) {
  const form = useHouseholdForm(household);
  const { control } = form;
  const values = form.watch() as Household;
  const people = values.people ?? household.people;
  const [partnerError, setPartnerError] = useState<string | null>(null);

  const addPartner = () => {
    setPartnerError(null);
    const first = people[0];
    const partner = {
      id: newId('person'),
      name: 'Partner',
      birthYear: first?.birthYear ?? CURRENT_YEAR - 40,
      birthMonth: 1,
      retirementAge: first?.retirementAge ?? 65,
      planningAge: first?.planningAge ?? 100,
      employment: null,
      workplacePlans: [],
      socialSecurity: { source: { kind: 'none' as const }, claimAge: { years: 67, months: 0 } },
    };
    form.setValue('people', [...people, partner] as HouseholdInput['people'], { shouldDirty: true });
    form.setValue('filingStatus', 'marriedFilingJointly', { shouldDirty: true, shouldValidate: true });
  };

  const removePartner = () => {
    const partner = people[1];
    if (!partner) return;
    const owns =
      household.accounts.some((a) => a.ownerId === partner.id) ||
      household.pensions.some((p) => p.ownerId === partner.id) ||
      household.otherIncome.some((i) => i.ownerId === partner.id);
    if (owns) {
      setPartnerError(`${partner.name} still owns accounts or income. Move or delete them first (Accounts page).`);
      return;
    }
    setPartnerError(null);
    form.setValue('people', [people[0]] as HouseholdInput['people'], { shouldDirty: true });
    form.setValue('filingStatus', 'single', { shouldDirty: true, shouldValidate: true });
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => e.preventDefault()} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Household</CardTitle>
          <CardDescription>Changes save automatically on this device.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="name" label="Plan name" example="Shown in the profile switcher." />
          <Field2 label="Filing status">
            <p className="text-sm">
              {values.filingStatus === 'marriedFilingJointly' ? 'Married filing jointly' : 'Single'}{' '}
              <span className="text-muted-foreground">(other filing statuses are not supported in this version)</span>
            </p>
            <div>
              {people.length === 1 ? (
                <Button type="button" variant="outline" size="sm" onClick={addPartner}>
                  <UserPlus aria-hidden="true" /> Add a spouse (married filing jointly)
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={removePartner}>
                  <UserMinus aria-hidden="true" /> Remove spouse (file single)
                </Button>
              )}
            </div>
            {partnerError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {partnerError}
              </p>
            ) : null}
          </Field2>
          <TextField
            control={control}
            name="stateCode"
            label="State (optional)"
            tip="Shown for reference only. State tax is modeled as one flat effective rate."
            example="Two letters, e.g. CO."
          />
          <PercentField
            control={control}
            name="assumptions.stateTaxRate"
            label="Effective state income-tax rate"
            tip="A single flat rate applied to federal adjusted gross income. State-specific rules are not modeled."
            example="For example 4.5%. Use 0% for states without income tax."
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {people.map((person, index) => (
          <PersonCard
            key={person.id ?? index}
            control={control}
            index={index}
            person={person as Household['people'][number]}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spending</CardTitle>
          <CardDescription>
            In today’s dollars per year. Retirement spending is an after-tax need. Spending steps and gradual reductions
            arrive with retirement-income planning.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            control={control}
            name="spending.currentAnnualSpending"
            label="Current annual spending"
            tip="What the household spends per year now, excluding savings and taxes. Used to check that the savings plan fits take-home pay."
            example="For example $60,000."
          />
          <MoneyField
            control={control}
            name="spending.retirementAnnualSpending"
            label="Retirement annual spending"
            tip="The after-tax amount you expect to spend each year in retirement, in today's dollars."
            example="Often 70–90% of current spending."
          />
          <MoneyField
            control={control}
            name="spending.healthcareBeforeMedicare"
            label="Healthcare before Medicare (per year)"
            tip="A user-entered line item added to retirement spending while a retired person is under 65. Healthcare costs are not otherwise modeled."
            example="For example $12,000 for one person."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assumptions</CardTitle>
          <CardDescription>
            Labeled assumptions, not forecasts. See the Rules &amp; Sources page for regulatory values.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <PercentField
            control={control}
            name="assumptions.inflation"
            label="Inflation"
            tip="One assumption used for spending growth, converting to today's dollars, and (by default) projecting indexed limits beyond published years."
            example="Default 2.5%."
          />
          <PercentField
            control={control}
            name="assumptions.returnPreRetirement"
            label="Return before retirement"
            tip="Expected geometric (median) annual return, before fees, for accounts without their own expected return or allocation."
            example="For example 6%."
          />
          <PercentField
            control={control}
            name="assumptions.returnPostRetirement"
            label="Return in retirement"
            tip="Expected geometric (median) annual return after retirement for accounts without their own assumption."
            example="For example 5%."
          />
          <SelectField
            control={control}
            name="assumptions.rules.anchorYear"
            label="Rules anchor year"
            tip="The latest tax year whose published values are used. Later years project indexed values at the indexing rate (labeled as projected)."
            numeric
            options={RULE_YEARS.map((y) => ({ value: y, label: y }))}
          />
        </CardContent>
      </Card>
    </form>
  );
}

/** Non-input field block with a visible label (for action groups). */
function Field2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <p className="text-sm font-medium leading-none">{label}</p>
      {children}
    </div>
  );
}

export function ProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profile"
        description="Who the plan is for, when you expect to retire, spending and key assumptions."
      />
      <RequireProfile>{(household) => <ProfileForm key={household.id} household={household} />}</RequireProfile>
      <Alert>
        <p className="text-muted-foreground">
          Results are estimates that depend on these assumptions. Early-retirement plans should include healthcare costs
          before Medicare, which are only modeled as the amount you enter above.
        </p>
      </Alert>
    </div>
  );
}
