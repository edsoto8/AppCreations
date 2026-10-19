import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Download, FileSpreadsheet, HardDrive, Printer, Trash2, WifiOff } from 'lucide-react';
import { exportJson, projectHousehold, toCsv, type DollarBasis } from '@rn/engine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useEngineContext } from '@/hooks/useEngine';
import { useActiveProfile, useProfileStore } from '@/state/profileStore';
import { useScenarioStore } from '@/state/scenarioStore';
import { clearStoredTheme } from '@/state/settingsStore';
import { useMonteCarloStore } from '@/features/monte-carlo/runStore';
import { todayStamp } from '@/app/env';
import { downloadText, fileSlug } from './fileUtils';
import { ImportCard } from './ImportCard';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function ExportCard() {
  const profileCount = useProfileStore((s) => Object.keys(s.profiles).length);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const onExport = () => {
    const bundle = useProfileStore.getState().exportBundle(new Date().toISOString());
    const fileName = `retirement-navigator-export-${todayStamp()}.json`;
    try {
      downloadText(fileName, exportJson(bundle), 'application/json');
      setMessage({
        ok: true,
        text: `Exported ${plural(bundle.profiles.length, 'profile')} and ${plural(bundle.scenarios.length, 'scenario')} to ${fileName}.`,
      });
    } catch (error) {
      setMessage({
        ok: false,
        text: `The export could not be created: ${error instanceof Error ? error.message : ''}`,
      });
    }
  };

  return (
    <Card aria-labelledby="export-title">
      <CardHeader>
        <CardTitle id="export-title" className="flex items-center gap-2">
          <Download aria-hidden="true" className="size-4" /> Export JSON
        </CardTitle>
        <CardDescription>
          One file with every profile, the scenarios built on them and your settings: a backup, or a way to move your
          plans to another browser. The file is plain, unencrypted text, so keep it somewhere private.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button onClick={onExport} disabled={profileCount === 0}>
            <Download aria-hidden="true" /> Export JSON
          </Button>
        </div>
        {profileCount === 0 ? <p className="text-sm text-muted-foreground">There are no profiles to export.</p> : null}
        <p
          role="status"
          className={message?.ok === false ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
        >
          {message?.text ?? ''}
        </p>
      </CardContent>
    </Card>
  );
}

const BASIS_OPTIONS: { value: DollarBasis; label: string }[] = [
  { value: 'todays', label: 'Today’s dollars' },
  { value: 'nominal', label: 'Future (nominal) dollars' },
];

function CsvCard() {
  const profile = useActiveProfile();
  const appBasis = useProfileStore((s) => s.dollarBasis);
  const ctx = useEngineContext();
  const [chosen, setChosen] = useState<DollarBasis | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const groupName = useId();
  const basis = chosen ?? appBasis;

  const onDownload = () => {
    if (!profile) return;
    const household = profile.household;
    const result = projectHousehold(household, ctx);
    if (result.status !== 'ok') {
      setMessage({
        ok: false,
        text:
          result.status === 'invalid'
            ? 'The forecast cannot run with this profile yet. Fix the issues shown on the Dashboard, then try again.'
            : 'The forecast needs rule values that are not verified yet, so there are no rows to export.',
      });
      return;
    }
    const csv = toCsv(result.value, {
      dollarBasis: basis,
      accountNames: Object.fromEntries(household.accounts.map((a) => [a.id, a.name])),
      personNames: Object.fromEntries(household.people.map((p) => [p.id, p.name])),
    });
    const fileName = `retirement-navigator-forecast-${fileSlug(household.name)}-${basis === 'todays' ? 'todays-dollars' : 'future-dollars'}-${todayStamp()}.csv`;
    downloadText(fileName, csv, 'text/csv;charset=utf-8');
    setMessage({ ok: true, text: `Downloaded ${plural(result.value.rows.length, 'forecast row')} to ${fileName}.` });
  };

  return (
    <Card aria-labelledby="csv-title">
      <CardHeader>
        <CardTitle id="csv-title" className="flex items-center gap-2">
          <FileSpreadsheet aria-hidden="true" className="size-4" /> CSV export of the forecast
        </CardTitle>
        <CardDescription>
          {profile ? (
            <>
              Every year of the baseline forecast for <span className="font-medium">{profile.household.name}</span>{' '}
              (fixed returns), with a column for each person’s age and each account’s balance. Taxes the model does not
              compute are empty cells. Cells that a spreadsheet could run as formulas are escaped.
            </>
          ) : (
            'Create or choose a profile to export its forecast.'
          )}
        </CardDescription>
      </CardHeader>
      {profile ? (
        <CardContent className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Dollars</legend>
            {BASIS_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={groupName}
                  value={o.value}
                  checked={basis === o.value}
                  onChange={() => setChosen(o.value)}
                  className="size-4 accent-primary"
                />
                {o.label}
                {o.value === appBasis ? (
                  <span className="text-muted-foreground">(the app’s current setting)</span>
                ) : null}
              </label>
            ))}
          </fieldset>
          <div>
            <Button variant="outline" onClick={onDownload}>
              <Download aria-hidden="true" /> Download CSV
            </Button>
          </div>
          <p
            role="status"
            className={message?.ok === false ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
          >
            {message?.text ?? ''}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

const CONFIRM_WORD = 'DELETE';

/** Clears IndexedDB (profiles, scenarios, settings), the saved theme and in-memory results. */
async function deleteAllMyData(): Promise<void> {
  useMonteCarloStore.getState().reset();
  await useProfileStore.getState().deleteAllData();
  clearStoredTheme();
}

function DeleteAllCard() {
  const navigate = useNavigate();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profileCount = useProfileStore((s) => Object.keys(s.profiles).length);
  const scenarioCount = useScenarioStore((s) => Object.keys(s.scenarios).length);
  const confirmed = typed.trim() === CONFIRM_WORD;

  const onConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAllMyData();
      setOpen(false);
      void navigate('/welcome', { replace: true });
    } catch (e) {
      setError(`Your data could not be deleted: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card aria-labelledby="delete-title" className="border-destructive/40">
      <CardHeader>
        <CardTitle id="delete-title" className="flex items-center gap-2">
          <Trash2 aria-hidden="true" className="size-4" /> Delete all my data
        </CardTitle>
        <CardDescription>
          Removes every profile, scenario and setting stored by Retirement Navigator in this browser, and your theme
          choice, then starts over at the welcome screen. This cannot be undone; export a JSON file first if you might
          want your plans back.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setTyped('');
              setError(null);
            }
          }}
        >
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 aria-hidden="true" /> Delete all my data
          </Button>
          <DialogContent>
            <DialogTitle>Delete all your data?</DialogTitle>
            <DialogDescription>
              This permanently removes {plural(profileCount, 'profile')}, {plural(scenarioCount, 'scenario')}, your
              settings and your theme choice from this browser.
            </DialogDescription>
            <form onSubmit={(e) => void onConfirm(e)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor={inputId}>Type {CONFIRM_WORD} to confirm</Label>
                <Input
                  id={inputId}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" variant="destructive" disabled={!confirmed || deleting}>
                  {deleting ? 'Deleting…' : 'Delete everything'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function DataPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Data &amp; Privacy</h1>
        <p className="max-w-2xl text-muted-foreground">
          How Retirement Navigator handles your information, and how to export, import or delete it.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive aria-hidden="true" className="size-4" /> Stored on this device, unencrypted
            </CardTitle>
            <CardDescription>
              Profiles, scenarios and settings are saved in your browser’s IndexedDB storage on this device. They are
              not encrypted. Anyone with access to this browser profile can read them.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WifiOff aria-hidden="true" className="size-4" /> Nothing leaves your device
            </CardTitle>
            <CardDescription>
              The app makes no network requests with your data. There is no account, no analytics, no telemetry and no
              remote fonts. A content security policy blocks outbound connections. Exports are saved by your browser
              straight from this page; nothing is uploaded.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ExportCard />
        <CsvCard />
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Printer aria-hidden="true" className="size-4" />
        <span>
          For a paper or PDF copy of the active profile with its assumptions and disclaimers, open the{' '}
          <Link to="/print" className="font-medium text-foreground underline underline-offset-4">
            printable summary
          </Link>
          .
        </span>
      </p>
      <ImportCard />
      <DeleteAllCard />
    </div>
  );
}
