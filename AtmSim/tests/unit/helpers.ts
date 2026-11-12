import { EventBus } from '../../src/core/events';
import { InstantClock } from '../../src/core/clock';
import type { AtmInput, CustomerPort, KeypadKey, MechanismDriver, SimClock } from '../../src/core/types';
import { AtmSystem } from '../../src/app/AtmSystem';

/** Mechanism driver that animates nothing; records call names for assertions. */
export class NoopMech implements MechanismDriver {
  calls: string[] = [];
  private rec(name: string) {
    this.calls.push(name);
    return Promise.resolve();
  }
  cardIn() { return this.rec('cardIn'); }
  cardEject() { return this.rec('cardEject'); }
  cardRetain() { return this.rec('cardRetain'); }
  pickNote() { return this.rec('pickNote'); }
  validateNote() { return this.rec('validateNote'); }
  divertToReject() { return this.rec('divertToReject'); }
  stackNote() { return this.rec('stackNote'); }
  jamNote() { return this.rec('jamNote'); }
  presentBundle() { return this.rec('presentBundle'); }
  bundleCollected() { return this.rec('bundleCollected'); }
  retractBundle() { return this.rec('retractBundle'); }
  purge() { return this.rec('purge'); }
  printReceipt() { return this.rec('printReceipt'); }
  depositIntake() { return this.rec('depositIntake'); }
  depositStore() { return this.rec('depositStore'); }
  depositReturn() { return this.rec('depositReturn'); }
  setComponentAlert(): void {
    this.calls.push('setComponentAlert');
  }
}

/** Scriptable customer: collects cash / takes the card immediately, or never (waits for the timeout). */
export class ScriptedCustomer implements CustomerPort {
  cash: 'collect' | 'never' = 'collect';
  card: 'take' | 'never' = 'take';
  constructor(private readonly clock: SimClock) {}
  async awaitCashCollection(timeoutMs: number): Promise<'collected' | 'timeout'> {
    if (this.cash === 'collect') {
      await this.clock.wait(1_500);
      return 'collected';
    }
    await this.clock.wait(timeoutMs);
    return 'timeout';
  }
  async awaitCardTaken(timeoutMs: number): Promise<'taken' | 'timeout'> {
    if (this.card === 'take') {
      await this.clock.wait(1_000);
      return 'taken';
    }
    await this.clock.wait(timeoutMs);
    return 'timeout';
  }
}

export interface TestRig {
  sys: AtmSystem;
  bus: EventBus;
  clock: InstantClock;
  mech: NoopMech;
  customer: ScriptedCustomer;
  /** Send an input and wait for the resulting flow to finish. */
  send(i: AtmInput): Promise<void>;
  key(k: KeypadKey): Promise<void>;
  keys(s: string): Promise<void>;
  touch(id: string): Promise<void>;
  card(cardId: string, method?: 'chip' | 'contactless'): Promise<void>;
  /** card → PIN → MAIN_MENU */
  login(cardId?: string, pin?: string): Promise<void>;
  screenId(): string;
  buttons(): string[];
}

export function makeRig(seed?: number): TestRig {
  const bus = new EventBus();
  const clock = new InstantClock();
  const mech = new NoopMech();
  const customer = new ScriptedCustomer(clock);
  const sys = new AtmSystem({ bus, clock, mech, customer, ...(seed !== undefined ? { seed } : {}) });
  const send = async (i: AtmInput) => {
    sys.app.input(i);
    await sys.app.settle();
  };
  const rig: TestRig = {
    sys,
    bus,
    clock,
    mech,
    customer,
    send,
    key: (k) => send({ kind: 'key', key: k }),
    keys: async (s) => {
      for (const ch of s) await send({ kind: 'key', key: ch as KeypadKey });
    },
    touch: (id) => send({ kind: 'touch', target: id }),
    card: (cardId, method = 'chip') => send({ kind: 'card', cardId, method }),
    login: async (cardId = 'card-alex', pin) => {
      await rig.card(cardId);
      await rig.keys(pin ?? sys.ledger.cards.get(cardId)!.demoPin);
      await rig.key('ENTER');
    },
    screenId: () => sys.app.screen.id,
    buttons: () => sys.app.screen.buttons.map((b) => b.id),
  };
  return rig;
}

/** Customer wealth (ledger + wallet) in cents. */
export function wealth(sys: AtmSystem): number {
  return sys.ledger.customerWealthCents() + sys.inventory.valueAt('customer');
}

/** Total value of every note in every location (must never change). */
export function allNotesValue(sys: AtmSystem): number {
  return sys.inventory.notes.reduce((s, n) => s + n.denom * 100, 0);
}
