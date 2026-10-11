import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameController } from '../../game';
import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { useDialogFocus } from '../components/Panel';
import { pluralize } from '../lib/format';
import { useGameFlow } from '../lib/useGameFlow';

function Stat({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="stat-tile" data-testid={testId}>
      <span className="stat-tile__value">{value}</span>
      <span className="stat-tile__label">{label}</span>
    </div>
  );
}

/** Full-screen end card: the colony fell (lost) or reached its goal (won, with a sandbox option). */
export function GameOverOverlay() {
  const data = useUiStore(
    useShallow((s) => {
      const snap = s.snapshot;
      if (!snap || snap.outcome.status === 'playing') return null;
      return {
        status: snap.outcome.status,
        reason: snap.outcome.reason,
        colony: snap.colonyName,
        day: snap.day,
        stats: snap.stats,
      };
    }),
  );
  if (!data) return null;
  return <EndCard {...data} />;
}

interface EndCardProps {
  status: 'won' | 'lost';
  reason: string | null;
  colony: string;
  day: number;
  stats: { births: number; arrivals: number; deaths: number; peakPopulation: number; buildingsCompleted: number };
}

function EndCard({ status, reason, colony, day, stats }: EndCardProps) {
  const controller = useGameController();
  const flow = useGameFlow();
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  const won = status === 'won';
  const days = Math.max(1, day);
  const fallbackReason = won ? `${colony} is a thriving frontier colony.` : `The frontier has claimed ${colony}.`;

  const keepPlaying = () => {
    const result = controller.dispatch({ type: 'acknowledgeVictory' });
    if (result.ok) controller.setPaused(false);
  };

  return (
    <div className={`endcard-scrim endcard-scrim--${status}`} data-testid="gameover">
      <div ref={ref} className="endcard glass" role="alertdialog" aria-modal="true" aria-labelledby="endcard-title" tabIndex={-1} data-testid={won ? 'victory' : 'gameover-lost'}>
        <div className="endcard__emblem" aria-hidden="true">
          <Icon name={won ? 'trophy' : 'flag'} size={40} />
        </div>
        <h2 id="endcard-title" className="endcard__title">
          {won ? 'Thriving Frontier' : 'The Frontier Claims Its Own'}
        </h2>
        <p className="endcard__reason" data-testid="gameover-reason">
          {reason ?? fallbackReason}
        </p>
        <p className="endcard__days">
          {won ? 'Reached in' : 'Lasted'} <strong>{pluralize(days, 'day')}</strong>
        </p>
        <div className="endcard__stats">
          <Stat label="Peak settlers" value={stats.peakPopulation} testId="stat-peak" />
          <Stat label="Buildings" value={stats.buildingsCompleted} testId="stat-buildings" />
          <Stat label="Born" value={stats.births} testId="stat-births" />
          <Stat label="Arrived" value={stats.arrivals} testId="stat-arrivals" />
          <Stat label="Lost" value={stats.deaths} testId="stat-deaths" />
        </div>
        <div className="endcard__actions">
          {won ? (
            <>
              <button type="button" className="btn primary big" onClick={keepPlaying} data-testid="victory-continue" data-autofocus>
                Keep playing (sandbox)
              </button>
              <button type="button" className="btn" onClick={() => flow.toMainMenu()} data-testid="gameover-menu">
                Main menu
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn primary big" onClick={() => flow.toMainMenu('newGame')} data-testid="gameover-new" data-autofocus>
                New game
              </button>
              <button type="button" className="btn" onClick={() => flow.toMainMenu('load')} data-testid="gameover-load">
                Load game
              </button>
              <button type="button" className="btn ghost" onClick={() => flow.toMainMenu()} data-testid="gameover-menu">
                Main menu
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
