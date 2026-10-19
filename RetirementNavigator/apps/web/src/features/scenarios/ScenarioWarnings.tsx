import { AlertTriangle } from 'lucide-react';
import type { Household, ScenarioApplication } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { issueText, orphanMessage } from './scenarioModel';

/** Orphaned-op and invalid-scenario warnings for one applied scenario (nothing when it applies cleanly). */
export function ScenarioWarnings({
  application,
  household,
}: {
  application: ScenarioApplication;
  household: Household;
}) {
  const { orphaned, issues } = application;
  if (orphaned.length === 0 && issues.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {orphaned.length > 0 ? (
        <Alert variant="attention" aria-label="Changes not applied">
          <AlertTriangle aria-hidden="true" />
          <ul className="flex flex-col gap-1">
            {orphaned.map((o) => (
              <li key={o.opIndex}>{orphanMessage(o, household)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {issues.length > 0 ? (
        <Alert variant="destructive" aria-label="Scenario cannot run">
          <AlertTriangle aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">This scenario cannot run: its changes make the plan invalid.</p>
            <ul className="list-disc pl-5">
              {issues.slice(0, 6).map((issue, i) => (
                <li key={i}>{issueText(issue)}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">Edit or remove its changes to fix it.</p>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
