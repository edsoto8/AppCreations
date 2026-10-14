import { useState } from 'react';
import { BookmarkIcon, CheckIcon, CopyPlusIcon, FilePlus2Icon, Loader2Icon, MoreHorizontalIcon, PencilIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Scenario } from '@/api/types';

interface ScenarioToolbarProps {
  scenarios: Scenario[];
  loading: boolean;
  active: Scenario | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  onLoad: (id: number) => void;
  onSaveNew: () => void;
  onSaveChanges: () => void;
  onRename: () => void;
  onDelete: () => Promise<unknown>;
  onNew: () => void;
}

/** Saved-scenario picker plus save / save changes / rename / delete. */
export function ScenarioToolbar({
  scenarios,
  loading,
  active,
  dirty,
  canSave,
  saving,
  onLoad,
  onSaveNew,
  onSaveChanges,
  onRename,
  onDelete,
  onNew,
}: ScenarioToolbarProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 shadow-card sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex" aria-hidden>
          <BookmarkIcon className="size-4" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <label htmlFor="saved-scenario" className="text-xs font-medium text-muted-foreground">
            Saved scenarios
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <Select value={active ? String(active.id) : ''} onValueChange={(v) => onLoad(Number(v))} disabled={loading || scenarios.length === 0}>
              <SelectTrigger id="saved-scenario" className="w-full min-w-0 sm:max-w-xs" size="sm">
                <SelectValue placeholder={loading ? 'Loading…' : scenarios.length === 0 ? 'No saved scenarios yet' : 'Load a saved scenario'} />
              </SelectTrigger>
              <SelectContent>
                {scenarios.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {active && (dirty ? <Badge variant="warning">Unsaved changes</Badge> : <Badge variant="positive"><CheckIcon /> Saved</Badge>)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <>
            <Button size="sm" onClick={onSaveChanges} disabled={!dirty || !canSave || saving}>
              {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Save changes
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="More scenario actions">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={onSaveNew} disabled={!canSave}>
                  <CopyPlusIcon /> Save as new…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onRename}>
                  <PencilIcon /> Rename…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onNew}>
                  <FilePlus2Icon /> Start a new scenario
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-negative focus:text-negative [&_svg]:!text-negative">
                  <Trash2Icon /> Delete…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <Button size="sm" onClick={onSaveNew} disabled={!canSave}>
            <SaveIcon /> Save scenario
          </Button>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{active?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The saved scenario is removed from this loan and from the comparison. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                setDeleting(true);
                onDelete()
                  .then(() => setConfirmDelete(false))
                  .catch(() => undefined)
                  .finally(() => setDeleting(false));
              }}
            >
              {deleting && <Loader2Icon className="animate-spin" />} Delete scenario
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
