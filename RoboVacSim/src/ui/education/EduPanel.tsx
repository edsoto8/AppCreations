import { memo } from 'react';
import { useStore } from '../../app/store';
import type { EduTopic } from '../../app/types';
import { Icon } from '../icons';
import { EDU_ORDER } from '../labels';
import { Toggle } from '../primitives';
import { EDU_TOPICS } from './topics';

const LiveValues = memo(function LiveValues({ topic }: { topic: EduTopic }) {
  const t = useStore((s) => s.telemetry);
  const rows = t ? EDU_TOPICS[topic].live(t) : [];
  return (
    <div className="edu-live" aria-label="Live values from the simulation">
      <div className="edu-live-head">
        <span className="live-dot" aria-hidden="true" /> Live values
      </div>
      {rows.length === 0 && <div className="muted">Waiting for telemetry…</div>}
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="edu-live-row">
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});

function TopicList({ current, onPick, compact }: { current: EduTopic; onPick: (t: EduTopic) => void; compact?: boolean }) {
  return (
    <div className={`edu-topics ${compact ? 'compact' : ''}`} role="tablist" aria-label="Topics">
      {EDU_ORDER.map((id, i) => {
        const t = EDU_TOPICS[id];
        const on = id === current;
        return (
          <button key={id} type="button" role="tab" aria-selected={on} className={`edu-topic ${on ? 'on' : ''}`} onClick={() => onPick(id)} data-testid={`edu-topic-${id}`} title={t.summary}>
            <span className="edu-num">{i + 1}</span>
            <Icon name={t.icon} size={14} />
            <span className="edu-topic-name">{t.title}</span>
          </button>
        );
      })}
    </div>
  );
}

export const EduPanel = memo(function EduPanel() {
  const enabled = useStore((s) => s.eduEnabled);
  const topicId = useStore((s) => s.eduTopic);
  const stepRaw = useStore((s) => s.eduStep);
  const set = useStore((s) => s.set);
  const topic = EDU_TOPICS[topicId];
  const step = Math.min(Math.max(0, stepRaw), topic.steps.length - 1);
  const cur = topic.steps[step];

  const showMe = () => {
    const st = useStore.getState();
    set({ cameraMode: topic.showMe.camera, overlays: { ...st.overlays, ...topic.showMe.overlays }, ...topic.showMe.extra });
  };

  return (
    <div className="panel-stack edu">
      <div className="edu-intro">
        <div>
          <h3>Engineering mode</h3>
          <p className="muted">Step through how each subsystem works, with live numbers from the running simulation.</p>
        </div>
        <Toggle on={enabled} onChange={(v) => set({ eduEnabled: v })} label={enabled ? 'On' : 'Off'} testId="edu-toggle" hint="Engineering / education mode" />
      </div>
      {!enabled ? (
        <div className="edu-off">
          <TopicList
            current={topicId}
            onPick={(id) => set({ eduEnabled: true, eduTopic: id, eduStep: 0 })}
          />
        </div>
      ) : (
        <>
          <TopicList compact current={topicId} onPick={(id) => set({ eduTopic: id, eduStep: 0 })} />
          <article className="edu-card" aria-labelledby="edu-step-title" data-testid="edu-card">
            <header className="edu-card-head">
              <span className="eyebrow">
                {topic.title} · Step {step + 1} of {topic.steps.length}
              </span>
              <h4 id="edu-step-title">{cur.title}</h4>
              <div className="edu-dots" aria-hidden="true">
                {topic.steps.map((_, i) => (
                  <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />
                ))}
              </div>
            </header>
            {cur.diagram && <div className="edu-diagram">{cur.diagram}</div>}
            <div className="edu-body">{cur.body}</div>
            <div className="edu-nav">
              <button type="button" className="btn btn-ghost btn-sm" disabled={step === 0} onClick={() => set({ eduStep: step - 1 })} data-testid="edu-prev">
                <Icon name="chevL" size={14} /> Prev
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={showMe} data-testid="edu-showme" title={`Switch to: ${topic.showMe.label}`}>
                <Icon name="eye" size={14} /> Show me
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={step >= topic.steps.length - 1} onClick={() => set({ eduStep: step + 1 })} data-testid="edu-next">
                Next <Icon name="chevR" size={14} />
              </button>
            </div>
          </article>
          <LiveValues topic={topicId} />
          <div className="disclaimer-box" role="note">
            <strong>Simplified educational model — not an accurate engineering simulation.</strong>
            <ul>
              {topic.simplifications.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
});
