import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import type { BuildingType } from '../../sim';
import { useUiStore } from '../../store';
import { placeTooltip } from '../components/Tooltip';
import { TOUR_STEPS, clampStep, isStepDone } from '../lib/tour';
import { useUiScale } from '../lib/usePrefsSync';

/**
 * First-game coach marks. Starts once for a new player (never under `?quickstart`, so tests are not
 * covered by it), highlights the control each step talks about, moves on by itself when the player does
 * what is asked, and can be skipped at any time. Finishing or skipping saves `tutorialDone`.
 */
export function TourHost() {
  const { step, screen, started, done, tick } = useUiStore(
    useShallow((s) => ({ step: s.tourStep, screen: s.screen, started: s.gameStarted, done: s.prefs.tutorialDone, tick: s.snapshot?.tick ?? -1 })),
  );
  const startTour = useUiStore((s) => s.startTour);

  // Offer the tour once, early in a game the player started themselves.
  useEffect(() => {
    if (step !== null || done || screen !== 'playing' || !started || tick < 0 || tick > 600) return;
    if (new URLSearchParams(window.location.search).has('quickstart')) return;
    startTour();
  }, [step, done, screen, started, tick, startTour]);

  if (step === null || screen !== 'playing') return null;
  return <TourCard index={clampStep(step)} />;
}

function TourCard({ index }: { index: number }) {
  const step = TOUR_STEPS[index]!;
  // Primitives only: a selector that builds new arrays on every call would loop forever.
  const types = useUiStore((s) => s.snapshot?.buildings.map((b) => b.type).join(',') ?? '');
  const openPanel = useUiStore((s) => s.openPanel);
  const selectionKind = useUiStore((s) => s.selection?.kind ?? null);
  const ctx = useMemo(
    () => ({ buildings: types ? (types.split(',') as BuildingType[]).map((type) => ({ type })) : [], openPanel, selectionKind }),
    [types, openPanel, selectionKind],
  );
  const setTourStep = useUiStore((s) => s.setTourStep);
  const endTour = useUiStore((s) => s.endTour);
  const scale = useUiScale();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const doneNow = isStepDone(step, ctx);
  const doneOnEntry = useRef<{ index: number; value: boolean } | null>(null);
  if (doneOnEntry.current?.index !== index) doneOnEntry.current = { index, value: doneNow };

  // Highlight the target control.
  useEffect(() => {
    if (!step.target) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    el?.classList.add('tour-highlight');
    return () => el?.classList.remove('tour-highlight');
  }, [step.target]);

  // Position next to the target, or centred.
  useLayoutEffect(() => {
    const place = () => {
      const card = ref.current;
      if (!card) return;
      const c = card.getBoundingClientRect();
      const target = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      if (!target) {
        setPos({ left: (window.innerWidth - c.width) / 2, top: Math.max(80, window.innerHeight * 0.22) });
        return;
      }
      const r = target.getBoundingClientRect();
      const p = placeTooltip({ left: r.left, top: r.top, width: r.width, height: r.height }, c.width, c.height, window.innerWidth, window.innerHeight, 'top');
      setPos({ left: p.left, top: p.top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [step.target, index, scale]);

  // Move on by itself shortly after the player did the thing (not if it was already true when the step opened).
  useEffect(() => {
    if (!doneNow || doneOnEntry.current?.value || index >= TOUR_STEPS.length - 1) return;
    const t = window.setTimeout(() => setTourStep(index + 1), 1400);
    return () => window.clearTimeout(t);
  }, [doneNow, index, setTourStep]);

  const last = index === TOUR_STEPS.length - 1;
  return createPortal(
    <div
      ref={ref}
      className="tour-card"
      role="dialog"
      aria-label="Tutorial"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden', transform: scale === 1 ? undefined : `scale(${scale})`, transformOrigin: '0 0' }}
      data-testid="tour"
    >
      <div className="tour-card__step">
        Step {index + 1} of {TOUR_STEPS.length}
      </div>
      <h2 className="tour-card__title">{step.title}</h2>
      <p className="tour-card__body">{step.body}</p>
      {doneNow && step.doneText && <p className="tour-card__done">{step.doneText}</p>}
      <div className="tour-card__dots" aria-hidden="true">
        {TOUR_STEPS.map((s, i) => (
          <span key={s.id} className={i === index ? 'is-current' : i < index ? 'is-past' : ''} />
        ))}
      </div>
      <div className="tour-card__actions">
        <button type="button" className="btn small ghost" onClick={endTour} data-testid="tour-skip">
          {last ? 'Close' : 'Skip tour'}
        </button>
        <span className="tour-card__spacer" />
        {index > 0 && (
          <button type="button" className="btn small" onClick={() => setTourStep(index - 1)} data-testid="tour-back">
            Back
          </button>
        )}
        <button type="button" className="btn small primary" onClick={() => (last ? endTour() : setTourStep(index + 1))} data-testid="tour-next" data-autofocus>
          {last ? 'Start playing' : index === 0 ? 'Begin' : 'Next'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
