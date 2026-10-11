import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, MOODLETS, OBJECTIVES, type ActivityKind, type BuildingStatus, type BuildingType, type LogEntry } from '../../src/sim';
import { computeWarnings, newDangerIds, type WarningInput } from '../../src/ui/lib/warnings';
import { OBJECTIVE_LIST, currentObjective, newlyDone, nextUnlock, objectiveProgress, objectiveRows, type ObjectiveInput } from '../../src/ui/lib/objectives';
import { ACTIVITY_JOB, countByJob, stepLevel } from '../../src/ui/lib/jobs';
import { describeDecision, formatCountdown, readSide, realSecondsLeft } from '../../src/ui/lib/eventInfo';
import { filterLog, formatHoursRemaining, unreadCount } from '../../src/ui/lib/logView';
import { seriesFor, sparklinePoints, spanLabel, type HistorySample } from '../../src/ui/lib/statsSeries';
import { hasMoodletLabel } from '../../src/ui/lib/settlerInfo';
import { productionText } from '../../src/ui/panels/BuildPanel';

const settler = (id: number, name: string, o: { hunger?: number; happiness?: number; health?: number; kind?: ActivityKind } = {}) => ({
  id,
  name,
  needs: { hunger: o.hunger ?? 80, happiness: o.happiness ?? 60, health: o.health ?? 100 },
  activity: { kind: o.kind ?? ('walking' as ActivityKind) },
});
const building = (type: BuildingType, status: BuildingStatus = 'complete') => ({ type, status });

const base = (): WarningInput => ({
  stock: { wood: 50, stone: 20, food: 100, water: 100, tools: 3 },
  storageCapacity: 150,
  population: 5,
  housingCapacity: 8,
  season: 'spring',
  day: 3,
  settlers: [settler(1, 'Ann'), settler(2, 'Bo')],
  buildings: [building('townCenter')],
});
const ids = (w: WarningInput) => computeWarnings(w).map((x) => x.id);

describe('computeWarnings (GAME_DESIGN §12)', () => {
  it('is quiet for a healthy colony', () => {
    expect(computeWarnings(base())).toEqual([]);
  });

  it('warns about food and water: low under one day, out at zero', () => {
    const low = { ...base(), stock: { ...base().stock, food: 9 } };
    expect(computeWarnings(low)[0]).toMatchObject({ id: 'foodLow', severity: 'warning', text: 'Food running low: 0.9 days left' });
    const out = { ...base(), stock: { ...base().stock, water: 0 } };
    expect(computeWarnings(out)[0]).toMatchObject({ id: 'waterOut', severity: 'danger', text: 'No water! Settlers are getting sick.' });
    expect(ids({ ...base(), stock: { ...base().stock, food: 10 } })).not.toContain('foodLow');
  });

  it('forecasts winter in autumn when the larder is short', () => {
    const w = computeWarnings({ ...base(), season: 'autumn', day: 11, stock: { ...base().stock, food: 30 } }).find((x) => x.id === 'winterForecast');
    expect(w?.text).toBe('Winter in 5 days: stockpile 50 food (have 30)');
    expect(ids({ ...base(), season: 'autumn', day: 15, stock: { ...base().stock, food: 30 } })).toContain('winterForecast');
    expect(computeWarnings({ ...base(), season: 'autumn', day: 15, stock: { ...base().stock, food: 30 } }).find((x) => x.id === 'winterForecast')?.text).toMatch(/^Winter in 1 day:/);
    expect(ids({ ...base(), season: 'autumn', day: 11, stock: { ...base().stock, food: 60 } })).not.toContain('winterForecast');
    expect(ids({ ...base(), season: 'spring', stock: { ...base().stock, food: 30 } })).not.toContain('winterForecast');
  });

  it('counts homeless settlers, danger in winter', () => {
    const w = { ...base(), population: 7, housingCapacity: 4 };
    expect(computeWarnings(w).find((x) => x.id === 'homeless')).toMatchObject({ severity: 'warning', text: '3 settlers sleeping outdoors' });
    expect(computeWarnings({ ...w, population: 5 }).find((x) => x.id === 'homeless')?.text).toBe('1 settler sleeping outdoors');
    expect(computeWarnings({ ...w, season: 'winter' }).find((x) => x.id === 'homeless')?.severity).toBe('danger');
  });

  it('reports full storage at 95% and lists the resources', () => {
    const w = computeWarnings({ ...base(), stock: { ...base().stock, wood: 143, stone: 150 } }).find((x) => x.id === 'storageFull');
    expect(w?.text).toBe('Storage full: wood, stone');
    expect(ids({ ...base(), stock: { ...base().stock, wood: 142 } })).not.toContain('storageFull');
  });

  it('suggests a workshop only without one and with at least 3 settlers', () => {
    const noTools = { ...base(), stock: { ...base().stock, tools: 0 } };
    expect(ids(noTools)).toContain('noTools');
    expect(ids({ ...noTools, buildings: [building('townCenter'), building('workshop', 'construction')] })).not.toContain('noTools');
    expect(ids({ ...noTools, population: 2 })).not.toContain('noTools');
  });

  it('flags settlers in trouble and links to them', () => {
    const w = computeWarnings({
      ...base(),
      settlers: [settler(1, 'Ann', { hunger: 5 }), settler(2, 'Bo', { health: 20 }), settler(3, 'Cy', { happiness: 10 }), settler(4, 'Di', { happiness: 25 })],
    });
    expect(w.find((x) => x.id === 'starving')).toMatchObject({ severity: 'danger', text: 'Ann is starving', action: { kind: 'settler', id: 1 } });
    expect(w.find((x) => x.id === 'lowHealth')?.text).toBe('Bo is badly hurt');
    expect(w.find((x) => x.id === 'breaking')?.text).toBe('Cy may leave');
    expect(w.find((x) => x.id === 'unhappy')).toBeUndefined(); // the worse case wins
    expect(ids({ ...base(), settlers: [settler(4, 'Di', { happiness: 25 })] })).toContain('unhappy');
  });

  it('notes idle settlers when two or more have nothing to do', () => {
    const idle = [settler(1, 'A', { kind: 'idle' }), settler(2, 'B', { kind: 'idle' })];
    expect(ids({ ...base(), settlers: idle })).toContain('idle');
    expect(ids({ ...base(), settlers: [idle[0]!] })).not.toContain('idle');
  });

  it('orders by severity', () => {
    const w = computeWarnings({
      ...base(),
      stock: { ...base().stock, tools: 0, food: 0 },
      settlers: [settler(1, 'Ann', { hunger: 5 })],
      population: 6,
      housingCapacity: 4,
    });
    expect(w.map((x) => x.severity)).toEqual([...w.map((x) => x.severity)].sort((a, b) => ['danger', 'warning', 'info', 'good'].indexOf(a) - ['danger', 'warning', 'info', 'good'].indexOf(b)));
    expect(w[0]!.severity).toBe('danger');
  });

  it('newDangerIds returns only fresh danger warnings', () => {
    const w = computeWarnings({ ...base(), stock: { ...base().stock, food: 0, water: 5 } });
    expect(newDangerIds(w, new Set())).toEqual(['foodOut']);
    expect(newDangerIds(w, new Set(['foodOut']))).toEqual([]);
  });
});

describe('objectives (GAME_DESIGN §11)', () => {
  const input = (o: Partial<ObjectiveInput> = {}): ObjectiveInput => ({
    day: 4,
    population: 7,
    stock: { food: 40 },
    progress: { objectivesDone: [], toolsCrafted: 2 },
    buildings: [building('townCenter'), building('house'), building('farm', 'construction')],
    settlers: [{ needs: { happiness: 60 } }, { needs: { happiness: 40 } }],
    ...o,
  });

  it('lists all ten, ending with victory', () => {
    expect(OBJECTIVE_LIST).toHaveLength(10);
    expect(OBJECTIVE_LIST.map((o) => o.id)).toEqual(OBJECTIVES.map((o) => o.id));
    expect(OBJECTIVE_LIST[9]).toMatchObject({ id: 'thriving', victory: true });
  });

  it('derives progress from the snapshot', () => {
    const s = input();
    expect(objectiveProgress('roof', s)).toMatchObject({ current: 1, target: 1 });
    expect(objectiveProgress('bread', s)).toMatchObject({ current: 0, target: 1 });
    expect(objectiveProgress('foundations', s)).toMatchObject({ current: 1, target: 3, label: '1/3' });
    expect(objectiveProgress('toolmaker', s).label).toBe('2/5');
    expect(objectiveProgress('growing', s).label).toBe('7/10');
    expect(objectiveProgress('larder', s)).toMatchObject({ target: 70, label: '40/70 food' });
    expect(objectiveProgress('winter', s).label).toBe('Day 4/21');
    expect(objectiveProgress('thriving', s).label).toBe('7/20 settlers · mood 50/50');
    expect(objectiveProgress('timber', input({ buildings: [building('lumberCamp'), building('mine', 'construction')] })).current).toBe(1);
  });

  it('clamps and trusts objectivesDone for completion', () => {
    expect(objectiveProgress('growing', input({ population: 25 })).current).toBe(10);
    const rows = objectiveRows(input({ progress: { objectivesDone: ['roof'], toolsCrafted: 0 } }));
    expect(rows[0]!.done).toBe(true);
    expect(currentObjective(rows)?.id).toBe('bread');
    expect(nextUnlock(rows)?.unlocks).toBe('Storage');
    expect(nextUnlock(objectiveRows(input({ progress: { objectivesDone: ['foundations'], toolsCrafted: 0 } })))?.unlocks).toBe('Workshop');
    expect(currentObjective(objectiveRows(input({ progress: { objectivesDone: OBJECTIVE_LIST.map((o) => o.id), toolsCrafted: 0 } })))).toBeNull();
  });

  it('finds newly completed objectives', () => {
    expect(newlyDone(new Set(['roof']), ['roof', 'bread'])).toEqual(['bread']);
    expect(newlyDone(new Set(), [])).toEqual([]);
  });
});

describe('job priorities', () => {
  it('counts settlers per job from their activity', () => {
    const counts = countByJob([{ activity: { kind: 'chopping' } }, { activity: { kind: 'chopping' } }, { activity: { kind: 'carrying' } }, { activity: { kind: 'sleeping' } }, { activity: { kind: 'fetchingWater' } }]);
    expect(counts).toMatchObject({ woodcutting: 2, hauling: 1, water: 1, farming: 0, building: 0 });
    expect(ACTIVITY_JOB.sleeping).toBeUndefined();
  });

  it('steps the level within 0..3', () => {
    expect(stepLevel(2, 1)).toBe(3);
    expect(stepLevel(3, 1)).toBe(3);
    expect(stepLevel(0, -1)).toBe(0);
    expect(stepLevel(1, -1)).toBe(0);
  });
});

describe('decision text', () => {
  const base = { eventId: 1, hoursLeft: 9, windowHours: 12 } as const;

  it('reads the goods of a typed trader payload', () => {
    expect(readSide({ giveWood: 30, getFood: 25 }, 'give')).toEqual([{ resource: 'wood', amount: 30 }]);
    expect(readSide({ giveWood: 30, giveStone: 10, getTools: 4 }, 'give')).toEqual([
      { resource: 'wood', amount: 30 },
      { resource: 'stone', amount: 10 },
    ]);
    expect(readSide({ giveWood: 30, getFood: 25 }, 'get')).toEqual([{ resource: 'food', amount: 25 }]);
    expect(readSide({}, 'give')).toEqual([]);
  });

  it('describes each decision kind from its payload', () => {
    const trade = describeDecision({ ...base, kind: 'traderVisit', payload: { giveWood: 30, getFood: 25 } }, null);
    expect(trade).toMatchObject({ title: 'Traveling Trader', acceptLabel: 'Trade' });
    expect(trade.body).toBe('A traveling trader pulls up at the town center: 30 wood for 25 food?');
    expect(trade.acceptNote).toBe('Swap 30 wood for 25 food right away.');
    expect(describeDecision({ ...base, kind: 'traderVisit', payload: { giveWood: 30, getFood: 25 } }, 'Custom message').body).toBe('Custom message');

    const two = describeDecision({ ...base, kind: 'wanderer', payload: { count: 2, freeBeds: 1 } }, null);
    expect(two.body).toBe('2 wanderers ask to join. There is 1 free bed, not enough for everyone. Anyone without a bed sleeps outdoors.');
    expect(describeDecision({ ...base, kind: 'wanderer', payload: { count: 1, freeBeds: 0 } }, null).body).toMatch(/^A wanderer asks to join\. There are no free beds/);

    const fest = describeDecision({ ...base, kind: 'harvestFestival', payload: { foodCost: 12 } }, null);
    expect(fest.acceptNote).toMatch(/Costs 12 food/);
    expect(fest.body).toContain('costs 12 food');
  });

  it('formats countdowns', () => {
    expect(formatCountdown(11.2)).toBe('12 h');
    expect(formatCountdown(0.5)).toBe('30 min');
    expect(formatCountdown(0)).toBe('1 min');
    expect(realSecondsLeft(12)).toBe(90);
  });
});

describe('log view', () => {
  const entry = (id: number, severity: LogEntry['severity']): LogEntry => ({ id, tick: id, day: 1, timeOfDay: 6, severity, message: `m${id}`, settlerId: null, buildingId: null, tile: null });
  const log = [entry(1, 'info'), entry(2, 'danger'), entry(3, 'good'), entry(4, 'danger')];

  it('shows the newest first and filters by severity without mutating', () => {
    expect(filterLog(log, 'all').map((e) => e.id)).toEqual([4, 3, 2, 1]);
    expect(filterLog(log, 'danger').map((e) => e.id)).toEqual([4, 2]);
    expect(log.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });

  it('counts unread entries and treats a reset log as read', () => {
    expect(unreadCount(log, null)).toBe(0);
    expect(unreadCount(log, 2)).toBe(2);
    expect(unreadCount(log, 4)).toBe(0);
    expect(unreadCount(log, 99)).toBe(0);
    expect(unreadCount([], 0)).toBe(0);
  });

  it('formats remaining hours', () => {
    expect(formatHoursRemaining(36)).toBe('1 d 12 h left');
    expect(formatHoursRemaining(5.2)).toBe('6 h left');
  });
});

describe('statistics series', () => {
  const sample = (i: number, wood: number, pop: number): HistorySample => ({
    tick: i,
    day: 1,
    timeOfDay: i,
    stock: { wood, stone: 0, food: 0, water: 0, tools: 0 },
    population: pop,
  });
  const history = [sample(0, 10, 5), sample(1, 30, 5), sample(2, 20, 6)];

  it('extracts series with min, max and change', () => {
    expect(seriesFor(history, 'wood')).toMatchObject({ values: [10, 30, 20], min: 10, max: 30, last: 20, delta: 10 });
    expect(seriesFor(history, 'population')).toMatchObject({ last: 6, delta: 1 });
    expect(seriesFor([], 'wood')).toMatchObject({ values: [], last: 0, delta: 0 });
  });

  it('draws sparklines inside the box and flat series at mid height', () => {
    const pts = sparklinePoints([10, 30, 20], 100, 40, 2).split(' ').map((p) => p.split(',').map(Number));
    expect(pts).toHaveLength(3);
    expect(pts[0]![0]).toBe(2);
    expect(pts[2]![0]).toBe(98);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(2);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(y).toBeLessThanOrEqual(38);
    }
    expect(sparklinePoints([5, 5, 5], 100, 40, 2, false)).toMatch(/,20\.0/);
    // Stock charts start at zero, so a constant series sits at the top.
    expect(sparklinePoints([5, 5, 5], 100, 40)).toMatch(/,2\.0/);
    expect(sparklinePoints([], 100, 40)).toBe('');
  });

  it('captions the span', () => {
    expect(spanLabel(1)).toBe('Not enough data yet');
    expect(spanLabel(13)).toBe('Last 12 h');
    expect(spanLabel(49)).toBe('Last 2 days');
    expect(spanLabel(37)).toBe('Last 1.5 days');
  });
});

describe('production text is derived from the building definitions', () => {
  it('uses the recipe numbers, not hand-written strings', () => {
    const farm = BUILDING_DEFS.farm.production!;
    expect(productionText(BUILDING_DEFS.farm)).toBe(`Food: ${farm.amount / farm.cycleHours} per worker-hour`);
    expect(productionText(BUILDING_DEFS.well)).toBe('Water: 2 per worker-hour');
    expect(productionText(BUILDING_DEFS.workshop)).toBe('Tools: 1 per 3 worker-hours (uses 3 wood, 2 stone)');
    expect(productionText(BUILDING_DEFS.lumberCamp)).toBe(`Fells trees within ${BUILDING_DEFS.lumberCamp.workRadius} tiles for wood`);
    expect(productionText(BUILDING_DEFS.house)).toBeNull();
  });
});

describe('sim-backed definitions', () => {
  it('has a written label for every moodlet the sim defines', () => {
    for (const id of Object.keys(MOODLETS)) expect(hasMoodletLabel(id), id).toBe(true);
  });

  it('derives unlock names from the building definitions and strips them from the hint', () => {
    expect(OBJECTIVE_LIST.find((o) => o.id === 'foundations')).toMatchObject({ unlocks: 'Storage' });
    expect(OBJECTIVE_LIST.find((o) => o.id === 'foundations')!.hint).not.toMatch(/Unlocks/);
    expect(OBJECTIVE_LIST.find((o) => o.id === 'timber')!.unlocks).toBe('Workshop');
  });
});
