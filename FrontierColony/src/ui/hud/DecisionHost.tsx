import { useGameController } from '../../game';
import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { describeDecision, formatCountdown, realSecondsLeft } from '../lib/eventInfo';

/**
 * Pending decisions (trader, wanderers, festival), shown one at a time as a card in the middle of the
 * screen. The map stays visible and usable around it; the rest wait in a queue.
 */
export function DecisionHost() {
  const decisions = useUiStore((s) => s.snapshot?.pendingDecisions);
  const log = useUiStore((s) => s.snapshot?.recentLog);
  const speed = useUiStore((s) => s.speed);
  const controller = useGameController();
  if (!decisions || decisions.length === 0) return null;
  const current = decisions[0]!;
  const message = log?.find((l) => l.id === current.eventId)?.message ?? null;
  const view = describeDecision(current, message);
  const fraction = Math.max(0, Math.min(1, current.hoursLeft / Math.max(0.001, current.windowHours)));
  const seconds = realSecondsLeft(current.hoursLeft) / speed;
  const resolve = (accept: boolean) => {
    controller.dispatch({ type: 'resolveEvent', eventId: current.eventId, accept });
  };

  return (
    <div className="decision glass" role="alertdialog" aria-labelledby="decision-title" aria-describedby="decision-body" data-testid="decision" key={current.eventId}>
      <div className="decision__head">
        <Icon name="events" size={18} className="decision__icon" />
        <h2 id="decision-title" className="decision__title" data-testid="decision-title">
          {view.title}
        </h2>
        {decisions.length > 1 && (
          <span className="decision__queue" data-testid="decision-queue" title="More decisions are waiting">
            1 of {decisions.length}
          </span>
        )}
      </div>
      <p id="decision-body" className="decision__body">
        {view.body}
      </p>
      <div className="decision__timer" title={`About ${Math.max(1, Math.round(seconds))} s of real time at the current speed. When it runs out the offer is declined.`}>
        <span className="progress progress--thin" aria-hidden="true">
          <span style={{ width: `${fraction * 100}%` }} />
        </span>
        <span className="decision__time" data-testid="decision-countdown">
          {formatCountdown(current.hoursLeft)} left
        </span>
      </div>
      <div className="decision__choices">
        <button type="button" className="btn primary decision__btn" onClick={() => resolve(true)} data-testid="decision-accept" data-autofocus>
          <span>{view.acceptLabel}</span>
          <span className="decision__note">{view.acceptNote}</span>
        </button>
        <button type="button" className="btn decision__btn" onClick={() => resolve(false)} data-testid="decision-decline">
          <span>{view.declineLabel}</span>
          <span className="decision__note">{view.declineNote}</span>
        </button>
      </div>
    </div>
  );
}
