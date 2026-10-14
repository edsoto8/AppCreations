import { useId, useRef, useState, type DragEvent } from 'react';
import { CircleCheckIcon, DownloadIcon, FileUpIcon, LoaderCircleIcon, TriangleAlertIcon, UploadIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { errorMessage, saveDownload } from '@/api/client';
import type { ImportResult } from '@/api/types';
import { formatCount, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CSV_COLUMNS, looksLikeCsv, MAX_CSV_BYTES, previewCsv, SAMPLE_CSV } from './csv';

interface ImportCardProps {
  importing: boolean;
  onImport: (csv: string) => Promise<ImportResult>;
}

interface LoadedFile {
  name: string;
  text: string;
}

/** CSV import: pick or drop a file, preview it, send it as text/csv, show per-line results. */
export function ImportCard({ importing, onImport }: ImportCardProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const load = async (f: File | undefined) => {
    setResult(null);
    if (!f) return;
    if (!looksLikeCsv(f)) {
      setProblem(`“${f.name}” is not a CSV file. Save it as .csv and try again.`);
      return;
    }
    if (f.size > MAX_CSV_BYTES) {
      setProblem('That file is larger than 1 MB. Split it into smaller files.');
      return;
    }
    const text = await f.text();
    if (!text.trim()) {
      setProblem(`“${f.name}” is empty.`);
      return;
    }
    setProblem(null);
    setFile({ name: f.name, text });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void load(e.dataTransfer.files?.[0]);
  };

  const clear = () => {
    setFile(null);
    setProblem(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const submit = async () => {
    if (!file) return;
    try {
      const res = await onImport(file.text);
      setResult(res);
      if (res.imported > 0) {
        toast.success(`Imported ${formatCount(res.imported, 'payment')}`, {
          description: res.errors.length ? `${formatCount(res.errors.length, 'line')} skipped.` : undefined,
        });
        clear();
      }
    } catch (error) {
      toast.error('Import failed', { description: errorMessage(error) });
    }
  };

  const preview = file ? previewCsv(file.text) : null;

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="text-base">Import from CSV</CardTitle>
        <CardDescription>Bring in many payments at once, e.g. exported from your lender&apos;s website.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!file ? (
          <label
            htmlFor={`${id}-file`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-testid="csv-dropzone"
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition-colors hover:bg-muted/50 focus-within:ring-[3px] focus-within:ring-ring/50',
              dragging && 'border-primary bg-primary/5',
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileUpIcon className="size-5" aria-hidden />
            </span>
            <span className="text-sm font-medium">{dragging ? 'Drop the file to preview it' : 'Drop a CSV file here, or choose one'}</span>
            <span className="text-xs text-muted-foreground">.csv, up to 1 MB</span>
            <input
              ref={inputRef}
              id={`${id}-file`}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Choose a CSV file"
              onChange={(e) => void load(e.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCount(preview!.dataLines, 'payment line')}
                  {preview!.hasHeader ? ' + header' : ''}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={clear} aria-label="Remove file">
                <XIcon />
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border bg-muted/30" role="region" aria-label="File preview" tabIndex={0}>
              <table className="num w-full font-mono text-xs">
                <tbody>
                  {preview!.lines.map((l, i) => (
                    <tr key={l.line} className={cn('border-b last:border-0', i === 0 && preview!.hasHeader && 'font-semibold text-muted-foreground')}>
                      <td className="w-8 border-r px-2 py-1.5 text-right text-muted-foreground/70 select-none">{l.line}</td>
                      {l.cells.map((c, j) => (
                        <td key={j} className="px-2 py-1.5 whitespace-nowrap">
                          {c || <span className="text-muted-foreground/50">·</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview!.totalLines > preview!.lines.length && (
              <p className="text-xs text-muted-foreground">
                Showing the first {preview!.lines.length} of {formatNumber(preview!.totalLines)} lines.
              </p>
            )}
            <Button onClick={() => void submit()} disabled={importing || preview!.dataLines === 0}>
              {importing ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />} Import {formatCount(preview!.dataLines, 'line')}
            </Button>
          </div>
        )}

        {problem && (
          <p className="text-xs font-medium text-negative" role="alert">
            {problem}
          </p>
        )}

        {result && (
          <Alert variant={result.errors.length === 0 ? 'positive' : result.imported > 0 ? 'warning' : 'destructive'} data-testid="import-result">
            {result.errors.length === 0 ? <CircleCheckIcon /> : <TriangleAlertIcon />}
            <AlertTitle>
              Imported {formatCount(result.imported, 'payment')}
              {result.errors.length > 0 && `, ${formatCount(result.errors.length, 'line')} not imported`}
            </AlertTitle>
            {result.errors.length > 0 && (
              <AlertDescription>
                <ul className="mt-1 grid max-h-40 w-full gap-1 overflow-y-auto text-xs" aria-label="Lines that could not be imported">
                  {result.errors.map((e) => (
                    <li key={`${e.line}-${e.message}`} className="flex gap-2">
                      <Badge variant="outline" className="num shrink-0">
                        Line {e.line}
                      </Badge>
                      <span>{e.message}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs">
                  Imported lines are saved. Fix the other lines and import again — payments already recorded (same date
                  and amount) are skipped automatically, so re-importing the whole file is safe.
                </p>
              </AlertDescription>
            )}
          </Alert>
        )}

        <div className="grid gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Expected format</p>
          <code className="w-fit rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">{CSV_COLUMNS}</code>
          <ul className="grid list-disc gap-0.5 pl-4">
            <li>One payment per line. A header line is optional.</li>
            <li>
              Dates as <span className="font-mono">yyyy-mm-dd</span> or <span className="font-mono">mm/dd/yyyy</span>.
            </li>
            <li>Principal, interest and note are optional; leave them empty if your statement does not show them.</li>
          </ul>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 w-fit"
            onClick={() => saveDownload({ blob: new Blob([SAMPLE_CSV], { type: 'text/csv' }), filename: 'loanpilot-payments-sample.csv' })}
          >
            <DownloadIcon /> Download sample CSV
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
