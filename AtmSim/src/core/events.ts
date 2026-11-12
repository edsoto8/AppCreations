import type { SimEvents } from './types';

type Handler<T> = (payload: T) => void;

/** Minimal typed synchronous event bus. Handler errors are caught and logged so one bad listener can't break the sim. */
export class EventBus<E extends object = SimEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set!.delete(handler as Handler<never>);
    };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) {
      try {
        (h as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] handler for ${String(type)} failed`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
