/** Titles and plain-language effects of random events, plus decision-card text. Pure. */
import { REAL_SECONDS_PER_GAME_DAY, RESOURCE_TYPES, type PendingDecision, type RandomEventKind, type ResourceType, type TraderPayload } from '../../sim';
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

type Side = { resource: ResourceType; amount: number }[];

/** The goods a trader asks for (`give`) or offers (`get`), from the typed payload keys (`giveWood`, `getFood`, ...). */
export function readSide(payload: TraderPayload, side: 'give' | 'get'): Side {
  const out: Side = [];
  for (const resource of RESOURCE_TYPES) {
    const key = `${side}${resource.charAt(0).toUpperCase()}${resource.slice(1)}` as keyof TraderPayload;
    const amount = payload[key];
    if (typeof amount === 'number' && amount > 0) out.push({ resource, amount });
  }
  return out;
}

const amountsText = (list: Side) => list.map((x) => `${x.amount} ${RESOURCE_LABEL[x.resource].toLowerCase()}`).join(' and ');

/** Text for a pending decision card. `message` is the log line the sim wrote for it, when there is one. */
export function describeDecision(decision: PendingDecision, message: string | null): DecisionView {
  const title = eventTitle(decision.kind);
  switch (decision.kind) {
    case 'traderVisit': {
      const give = readSide(decision.payload, 'give');
      const get = readSide(decision.payload, 'get');
      const swap = `${amountsText(give)} for ${amountsText(get)}`;
      return {
        title,
        body: message ?? `A traveling trader pulls up at the town center: ${swap}?`,
        acceptLabel: 'Trade',
        declineLabel: 'No thanks',
        acceptNote: `Swap ${swap} right away.`,
        declineNote: 'The trader moves on.',
      };
    }
    case 'wanderer': {
      const { count, freeBeds } = decision.payload;
      const who = count === 1 ? 'A wanderer asks' : `${count} wanderers ask`;
      return {
        title,
        body: message ?? `${who} to join. ${freeBeds > 0 ? `There ${freeBeds === 1 ? 'is 1 free bed' : `are ${freeBeds} free beds`}, not enough for everyone.` : 'There are no free beds.'} Anyone without a bed sleeps outdoors.`,
        acceptLabel: 'Welcome them',
        declineLabel: 'Turn away',
        acceptNote: 'They join and sleep by the campfire until a bed is free, unhappy and cold in winter.',
        declineNote: 'They walk on.',
      };
    }
    case 'harvestFestival': {
      const { foodCost } = decision.payload;
      return {
        title,
        body: message ?? `The harvest is in! Hold a festival? (costs ${foodCost} food)`,
        acceptLabel: 'Hold the festival',
        declineLabel: 'Not this year',
        acceptNote: `Costs ${foodCost} food. Everyone celebrates for a few hours, then is happier for two days.`,
        declineNote: 'Work goes on as usual.',
      };
    }
  }
}

/** Real seconds left at 1x for an in-game hour count. */
export function realSecondsLeft(hoursLeft: number): number {
  return (Math.max(0, hoursLeft) * REAL_SECONDS_PER_GAME_DAY) / 24;
}

export function formatCountdown(hoursLeft: number): string {
  const h = Math.max(0, hoursLeft);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${Math.ceil(h)} h`;
}
