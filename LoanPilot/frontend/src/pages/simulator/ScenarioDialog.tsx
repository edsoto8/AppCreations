import { useEffect, useState, type FormEvent } from 'react';
import { Loader2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldError, FormField } from '@/components/FormField';
import { errorMessage, isApiError } from '@/api/client';

export interface ScenarioDialogValues {
  name: string;
  description: string | null;
}

interface ScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'rename';
  initial?: ScenarioDialogValues;
  /** One-line summary of what will be saved. */
  summary?: string;
  /** Resolves on success; a rejected ApiError(400) shows its field errors in the form. */
  onSubmit: (values: ScenarioDialogValues) => Promise<unknown>;
}

const NAME_MAX = 100;

export function ScenarioDialog({ open, onOpenChange, mode, initial, summary, onSubmit }: ScenarioDialogProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setDescription(initial?.description ?? '');
      setErrors({});
      setGeneral(null);
    }
    // Reset only when the dialog opens, not while the user types.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrors({ name: 'Give the scenario a name so you can find it later.' });
      return;
    }
    setPending(true);
    setErrors({});
    setGeneral(null);
    try {
      await onSubmit({ name: trimmed, description: description.trim() || null });
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err) && err.isValidation) {
        const next: Record<string, string> = {};
        const rest: string[] = [];
        for (const [key, messages] of Object.entries(err.errors)) {
          if (key === 'name' || key === 'description') next[key] = messages[0];
          else rest.push(...messages);
        }
        setErrors(next);
        setGeneral(rest.length ? rest.join(' ') : Object.keys(next).length ? null : err.message);
      } else {
        setGeneral(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Save scenario' : 'Rename scenario'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'Saved scenarios appear in the comparison and can be reopened here any time.'
                : 'Change the name or description. The plan itself is not changed.'}
            </DialogDescription>
          </DialogHeader>
          {summary && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{summary}</p>}
          <FormField label="Name" htmlFor="scenario-name" error={errors.name}>
            <Input
              id="scenario-name"
              value={name}
              maxLength={NAME_MAX}
              autoFocus
              placeholder="e.g. Extra $100 a month"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'scenario-name-error' : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField label="Description" htmlFor="scenario-description" optional error={errors.description}>
            <Textarea
              id="scenario-description"
              value={description}
              maxLength={500}
              rows={3}
              placeholder="What's the idea behind this plan?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          {general && (
            <Alert variant="destructive">
              <AlertDescription>
                <FieldError>{general}</FieldError>
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              {mode === 'create' ? 'Save scenario' : 'Save name'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
