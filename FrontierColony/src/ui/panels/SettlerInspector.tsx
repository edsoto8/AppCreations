import { useEffect, useState } from 'react';
import { SKILL_MAX, SKILL_TYPES, TRAIT_DEFS } from '../../sim';
import { useUiStore, type SettlerDetail } from '../../store';
import { useGameController } from '../../game';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { NeedBar } from '../components/NeedBar';
import { Panel } from '../components/Panel';
import { Tooltip } from '../components/Tooltip';
import { TOOL_DURABILITY_HOURS, xpToNext } from '../lib/balanceMirror';
import { RESOURCE_LABEL } from '../lib/tooltipText';
import {
  MOOD_EFFECT,
  MOOD_ICON,
  MOOD_LABEL,
  NEED_ORDER,
  SKILL_LABEL,
  SKILL_TOOLTIP,
  formatHoursLeft,
  formatSigned,
  moodBand,
  moodletLabel,
} from '../lib/settlerInfo';
import { pluralize } from '../lib/format';
import { useSelectedSettler } from '../lib/useSelectedDetail';

/** Right-side inspector for the selected settler. Updates live from the snapshot. */
export function SettlerInspector({ id }: { id: number }) {
  const settler = useSelectedSettler(id);
  const select = useUiStore((s) => s.select);
  if (!settler) return null;
  return (
    <Panel
      className="panel--inspector"
      title={settler.name}
      placement="right"
      width={350}
      onClose={() => select(null)}
      testId="settler-inspector"
      titleNode={<InspectorTitle settler={settler} />}
      actions={<FollowToggle key={id} settler={settler} />}
    >
      <SettlerBody settler={settler} />
    </Panel>
  );
}

function InspectorTitle({ settler }: { settler: SettlerDetail }) {
  const band = moodBand(settler.needs.happiness);
  return (
    <div className="inspector-title">
      <Avatar appearance={settler.appearance} size={46} title={settler.name} />
      <div className="inspector-title__text">
        <div className="inspector-title__name" data-testid="inspector-name">
          {settler.name}
        </div>
        <div className="inspector-title__sub">
          <Icon name={MOOD_ICON[band]} size={14} /> {MOOD_LABEL[band]} · joined day {settler.joinedDay}
        </div>
      </div>
    </div>
  );
}

/** Keeps the camera on the settler while on. Local state, so it resets when another settler is selected. */
function FollowToggle({ settler }: { settler: SettlerDetail }) {
  const controller = useGameController();
  const [follow, setFollow] = useState(false);
  const { x, y } = settler.pos;
  useEffect(() => {
    if (follow) controller.centerOn({ x, y });
  }, [follow, x, y, controller]);
  return (
    <Tooltip content={follow ? 'Camera is following. Click to stop.' : 'Keep the camera on this settler'} side="bottom">
      <button
        type="button"
        className={`btn small ${follow ? 'primary' : 'ghost'} icon-only`}
        aria-pressed={follow}
        aria-label="Follow settler"
        onClick={() => {
          if (!follow) controller.centerOn({ x, y });
          setFollow(!follow);
        }}
        data-testid="inspector-follow"
      >
        <Icon name="crosshair" size={16} />
      </button>
    </Tooltip>
  );
}

function SettlerBody({ settler }: { settler: SettlerDetail }) {
  const controller = useGameController();
  const buildings = useUiStore((s) => s.snapshot?.buildings);
  const select = useUiStore((s) => s.select);
  const band = moodBand(settler.needs.happiness);
  const goTo = (buildingId: number | null) => {
    const b = buildings?.find((x) => x.id === buildingId);
    if (!b) return;
    select({ kind: 'building', id: b.id });
    controller.centerOn({ x: b.origin.x + b.footprint.w / 2, y: b.origin.y + b.footprint.h / 2 });
  };
  const target = settler.activity.targetTile;
  const flags: string[] = [];
  if (settler.sick) flags.push(`Sick (${Math.ceil(settler.status.sickHoursLeft)} h left)`);
  if (settler.dehydrated) flags.push('Dehydrated');

  return (
    <div className="inspector" data-testid="settler-inspector-body">
      <section className="insp-section">
        <div className="activity" data-testid="inspector-activity">
          <span className="activity__label">{settler.activity.label}</span>
          {settler.activity.progress !== null && (
            <span className="progress progress--thin" aria-hidden="true">
              <span style={{ width: `${Math.round(settler.activity.progress * 100)}%` }} />
            </span>
          )}
          {target && (
            <button type="button" className="link-btn" onClick={() => controller.centerOn({ x: target.x + 0.5, y: target.y + 0.5 })}>
              <Icon name="crosshair" size={12} /> Tile {target.x}, {target.y}
            </button>
          )}
        </div>
        {flags.length > 0 && (
          <ul className="flag-list">
            {flags.map((f) => (
              <li key={f} className="flag flag--warn">
                <Icon name="warning" size={13} /> {f}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="insp-section">
        <h3 className="section-title">Needs</h3>
        <div className="needs-list">
          {NEED_ORDER.map((n) => (
            <NeedBar key={n} need={n} value={settler.needs[n]} resetKey={settler.id} />
          ))}
        </div>
      </section>

      <section className="insp-section">
        <h3 className="section-title">Mood</h3>
        <p className="muted insp-mood">
          <strong>{MOOD_LABEL[band]}.</strong> {MOOD_EFFECT[band]}
        </p>
        {settler.moodlets.length === 0 ? (
          <p className="muted">Nothing is affecting their mood right now.</p>
        ) : (
          <ul className="moodlets" data-testid="moodlets">
            {[...settler.moodlets]
              .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
              .map((m, i) => (
                <li key={`${m.id}-${i}`} className="moodlet">
                  <span className="moodlet__label">{moodletLabel(m.id)}</span>
                  <span className="moodlet__time">{formatHoursLeft(m.hoursLeft)}</span>
                  <span className={`moodlet__value ${m.value >= 0 ? 'is-pos' : 'is-neg'}`}>{formatSigned(m.value)}</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="insp-section">
        <h3 className="section-title">Skills</h3>
        <ul className="skills">
          {SKILL_TYPES.map((k) => {
            const level = settler.skills[k];
            const need = xpToNext(level);
            const xp = settler.xp[k] ?? 0;
            const maxed = level >= SKILL_MAX;
            return (
              <li key={k} className="skill">
                <Tooltip title={SKILL_LABEL[k]} content={`${SKILL_TOOLTIP[k]} Level ${level} of ${SKILL_MAX}.${maxed ? '' : ` ${Math.floor(xp)} / ${need} XP to the next level.`}`} side="left">
                  <div className="skill__row" tabIndex={0}>
                    <span className="skill__name">{SKILL_LABEL[k]}</span>
                    <span className="pips" aria-label={`Level ${level} of ${SKILL_MAX}`}>
                      {Array.from({ length: SKILL_MAX }, (_, i) => (
                        <span key={i} className={i < level ? 'pip is-on' : 'pip'} />
                      ))}
                    </span>
                    <span className="skill__level">{level}</span>
                    <span className="progress progress--xp" aria-hidden="true">
                      <span style={{ width: maxed ? '100%' : `${Math.min(100, (xp / need) * 100)}%` }} />
                    </span>
                  </div>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="insp-section">
        <h3 className="section-title">Traits</h3>
        {settler.traits.length === 0 ? (
          <p className="muted">No notable traits.</p>
        ) : (
          <div className="chips">
            {settler.traits.map((t) => (
              <Tooltip key={t} title={TRAIT_DEFS[t].name} content={TRAIT_DEFS[t].description} side="left">
                <span className="trait-chip" tabIndex={0}>
                  {TRAIT_DEFS[t].name}
                </span>
              </Tooltip>
            ))}
          </div>
        )}
      </section>

      <section className="insp-section">
        <h3 className="section-title">Life</h3>
        <dl className="kv">
          <dt>Home</dt>
          <dd>
            {settler.homeName && settler.homeId !== null ? (
              <button type="button" className="link-btn" onClick={() => goTo(settler.homeId)}>
                {settler.homeName}
              </button>
            ) : (
              <span className="muted-warn">No bed. Sleeps by the campfire.</span>
            )}
          </dd>
          <dt>Works at</dt>
          <dd>
            {settler.workplaceName && settler.workplaceId !== null ? (
              <button type="button" className="link-btn" onClick={() => goTo(settler.workplaceId)}>
                {settler.workplaceName}
              </button>
            ) : (
              <span className="muted">Nowhere in particular</span>
            )}
          </dd>
          <dt>Carrying</dt>
          <dd>{settler.carrying ? `${Math.floor(settler.carrying.amount)} ${RESOURCE_LABEL[settler.carrying.resource].toLowerCase()}` : <span className="muted">Nothing</span>}</dd>
          <dt>Tool</dt>
          <dd>
            {settler.toolDurability !== null ? (
              <Tooltip content={`${pluralize(Math.ceil(settler.toolDurability), 'working hour')} of use left. A tool makes work 40% faster.`} side="left">
                <span className="tool-meter" tabIndex={0}>
                  <span className="progress progress--thin">
                    <span style={{ width: `${Math.max(0, Math.min(100, (settler.toolDurability / TOOL_DURABILITY_HOURS) * 100))}%` }} />
                  </span>
                  <span>{Math.round((settler.toolDurability / TOOL_DURABILITY_HOURS) * 100)}%</span>
                </span>
              </Tooltip>
            ) : (
              <span className="muted">Bare-handed</span>
            )}
          </dd>
        </dl>
      </section>
    </div>
  );
}

