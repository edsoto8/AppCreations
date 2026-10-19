import { useId, useMemo, useState } from 'react';
import { Copy, Pencil, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { applyScenario, presetDrift, type Household, type Scenario } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useScenarioStore } from '@/state/scenarioStore';
import { MAX_COMPARED } from './compareModel';
import { ScenarioWarnings } from './ScenarioWarnings';
import { describeOp, presetSummary } from './scenarioModel';

const SHOWN_CHANGES = 6;

/** A preset whose stored ops no longer match a rebuild on the current base plan (`presetDrift`). */
function DriftNote({ scenario, onRebuild }: { scenario: Scenario; onRebuild: () => void }) {
  return (
    <Alert variant="attention" aria-label="Preset out of date">
      <RefreshCw aria-hidden="true" />
      <div className="flex flex-col gap-2">
        <p>
          The base plan changed since this preset was built; its stored values no longer match what the preset would set
          on the current base plan (for example, a spending cut stores the reduced amount, not the percentage). Rebuild
          it to apply the preset’s settings to the current base plan.
        </p>
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={onRebuild}
            aria-label={`Rebuild from base plan: ${scenario.name}`}
          >
            <RefreshCw aria-hidden="true" /> Rebuild from base plan
          </Button>
        </div>
      </div>
    </Alert>
  );
}

function ScenarioItem({
  scenario,
  household,
  currentYear,
  compared,
  compareDisabled,
  editing,
  onToggleCompare,
  onEdit,
  onRename,
  onDelete,
}: {
  scenario: Scenario;
  household: Household;
  currentYear: number;
  compared: boolean;
  compareDisabled: boolean;
  editing: boolean;
  onToggleCompare: (on: boolean) => void;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const duplicate = useScenarioStore((s) => s.duplicateScenario);
  const rebuild = useScenarioStore((s) => s.rebuildPreset);
  const application = useMemo(() => applyScenario(household, scenario), [household, scenario]);
  const drift = useMemo(() => presetDrift(scenario, household), [household, scenario]);
  const checkId = useId();
  const n = scenario.ops.length;
  const status =
    application.issues.length > 0 ? 'Cannot run' : application.orphaned.length > 0 ? 'Some changes not applied' : null;
  return (
    <Card className={editing ? 'border-primary' : undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{scenario.name}</CardTitle>
          {status ? <Badge variant="attention">{status}</Badge> : null}
        </div>
        <CardDescription>
          {presetSummary(scenario)} · {n} change{n === 1 ? '' : 's'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {drift ? (
          <DriftNote scenario={scenario} onRebuild={() => rebuild(scenario.id, household, currentYear)} />
        ) : null}
        <ScenarioWarnings application={application} household={household} scenario={scenario} />
        {n > 0 ? (
          <ul className="list-disc pl-5 text-sm text-muted-foreground" aria-label={`Changes in ${scenario.name}`}>
            {scenario.ops.slice(0, SHOWN_CHANGES).map((op, i) => (
              <li key={i}>{describeOp(op, household)}</li>
            ))}
            {n > SHOWN_CHANGES ? <li>…and {n - SHOWN_CHANGES} more</li> : null}
          </ul>
        ) : null}
        <div className="flex min-h-6 items-center gap-2">
          <input
            id={checkId}
            type="checkbox"
            className="size-5 accent-primary"
            checked={compared}
            disabled={!compared && compareDisabled}
            onChange={(e) => onToggleCompare(e.target.checked)}
          />
          <Label htmlFor={checkId}>Include in comparison</Label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={editing ? 'secondary' : 'outline'}
            onClick={onEdit}
            aria-label={`Edit changes in ${scenario.name}`}
          >
            <SlidersHorizontal aria-hidden="true" /> Edit changes
          </Button>
          <Button size="sm" variant="outline" onClick={onRename} aria-label={`Rename ${scenario.name}`}>
            <Pencil aria-hidden="true" /> Rename
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void duplicate(scenario.id)}
            aria-label={`Duplicate ${scenario.name}`}
          >
            <Copy aria-hidden="true" /> Duplicate
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${scenario.name}`}>
            <Trash2 aria-hidden="true" /> Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Scenario cards with compare selection, editing, rename, duplicate and delete. */
export function ScenarioList({
  scenarios,
  household,
  currentYear,
  compared,
  editingId,
  onToggleCompare,
  onEdit,
}: {
  scenarios: Scenario[];
  household: Household;
  currentYear: number;
  compared: readonly string[];
  editingId: string | null;
  onToggleCompare: (id: string, on: boolean) => void;
  onEdit: (id: string) => void;
}) {
  const renameScenario = useScenarioStore((s) => s.renameScenario);
  const deleteScenario = useScenarioStore((s) => s.deleteScenario);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Scenario | null>(null);
  const full = compared.length >= MAX_COMPARED;

  return (
    <>
      {full ? (
        <p className="text-sm text-muted-foreground" role="status">
          Up to {MAX_COMPARED} scenarios can be compared with the base plan at once. Clear one to add another.
        </p>
      ) : null}
      <ul className="grid gap-4 lg:grid-cols-2" aria-label="Scenarios">
        {scenarios.map((s) => (
          <li key={s.id}>
            <ScenarioItem
              scenario={s}
              household={household}
              currentYear={currentYear}
              compared={compared.includes(s.id)}
              compareDisabled={full}
              editing={editingId === s.id}
              onToggleCompare={(on) => onToggleCompare(s.id, on)}
              onEdit={() => onEdit(s.id)}
              onRename={() => setRenaming({ id: s.id, name: s.name })}
              onDelete={() => setDeleting(s)}
            />
          </li>
        ))}
      </ul>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogTitle>Rename scenario</DialogTitle>
          <DialogDescription>Names appear in the comparison table and chart legend.</DialogDescription>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming) renameScenario(renaming.id, renaming.name);
              setRenaming(null);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rename-scenario-input">Name</Label>
              <Input
                id="rename-scenario-input"
                value={renaming?.name ?? ''}
                maxLength={80}
                onChange={(e) => renaming && setRenaming({ ...renaming, name: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={!renaming?.name.trim()}>
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogTitle>Delete this scenario?</DialogTitle>
          <DialogDescription>
            “{deleting?.name}” will be removed from this device. The base plan is not changed. This cannot be undone.
          </DialogDescription>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) void deleteScenario(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
