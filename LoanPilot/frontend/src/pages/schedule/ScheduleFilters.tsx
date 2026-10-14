import { useId } from 'react';
import { SearchIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DateInput } from '@/components/DateInput';
import { activeFilterCount, type RowFilters } from './scheduleModel';

interface ScheduleFiltersProps {
  filters: RowFilters;
  years: number[];
  onChange: (patch: Partial<RowFilters>) => void;
  onClear: () => void;
}

const ALL_YEARS = 'all';

/** Search, year, date range and "only extra payments" for the per-payment view. */
export function ScheduleFilters({ filters, years, onChange, onClear }: ScheduleFiltersProps) {
  const id = useId();
  const active = activeFilterCount(filters);
  return (
    <div role="search" aria-label="Filter the schedule" className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
      <div className="grid gap-1.5 sm:w-64">
        <Label htmlFor={`${id}-search`} className="text-xs text-muted-foreground">
          Search
        </Label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={`${id}-search`}
            type="search"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="Payment #, date or amount"
            className="pl-9"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:contents">
        <div className="grid gap-1.5 sm:w-32">
          <Label htmlFor={`${id}-year`} className="text-xs text-muted-foreground">
            Year
          </Label>
          <Select
            value={filters.year === null ? ALL_YEARS : String(filters.year)}
            onValueChange={(v) => onChange({ year: v === ALL_YEARS ? null : Number(v) })}
          >
            <SelectTrigger id={`${id}-year`} aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_YEARS}>All years</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 self-end pb-2 sm:order-last sm:pb-2">
          <Switch id={`${id}-extra`} checked={filters.extraOnly} onCheckedChange={(v) => onChange({ extraOnly: v })} />
          <Label htmlFor={`${id}-extra`} className="text-sm font-normal">
            Only extra payments
          </Label>
        </div>

        <div className="grid gap-1.5 sm:w-40">
          <Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
            From
          </Label>
          <DateInput id={`${id}-from`} value={filters.from} max={filters.to ?? undefined} onValueChange={(v) => onChange({ from: v })} />
        </div>
        <div className="grid gap-1.5 sm:w-40">
          <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
            To
          </Label>
          <DateInput id={`${id}-to`} value={filters.to} min={filters.from ?? undefined} onValueChange={(v) => onChange({ to: v })} />
        </div>
      </div>

      {active > 0 && (
        <Button variant="ghost" size="sm" className="justify-self-start sm:order-last sm:mb-0.5" onClick={onClear}>
          <XIcon /> Clear filters ({active})
        </Button>
      )}
    </div>
  );
}
