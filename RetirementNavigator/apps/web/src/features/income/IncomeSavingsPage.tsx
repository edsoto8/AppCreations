import { useMemo, useState } from 'react';
import { previewAccumulation, type Household } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHouseholdForm } from '@/hooks/useHouseholdForm';
import { useEngineContext } from '@/hooks/useEngine';
import { IncomeSection } from './IncomeSection';
import { PlanSection } from './PlanSection';
import { CashFlowCheck, SavingsPreview } from './PreviewTables';

export function IncomeForm({ household }: { household: Household }) {
  const form = useHouseholdForm(household);
  const values = form.watch() as Household;
  const ctx = useEngineContext();
  // The preview uses the last VALID household (from the store), so it never shows invalid input.
  const preview = useMemo(() => previewAccumulation(household, ctx, 10), [household, ctx]);
  const [tab, setTab] = useState(household.people[0]?.id ?? '');
  const people = values.people ?? household.people;
  if (preview.status !== 'ok') return null;
  const limitsVerified = !preview.value.unverified.some((u) => u.features.includes('workplaceLimits'));

  const personPanel = (index: number) => {
    const person = people[index] as Household['people'][number];
    const rows = preview.value.people.find((p) => p.personId === household.people[index]?.id)?.rows ?? [];
    return (
      <div className="flex flex-col gap-6">
        <IncomeSection form={form} index={index} person={person} inflation={household.assumptions.inflation} />
        <PlanSection
          form={form}
          personIndex={index}
          person={person}
          household={values}
          previewRow={rows[0]}
          limitsVerified={limitsVerified}
        />
        <SavingsPreview
          rows={rows}
          inflation={household.assumptions.inflation}
          personName={person.name}
          unverified={preview.value.unverified}
        />
      </div>
    );
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => e.preventDefault()} noValidate>
      {people.length > 1 ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Person">
            {people.map((p) => (
              <TabsTrigger key={p.id} value={p.id ?? ''}>
                {p.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {people.map((p, i) => (
            <TabsContent key={p.id} value={p.id ?? ''} className="mt-6">
              {personPanel(i)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        personPanel(0)
      )}
      <CashFlowCheck preview={preview.value} inflation={household.assumptions.inflation} />
    </form>
  );
}

export function IncomeSavingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Income & Savings"
        description="Salary, bonus and raises, your workplace-plan contributions and the employer match, with a live 10-year preview."
      />
      <RequireProfile>{(household) => <IncomeForm key={household.id} household={household} />}</RequireProfile>
    </div>
  );
}
