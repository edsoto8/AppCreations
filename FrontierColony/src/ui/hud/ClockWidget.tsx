import { useShallow } from 'zustand/react/shallow';
import { useUiStore } from '../../store';
import { Icon, IconGlyph, type IconName } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import {
  DAYS_PER_SEASON,
  PHASE_LABEL,
  SEASON_LABEL,
  WEATHER_EFFECT,
  WEATHER_LABEL,
  dayPhase,
  formatClock,
  seasonInfo,
  skyPosition,
} from '../lib/format';

/** Arc with a sun or moon travelling along it. */
function SkyDial({ timeOfDay }: { timeOfDay: number }) {
  const sky = skyPosition(timeOfDay);
  const angle = Math.PI * (1 - sky.t);
  const cx = 24 + Math.cos(angle) * 19;
  const cy = 25 - Math.sin(angle) * 19;
  const night = sky.body === 'moon';
  return (
    <svg className={`sky-dial ${night ? 'sky-dial--night' : ''}`} viewBox="0 0 48 30" aria-hidden="true">
      <defs>
        <clipPath id="sky-clip">
          <rect x="0" y="0" width="48" height="25.6" />
        </clipPath>
      </defs>
      <path d="M5 25 A19 19 0 0 1 43 25" className="sky-dial__arc" />
      <line x1="2" y1="25.4" x2="46" y2="25.4" className="sky-dial__horizon" />
      <g clipPath="url(#sky-clip)">
        <g transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}>
          <circle r="7" className={night ? 'sky-dial__halo sky-dial__halo--moon' : 'sky-dial__halo'} />
          <g transform="translate(-5.5 -5.5) scale(0.4583)">
            <IconGlyph name={sky.body} />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** Day / season / clock / weather. */
export function ClockWidget() {
  const data = useUiStore(
    useShallow((s) => {
      const snap = s.snapshot;
      if (!snap) return null;
      return {
        day: snap.day,
        // Minute resolution is plenty for display and keeps re-renders at the clock's actual pace.
        minute: Math.floor(snap.timeOfDay * 60),
        weather: snap.weather.current,
        season: snap.season,
      };
    }),
  );
  if (!data) return null;
  const timeOfDay = data.minute / 60;
  const phase = dayPhase(timeOfDay);
  const info = seasonInfo(data.day);
  const phaseIcon: IconName = phase === 'dawn' ? 'sunrise' : phase === 'dusk' ? 'sunset' : phase === 'night' ? 'moon' : 'sun';

  const clockTip = (
    <>
      <p>
        {PHASE_LABEL[phase]}. {phase === 'night' ? 'Settlers sleep and outdoor work is slower.' : phase === 'day' ? 'Full light: settlers work at full speed.' : 'Light is fading or returning; work is a little slower.'}
      </p>
      <dl className="tt-stats">
        <dt>Season</dt>
        <dd>
          {SEASON_LABEL[info.season]}, day {info.dayInSeason} of {DAYS_PER_SEASON}
        </dd>
        <dt>Year</dt>
        <dd>{info.year}</dd>
        <dt>Next season</dt>
        <dd>{info.daysUntilNextSeason === 0 ? 'tomorrow' : `in ${info.daysUntilNextSeason} day${info.daysUntilNextSeason === 1 ? '' : 's'}`}</dd>
      </dl>
    </>
  );

  return (
    <div className="hud-group clock-widget">
      <Tooltip title={`Day ${data.day}`} content={clockTip} side="bottom">
        <div className="clock" tabIndex={0} role="group" aria-label={`Day ${data.day}, ${SEASON_LABEL[info.season]}, ${formatClock(timeOfDay)}, ${PHASE_LABEL[phase]}`}>
          <SkyDial timeOfDay={timeOfDay} />
          <div className="clock__text">
            <div className="clock__day" data-testid="clock">
              Day {data.day}
              <span className="clock__season">
                <Icon name={info.season} size={13} /> {SEASON_LABEL[info.season]}
              </span>
            </div>
            <div className="clock__time">
              <Icon name={phaseIcon} size={12} />
              <span className="clock__hhmm">{formatClock(timeOfDay)}</span>
              <span className="clock__phase">{PHASE_LABEL[phase]}</span>
            </div>
          </div>
        </div>
      </Tooltip>
      <Tooltip title={WEATHER_LABEL[data.weather]} content={WEATHER_EFFECT[data.weather]} side="bottom">
        <div className="weather" tabIndex={0} role="group" aria-label={`Weather: ${WEATHER_LABEL[data.weather]}`} data-testid="weather">
          <Icon name={data.weather} size={24} />
          <span className="weather__label">{WEATHER_LABEL[data.weather]}</span>
        </div>
      </Tooltip>
    </div>
  );
}
