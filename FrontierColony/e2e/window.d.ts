// Minimal typing of the debug handle that src/main.tsx installs (the e2e project does not compile src/).
export {};

declare global {
  interface Window {
    __frontierColony?: {
      getState(): { time: { tick: number; day: number; timeOfDay: number }; settlers: unknown[] };
      advanceTicks(n: number): void;
    };
  }
}
