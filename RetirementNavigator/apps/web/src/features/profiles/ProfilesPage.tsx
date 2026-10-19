import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { SAMPLE_PROFILES } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useProfileStore } from '@/state/profileStore';
import { CURRENT_YEAR } from '@/app/env';
import { formatCents } from '@/lib/format';

export function ProfilesPage() {
  const profiles = useProfileStore((s) => s.profiles);
  const activeId = useProfileStore((s) => s.activeId);
  const invalid = useProfileStore((s) => s.invalidDocuments);
  const { setActive, renameProfile, duplicateProfile, deleteProfile, createProfile } = useProfileStore.getState();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState<string>(SAMPLE_PROFILES[0]?.id ?? '');
  const list = Object.values(profiles);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profiles"
        description="Keep separate plans side by side, for example your own plan and a what-if copy."
        actions={
          <Button onClick={() => navigate('/welcome')}>
            <Plus aria-hidden="true" /> New profile
          </Button>
        }
      />
      {invalid > 0 ? (
        <p className="text-sm text-destructive" role="status">
          {invalid} stored profile{invalid === 1 ? '' : 's'} could not be read and {invalid === 1 ? 'is' : 'are'} not
          shown.
        </p>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2" aria-label="Profiles">
        {list.map((p) => {
          const h = p.household;
          const total = h.accounts.reduce((sum, a) => sum + a.balance, 0);
          const isActive = p.id === activeId;
          return (
            <li key={p.id}>
              <Card className={isActive ? 'border-primary' : undefined}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{h.name}</CardTitle>
                    {isActive ? <Badge variant="secondary">Active</Badge> : null}
                  </div>
                  <CardDescription>
                    {h.people.map((x) => x.name).join(' & ')} · {h.accounts.length} account
                    {h.accounts.length === 1 ? '' : 's'} · {formatCents(total)} saved
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {!isActive ? (
                    <Button size="sm" onClick={() => setActive(p.id)}>
                      <Check aria-hidden="true" /> Make active
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRenaming({ id: p.id, name: h.name })}
                    aria-label={`Rename ${h.name}`}
                  >
                    <Pencil aria-hidden="true" /> Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void duplicateProfile(p.id)}
                    aria-label={`Duplicate ${h.name}`}
                  >
                    <Copy aria-hidden="true" /> Duplicate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(p.id)} aria-label={`Delete ${h.name}`}>
                    <Trash2 aria-hidden="true" /> Delete
                  </Button>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <Card>
        <CardHeader>
          <CardTitle>Add a sample profile</CardTitle>
          <CardDescription>Illustrative households to explore the app. They are not recommendations.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-col gap-1.5">
            <Label htmlFor="sample-select">Sample</Label>
            <NativeSelect id="sample-select" value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
              {SAMPLE_PROFILES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              const sample = SAMPLE_PROFILES.find((s) => s.id === sampleId);
              if (!sample) return;
              const h = sample.build(CURRENT_YEAR);
              // Each sample copy gets its own id so several copies can coexist.
              void createProfile({ ...h, id: `${h.id}-${Date.now().toString(36)}` as typeof h.id });
            }}
          >
            <Plus aria-hidden="true" /> Add sample
          </Button>
        </CardContent>
      </Card>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogTitle>Rename profile</DialogTitle>
          <DialogDescription>Profile names are shown in the profile switcher.</DialogDescription>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming) renameProfile(renaming.id, renaming.name);
              setRenaming(null);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rename-input">Name</Label>
              <Input
                id="rename-input"
                value={renaming?.name ?? ''}
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
          <DialogTitle>Delete this profile?</DialogTitle>
          <DialogDescription>
            “{deleting ? profiles[deleting]?.household.name : ''}” will be removed from this device. This cannot be
            undone.
          </DialogDescription>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) void deleteProfile(deleting);
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
    </div>
  );
}
