import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { importJson, MAX_IMPORT_CHARS, type ExportBundle, type ValidationIssue } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProfileStore, type ImportOutcome } from '@/state/profileStore';
import { previewBundle, type ImportMode, type ImportPreview } from '@/state/importPlan';
import { describeIssuePath, technicalPath } from './fileUtils';

type ImportState =
  | { step: 'idle' }
  | { step: 'reading'; fileName: string }
  | { step: 'invalid'; fileName: string; issues: ValidationIssue[] }
  | { step: 'preview'; fileName: string; bundle: ExportBundle; preview: ImportPreview }
  | { step: 'saving'; fileName: string; mode: ImportMode }
  | { step: 'done'; fileName: string; mode: ImportMode; outcome: ImportOutcome };

/** Bytes per character at most in UTF-8, so a file over this cannot be under MAX_IMPORT_CHARS. */
const MAX_FILE_BYTES = MAX_IMPORT_CHARS * 4;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function exportedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {issues.map((issue, i) => (
        <li key={i}>
          <span className="font-medium">{describeIssuePath(issue.path)}:</span> {issue.message}
          {issue.path.length > 0 ? (
            <span className="block font-mono text-xs text-muted-foreground">{technicalPath(issue.path)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Import JSON: read, validate (engine `importJson`), preview, then replace or add alongside. */
export function ImportCard() {
  const inputId = useId();
  const replaceHelpId = useId();
  const addHelpId = useId();
  const [state, setState] = useState<ImportState>({ step: 'idle' });
  const previewRef = useRef<HTMLHeadingElement>(null);
  const existingProfiles = useProfileStore((s) => s.profiles);
  const importBundle = useProfileStore((s) => s.importBundle);

  useEffect(() => {
    if (state.step === 'preview') previewRef.current?.focus();
  }, [state.step]);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear the input so choosing the same file again still triggers a change.
    input.value = '';
    if (!file) return;
    const fileName = file.name;
    if (file.size > MAX_FILE_BYTES) {
      setState({
        step: 'invalid',
        fileName,
        issues: [{ path: [], message: 'The file is too large to be a Retirement Navigator export (over 5 MB)' }],
      });
      return;
    }
    setState({ step: 'reading', fileName });
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({
        step: 'invalid',
        fileName,
        issues: [{ path: [], message: `The file could not be read (${message})` }],
      });
      return;
    }
    const result = importJson(text);
    if (result.status === 'ok') {
      setState({ step: 'preview', fileName, bundle: result.value, preview: previewBundle(result.value) });
    } else {
      const issues =
        result.status === 'invalid'
          ? result.issues
          : [{ path: [], message: 'The file needs rule values that are not verified in this version' }];
      setState({ step: 'invalid', fileName, issues });
    }
  };

  const run = async (mode: ImportMode) => {
    if (state.step !== 'preview') return;
    const { fileName, bundle } = state;
    setState({ step: 'saving', fileName, mode });
    const result = await importBundle(bundle, mode);
    if (result.status === 'ok') setState({ step: 'done', fileName, mode, outcome: result.value });
    else
      setState({
        step: 'invalid',
        fileName,
        issues: result.status === 'invalid' ? result.issues : [{ path: [], message: 'The import could not be saved' }],
      });
  };

  const busy = state.step === 'reading' || state.step === 'saving';
  const collisions =
    state.step === 'preview' ? state.preview.profiles.filter((p) => existingProfiles[p.id] !== undefined).length : 0;

  return (
    <Card aria-labelledby="import-title">
      <CardHeader>
        <CardTitle id="import-title" className="flex items-center gap-2">
          <FileUp aria-hidden="true" className="size-4" /> Import JSON
        </CardTitle>
        <CardDescription>
          Load a file exported from Retirement Navigator. The file is checked first, and older files are upgraded to
          this version. Nothing changes until you choose how to import it, and an import is saved completely or not at
          all.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex max-w-md flex-col gap-2">
          <Label htmlFor={inputId}>Export file (.json)</Label>
          <Input
            id={inputId}
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => void onFile(e)}
            className="h-auto cursor-pointer py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
          />
        </div>

        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {state.step === 'reading' ? `Checking ${state.fileName}…` : 'Saving the import…'}
          </p>
        ) : null}

        {state.step === 'invalid' ? (
          <Alert variant="destructive" role="alert" aria-labelledby="import-error-title">
            <AlertTriangle aria-hidden="true" />
            <div className="flex flex-col gap-2">
              <p id="import-error-title" className="font-medium">
                {state.fileName} was not imported. Nothing was changed.
              </p>
              <p className="text-muted-foreground">
                {state.issues.length === 1 ? 'One problem was found:' : `${state.issues.length} problems were found:`}
              </p>
              <IssueList issues={state.issues} />
            </div>
          </Alert>
        ) : null}

        {state.step === 'preview' ? (
          <section aria-labelledby="import-preview-title" className="flex flex-col gap-3 rounded-md border p-4">
            <h3 id="import-preview-title" ref={previewRef} tabIndex={-1} className="font-medium focus:outline-none">
              Ready to import {state.fileName}
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Schema version</dt>
              <dd>{state.preview.schemaVersion}</dd>
              <dt className="text-muted-foreground">Exported</dt>
              <dd>{exportedOn(state.preview.exportedAt)}</dd>
              <dt className="text-muted-foreground">Contents</dt>
              <dd>
                {plural(state.preview.profiles.length, 'profile')}, {plural(state.preview.scenarioCount, 'scenario')}
              </dd>
            </dl>
            {state.preview.profiles.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm" aria-label="Profiles in the file">
                {state.preview.profiles.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2 border-t pt-1">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">
                      {plural(p.scenarios, 'scenario')}
                      {existingProfiles[p.id] ? ' · already on this device' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">The file has no profiles.</p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
              <div className="flex max-w-xs flex-col gap-1">
                <Button variant="destructive" aria-describedby={replaceHelpId} onClick={() => void run('replace')}>
                  Replace all data
                </Button>
                <p id={replaceHelpId} className="text-xs text-muted-foreground">
                  Removes every profile, scenario and setting on this device, then stores the file’s.
                </p>
              </div>
              <div className="flex max-w-xs flex-col gap-1">
                <Button aria-describedby={addHelpId} onClick={() => void run('add')}>
                  Add alongside
                </Button>
                <p id={addHelpId} className="text-xs text-muted-foreground">
                  Keeps your current data and adds the file’s.
                  {collisions > 0
                    ? ` ${plural(collisions, 'profile')} already on this device ${collisions === 1 ? 'gets' : 'get'} a new id, so ${collisions === 1 ? 'it is' : 'they are'} added as a copy.`
                    : ''}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setState({ step: 'idle' })}>
                Cancel
              </Button>
            </div>
          </section>
        ) : null}

        {state.step === 'done' ? (
          <Alert role="status">
            <CheckCircle2 aria-hidden="true" className="text-positive" />
            <p>
              Imported {plural(state.outcome.profiles, 'profile')} and {plural(state.outcome.scenarios, 'scenario')}{' '}
              from {state.fileName}
              {state.mode === 'replace' ? ', replacing the previous data' : ', alongside your existing data'}.
              {state.outcome.renamedIds > 0
                ? ` ${plural(state.outcome.renamedIds, 'id')} already in use ${state.outcome.renamedIds === 1 ? 'was' : 'were'} given a new one.`
                : ''}
            </p>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
