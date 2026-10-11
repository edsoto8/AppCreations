import { useEffect, useRef, useState } from 'react';
import { DIFFICULTIES, MAP_PRESETS, MAP_SIZES, type Difficulty, type MapPreset, type MapSize } from '../../sim';
import { Icon } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import {
  DIFFICULTY_INFO,
  MAX_COLONY_NAME,
  MAX_SEED_LENGTH,
  PRESET_INFO,
  SIZE_INFO,
  draftToOptions,
  type NewGameDraft,
} from '../lib/newGameOptions';
import { randomSeed } from '../lib/seed';
import { useGameFlow } from '../lib/useGameFlow';
import { PresetArt } from './PresetArt';
import { RadioCards } from './RadioCards';

/** The New Game screen: colony name, seed, map preset, size and difficulty. */
export function NewGameForm({ onBack }: { onBack: () => void }) {
  const flow = useGameFlow();
  const [draft, setDraft] = useState<NewGameDraft>(() => ({
    colonyName: 'New Hope',
    seed: randomSeed(),
    preset: 'continent',
    mapSize: 'small',
    difficulty: 'normal',
  }));
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const set = <K extends keyof NewGameDraft>(key: K, value: NewGameDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const start = () => {
    if (starting) return;
    setStarting(true);
    // Let the "Founding..." state paint before the (synchronous) world generation blocks the thread.
    timer.current = window.setTimeout(() => flow.startNewGame(draftToOptions(draft, randomSeed)), 60);
  };

  return (
    <form
      className="new-game"
      data-testid="new-game-form"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <div className="new-game__columns">
        <div className="new-game__col">
          <label className="field">
            <span className="field__label">Colony name</span>
            <input
              className="input"
              type="text"
              value={draft.colonyName}
              maxLength={MAX_COLONY_NAME}
              placeholder="New Hope"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set('colonyName', e.target.value)}
              data-testid="new-game-name"
              data-autofocus
            />
          </label>

          <div className="field">
            <label className="field__label" htmlFor="seed-input">
              Map seed
            </label>
            <div className="input-row">
              <input
                id="seed-input"
                className="input input--mono"
                type="text"
                value={draft.seed}
                maxLength={MAX_SEED_LENGTH}
                placeholder="Any text"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => set('seed', e.target.value)}
                data-testid="new-game-seed"
              />
              <Tooltip content="Pick a random seed" side="top">
                <button type="button" className="btn icon-only" onClick={() => set('seed', randomSeed())} aria-label="Randomize seed" data-testid="new-game-randomize">
                  <Icon name="dice" size={20} />
                </button>
              </Tooltip>
            </div>
            <span className="field__hint">The same seed and settings always make the same world.</span>
          </div>

          <RadioCards<MapSize>
            name="map-size"
            legend="Map size"
            value={draft.mapSize}
            onChange={(v) => set('mapSize', v)}
            testIdPrefix="size"
            options={MAP_SIZES.map((s) => ({ value: s, label: SIZE_INFO[s].name }))}
          />
          <p className="field__hint">{SIZE_INFO[draft.mapSize].blurb}</p>

          <RadioCards<Difficulty>
            name="difficulty"
            legend="Difficulty"
            value={draft.difficulty}
            onChange={(v) => set('difficulty', v)}
            testIdPrefix="difficulty"
            options={DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_INFO[d].name }))}
          />
          <p className="field__hint">{DIFFICULTY_INFO[draft.difficulty].blurb}</p>
        </div>

        <div className="new-game__col">
          <RadioCards<MapPreset>
            name="preset"
            legend="Landscape"
            variant="cards"
            value={draft.preset}
            onChange={(v) => set('preset', v)}
            testIdPrefix="preset"
            options={MAP_PRESETS.map((p) => ({
              value: p,
              label: PRESET_INFO[p].name,
              content: <PresetArt preset={p} />,
            }))}
          />
          <p className="preset-desc">
            <strong>{PRESET_INFO[draft.preset].traits}.</strong> {PRESET_INFO[draft.preset].blurb}
          </p>
        </div>
      </div>

      <div className="new-game__actions">
        <button type="button" className="btn ghost" onClick={onBack} disabled={starting} data-testid="new-game-back">
          <Icon name="back" size={16} /> Back
        </button>
        <button type="submit" className="btn primary big" disabled={starting} data-testid="new-game-start">
          {starting ? 'Founding colony...' : 'Found the colony'}
          {!starting && <Icon name="chevron" size={16} />}
        </button>
      </div>
    </form>
  );
}
