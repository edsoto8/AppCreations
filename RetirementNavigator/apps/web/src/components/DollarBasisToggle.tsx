import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useProfileStore } from '@/state/profileStore';

/** Today's dollars vs future nominal dollars (applies to cards, charts, tables and exports). */
export function DollarBasisToggle() {
  const basis = useProfileStore((s) => s.dollarBasis);
  const setBasis = useProfileStore((s) => s.setDollarBasis);
  return (
    <ToggleGroup
      type="single"
      value={basis}
      onValueChange={(v: string) => {
        if (v === 'todays' || v === 'nominal') setBasis(v);
      }}
      aria-label="Dollar basis"
    >
      <ToggleGroupItem value="todays">Today’s dollars</ToggleGroupItem>
      <ToggleGroupItem value="nominal">Future dollars</ToggleGroupItem>
    </ToggleGroup>
  );
}
