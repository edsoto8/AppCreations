import { useNavigate } from 'react-router';
import { useProfileStore } from '@/state/profileStore';
import { NativeSelect } from '@/components/ui/native-select';

export function ProfileSwitcher() {
  const profiles = useProfileStore((s) => s.profiles);
  const activeId = useProfileStore((s) => s.activeId);
  const setActive = useProfileStore((s) => s.setActive);
  const navigate = useNavigate();
  const entries = Object.values(profiles);
  if (entries.length === 0) return null;
  return (
    <NativeSelect
      aria-label="Active profile"
      className="h-8 max-w-44 text-xs sm:max-w-56"
      value={activeId ?? ''}
      onChange={(e) => {
        if (e.target.value === '__manage') navigate('/profiles');
        else setActive(e.target.value);
      }}
    >
      {entries.map((p) => (
        <option key={p.id} value={p.id}>
          {p.household.name}
        </option>
      ))}
      <option value="__manage">Manage profiles…</option>
    </NativeSelect>
  );
}
