/** Persistent colony warnings (docs/GAME_DESIGN.md §12), derived from the HUD snapshot. Pure. */
import type { ActivityKind, BuildingType, BuildingStatus, LogSeverity, ResourceAmounts, Season } from '../../sim';
import type { PanelId } from '../../store';
import { NEED_PER_SETTLER_PER_DAY, formatDays, seasonInfo, pluralize } from './format';
import { RESOURCE_LABEL } from './tooltipText';

export type WarningAction =
  | { kind: 'panel'; panel: PanelId }
  | { kind: 'settler'; id: number }
  | { kind: 'none' };

export interface Warning {
  id: string;
  severity: LogSeverity;
  text: string;
  action: WarningAction;
}

export interface WarningInput {
  stock: ResourceAmounts;
  storageCapacity: number;
  population: number;
  housingCapacity: number;
  season: Season;
  day: number;
  settlers: readonly { id: number; name: string; needs: { hunger: number; happiness: number; health: number }; activity: { kind: ActivityKind } }[];
  buildings: readonly { type: BuildingType; status: BuildingStatus }[];
}

const SEVERITY_ORDER: Record<LogSeverity, number> = { danger: 0, warning: 1, info: 2, good: 3 };

/** All active warnings, most severe first (stable within a severity). */
export function computeWarnings(s: WarningInput): Warning[] {
  const out: Warning[] = [];
  const pop = s.population;
  const daily = pop * NEED_PER_SETTLER_PER_DAY;

  for (const r of ['food', 'water'] as const) {
    const label = RESOURCE_LABEL[r];
    if (s.stock[r] < 1) {
      out.push({
        id: `${r}Out`,
        severity: 'danger',
        text: r === 'food' ? 'No food! Settlers are starving.' : 'No water! Settlers are getting sick.',
        action: { kind: 'panel', panel: 'build' },
      });
    } else if (pop > 0 && s.stock[r] < daily) {
      out.push({
        id: `${r}Low`,
        severity: 'warning',
        text: `${label} running low: ${formatDays(s.stock[r] / daily)} left`,
        action: { kind: 'panel', panel: 'build' },
      });
    }
  }

  if (s.season === 'autumn' && pop > 0 && s.stock.food < pop * 10) {
    const n = seasonInfo(s.day).daysUntilNextSeason + 1;
    out.push({
      id: 'winterForecast',
      severity: 'warning',
      text: `Winter in ${pluralize(n, 'day')}: stockpile ${pop * 10} food (have ${Math.floor(s.stock.food)})`,
      action: { kind: 'panel', panel: 'priorities' },
    });
  }

  if (pop > s.housingCapacity) {
    const n = pop - s.housingCapacity;
    out.push({
      id: 'homeless',
      severity: s.season === 'winter' ? 'danger' : 'warning',
      text: `${n} ${n === 1 ? 'settler' : 'settlers'} sleeping outdoors`,
      action: { kind: 'panel', panel: 'build' },
    });
  }

  if (s.storageCapacity > 0) {
    const full = (['wood', 'stone', 'food', 'water', 'tools'] as const).filter((r) => s.stock[r] >= s.storageCapacity * 0.95);
    if (full.length > 0) {
      out.push({
        id: 'storageFull',
        severity: 'warning',
        text: `Storage full: ${full.map((r) => RESOURCE_LABEL[r].toLowerCase()).join(', ')}`,
        action: { kind: 'panel', panel: 'build' },
      });
    }
  }

  if (s.stock.tools < 1 && pop >= 3 && !s.buildings.some((b) => b.type === 'workshop')) {
    out.push({ id: 'noTools', severity: 'info', text: 'Out of tools: work is slower. Build a workshop.', action: { kind: 'panel', panel: 'build' } });
  }

  const starving = s.settlers.find((x) => x.needs.hunger < 10);
  if (starving) out.push({ id: 'starving', severity: 'danger', text: `${starving.name} is starving`, action: { kind: 'settler', id: starving.id } });

  const hurt = s.settlers.find((x) => x.needs.health < 30);
  if (hurt) out.push({ id: 'lowHealth', severity: 'danger', text: `${hurt.name} is badly hurt`, action: { kind: 'settler', id: hurt.id } });

  const breaking = s.settlers.find((x) => x.needs.happiness < 15);
  const miserable = s.settlers.find((x) => x.needs.happiness < 30 && x.needs.happiness >= 15);
  if (breaking) out.push({ id: 'breaking', severity: 'danger', text: `${breaking.name} may leave`, action: { kind: 'settler', id: breaking.id } });
  else if (miserable) out.push({ id: 'unhappy', severity: 'warning', text: `${miserable.name} is miserable`, action: { kind: 'settler', id: miserable.id } });

  const idle = s.settlers.filter((x) => x.activity.kind === 'idle').length;
  if (idle >= 2) out.push({ id: 'idle', severity: 'info', text: 'Settlers have nothing to do. Build something?', action: { kind: 'panel', panel: 'priorities' } });

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Ids of danger warnings present now that were not in `previous` (these toast once). */
export function newDangerIds(current: readonly Warning[], previous: ReadonlySet<string>): string[] {
  return current.filter((w) => w.severity === 'danger' && !previous.has(w.id)).map((w) => w.id);
}
