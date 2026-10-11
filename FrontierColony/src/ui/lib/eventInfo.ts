/** Titles and plain-language effects of random events, plus decision-card text. Pure. */
import { RESOURCE_TYPES, type RandomEventKind, type ResourceType } from '../../sim';
import { RESOURCE_LABEL } from './tooltipText';

export const EVENT_INFO: Record<RandomEventKind, { title: string; effect: string }> = {
  wanderer: { title: 'Wanderers', effect: 'Travelers ask to join the colony.' },
  bountifulHarvest: { title: 'Bountiful Harvest', effect: 'Farms produce 50% more.' },
  cropBlight: { title: 'Crop Blight', effect: 'One farm yields nothing.' },
  drought: { title: 'Drought', effect: 'No rain, farms and wells slow down, wildfires are possible.' },
  sickness: { title: 'Fever', effect: 'Sick settlers lose health and work more slowly.' },
  wildfire: { title: 'Wildfire', effect: 'Forest burns and buildings nearby are damaged.' },
  toolsBreak: { title: 'Rusted Tools', effect: 'Some tools in the stockpile are lost.' },
  coldSnap: { title: 'Cold Snap', effect: 'Settlers tire faster and the cold hurts at night. Wells slow down.' },
  traderVisit: { title: 'Traveling Trader', effect: 'A trader offers a swap of goods.' },
  wolves: { title: 'Wolves', effect: 'Wolves threaten settlers far from the town center.' },
  stormDamage: { title: 'Storm Damage', effect: 'A building was damaged and needs repairs.' },
  richVein: { title: 'Rich Vein', effect: 'Miners struck a rich seam.' },
  supplyCache: { title: 'Abandoned Wagon', effect: 'Settlers found supplies.' },
  harvestFestival: { title: 'Harvest Festival', effect: 'Everyone gathers to celebrate, then works with a lift in spirits.' },
};

export function eventTitle(kind: string): string {
  return (EVENT_INFO as Record<string, { title: string }>)[kind]?.title ?? kind.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

export type Payload = Record<string, number | string | boolean | null>;

export interface DecisionView {
  title: string;
  /** One or two sentences describing the offer. */
  body: string;
  acceptLabel: string;
  declineLabel: string;
  /** What each choice does. */
  acceptNote: string;
  declineNote: string;
}

const isResource = (v: unknown): v is ResourceType => typeof v === 'string' && (RESOURCE_TYPES as readonly string[]).includes(v);

/** Read "give 30 wood" from a payload in any of the plausible shapes. Returns null when absent. */
export function readSide(payload: Payload, side: 'give' | 'get'): { resource: ResourceType; amount: number }[] | null {
  const out: { resource: ResourceType; amount: number }[] = [];
  // Shape A: giveResource / giveAmount
  const r = payload[`${side}Resource`] ?? payload[`${side}Type`];
  const a = payload[`${side}Amount`];
  if (isResource(r) && typeof a === 'number') out.push({ resource: r, amount: a });
  // Shape B: giveWood: 30, give_wood: 30, getFood: 25
  for (const key of Object.keys(payload)) {
    const m = new RegExp(`^${side}[_ ]?(\\w+)$`, 'i').exec(key);
    const v = payload[key];
    if (!m || typeof v !== 'number') continue;
    const res = (m[1] ?? '').toLowerCase();
    if (isResource(res) && !out.some((o) => o.resource === res)) out.push({ resource: res, amount: v });
  }
  return out.length ? out : null;
}

const amountsText = (list: { resource: ResourceType; amount: number }[]) =>
  list.map((x) => `${x.amount} ${RESOURCE_LABEL[x.resource].toLowerCase()}`).join(' and ');

const num = (p: Payload, ...keys: string[]): number | null => {
  for (const k of keys) if (typeof p[k] === 'number') return p[k] as number;
  return null;
};

/** Text for a pending decision card, tolerant of payload shapes the sim may use. */
export function describeDecision(kind: string, payload: Payload, message: string | null): DecisionView {
  const title = eventTitle(kind);
  if (kind === 'traderVisit') {
    const give = readSide(payload, 'give');
    const get = readSide(payload, 'get');
    return {
      title,
      body: message ?? (give && get ? `A traveling trader pulls up at the town center: ${amountsText(give)} for ${amountsText(get)}?` : 'A traveling trader offers a swap of goods.'),
      acceptLabel: 'Trade',
      declineLabel: 'No thanks',
      acceptNote: give && get ? `Swap ${amountsText(give)} for ${amountsText(get)} right away.` : 'The swap happens right away.',
      declineNote: 'The trader moves on.',
    };
  }
  if (kind === 'wanderer') {
    const n = num(payload, 'count', 'size', 'n', 'group', 'settlers');
    const who = n === null ? 'Wanderers' : n === 1 ? 'A wanderer' : `${n} wanderers`;
    return {
      title,
      body: message ?? `${who} ask to join. There are no free beds; they would sleep outdoors.`,
      acceptLabel: 'Welcome them',
      declineLabel: 'Turn away',
      acceptNote: 'They join and sleep by the campfire until a bed is free, unhappy and cold in winter.',
      declineNote: 'They walk on.',
    };
  }
  if (kind === 'harvestFestival') {
    const cost = num(payload, 'foodCost', 'cost', 'food', 'amount');
    return {
      title,
      body: message ?? `The harvest is in! Hold a festival?${cost !== null ? ` (costs ${cost} food)` : ''}`,
      acceptLabel: 'Hold the festival',
      declineLabel: 'Not this year',
      acceptNote: `${cost !== null ? `Costs ${cost} food. ` : ''}Everyone celebrates for a few hours, then is happier for two days.`,
      declineNote: 'Work goes on as usual.',
    };
  }
  return { title, body: message ?? 'A decision is waiting for you.', acceptLabel: 'Accept', declineLabel: 'Decline', acceptNote: 'Go ahead.', declineNote: 'Pass.' };
}

/** Real seconds left at 1x for an in-game hour count (one game hour = 7.5 s; GAME_DESIGN §2). */
export function realSecondsLeft(hoursLeft: number): number {
  return Math.max(0, hoursLeft) * 7.5;
}

export function formatCountdown(hoursLeft: number): string {
  const h = Math.max(0, hoursLeft);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${Math.ceil(h)} h`;
}
