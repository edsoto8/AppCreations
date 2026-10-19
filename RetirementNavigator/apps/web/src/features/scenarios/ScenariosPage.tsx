import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Household, Scenario } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { DollarBasisToggle } from '@/components/DollarBasisToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useEngineContext } from '@/hooks/useEngine';
import { useProfileStore } from '@/state/profileStore';
import { scenariosOf, useScenarioStore } from '@/state/scenarioStore';
import { CompareView } from './CompareView';
import { MAX_COMPARED } from './compareModel';
import { NewScenarioDialog } from './NewScenarioDialog';
import { RetirementAgeOptimizer } from './RetirementAgeOptimizer';
import { ScenarioEditor } from './ScenarioEditor';
import { ScenarioList } from './ScenarioList';

/** Up to two scenarios are compared by default when the page opens. */
const DEFAULT_COMPARED = 2;

function ScenariosBody({ household, profileId }: { household: Household; profileId: string }) {
  const ctx = useEngineContext();
  const basis = useProfileStore((s) => s.dollarBasis);
  const all = useScenarioStore((s) => s.scenarios);
  const invalid = useScenarioStore((s) => s.invalidDocuments);
  const createScenario = useScenarioStore((s) => s.createScenario);
  const scenarios = useMemo(() => scenariosOf(all, profileId), [all, profileId]);
  const [picked, setPicked] = useState<string[]>(() => scenarios.slice(0, DEFAULT_COMPARED).map((s) => s.id));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Selection order is kept; deleted scenarios drop out.
  const compared = useMemo(
    () => picked.flatMap((id) => scenarios.find((s) => s.id === id) ?? []).slice(0, MAX_COMPARED),
    [picked, scenarios],
  );
  const comparedIds = compared.map((s) => s.id);
  const editing = scenarios.find((s) => s.id === editingId) ?? null;

  const toggleCompare = (id: string, on: boolean) =>
    setPicked((p) => (on ? [...p.filter((x) => x !== id), id] : p.filter((x) => x !== id)));

  const create = async (scenario: Scenario) => {
    const id = await createScenario(scenario);
    setCreating(false);
    setPicked((p) =>
      comparedIds.length < MAX_COMPARED ? [...p.filter((x) => scenarios.some((s) => s.id === x)), id] : p,
    );
    if (scenario.preset === null) setEditingId(id);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card aria-labelledby="scenario-list-title">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle id="scenario-list-title">Your scenarios</CardTitle>
              <CardDescription>
                What-if versions of “{household.name}”. Each stores only its changes, so edits to the base plan flow
                through. Select up to {MAX_COMPARED} to compare with the base plan.
              </CardDescription>
            </div>
            <Button onClick={() => setCreating(true)} className="self-start">
              <Plus aria-hidden="true" /> New scenario
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {invalid > 0 ? (
            <p className="text-sm text-destructive" role="status">
              {invalid} stored scenario{invalid === 1 ? '' : 's'} could not be read and {invalid === 1 ? 'is' : 'are'}{' '}
              not shown.
            </p>
          ) : null}
          {scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scenarios yet. Start from a preset (for example early retirement or a market downturn) or build a
              custom scenario by choosing which base values to change.
            </p>
          ) : (
            <ScenarioList
              scenarios={scenarios}
              household={household}
              currentYear={ctx.currentYear}
              compared={comparedIds}
              editingId={editing?.id ?? null}
              onToggleCompare={toggleCompare}
              onEdit={(id) => setEditingId((current) => (current === id ? null : id))}
            />
          )}
        </CardContent>
      </Card>

      {editing ? (
        <ScenarioEditor
          key={editing.id}
          scenario={editing}
          household={household}
          currentYear={ctx.currentYear}
          onClose={() => setEditingId(null)}
        />
      ) : null}

      <CompareView household={household} scenarios={compared} basis={basis} ctx={ctx} />

      <RetirementAgeOptimizer household={household} scenarios={scenarios} ctx={ctx} />

      <p className="text-xs text-muted-foreground">
        Scenarios are illustrations from a simplified model, not advice or predictions.
      </p>

      <NewScenarioDialog
        open={creating}
        onOpenChange={setCreating}
        household={household}
        profileId={profileId}
        currentYear={ctx.currentYear}
        onCreate={(s) => void create(s)}
      />
    </div>
  );
}

export function ScenariosPage() {
  const activeId = useProfileStore((s) => s.activeId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Scenarios"
        description="Try what-if changes to your plan and compare them side by side: retirement ages, savings, spending, returns and market shocks."
        actions={<DollarBasisToggle />}
      />
      <RequireProfile>
        {(household) => (activeId ? <ScenariosBody key={activeId} household={household} profileId={activeId} /> : null)}
      </RequireProfile>
    </div>
  );
}
