import { memo, useId, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export type Tone = 'accent' | 'ok' | 'warn' | 'error' | 'info' | 'muted' | 'violet';

/** Section with a small uppercase header inside a panel. */
export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className ?? ''}`}>
      <header className="section-head">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
  testId?: string;
}

/** Segmented control: a radio group rendered as buttons (keyboard: Tab + Enter/Space, arrows). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  testId,
  disabled,
}: {
  value: T;
  options: readonly SegOption<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  testId?: string;
  disabled?: boolean;
}) {
  const onKey = (e: KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    for (let k = 1; k <= options.length; k++) {
      const o = options[(idx + dir * k + options.length) % options.length];
      if (!o.disabled) {
        onChange(o.value);
        const group = (e.currentTarget as HTMLElement).parentElement;
        const btn = group?.querySelectorAll<HTMLButtonElement>('button')[options.indexOf(o)];
        btn?.focus();
        break;
      }
    }
  };
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label} data-testid={testId} aria-disabled={disabled || undefined}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            className={on ? 'on' : undefined}
            disabled={disabled || o.disabled}
            title={o.title}
            tabIndex={on ? 0 : -1}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** On/off switch with a visible label (aria-pressed toggle button). */
export const Toggle = memo(function Toggle({
  on,
  onChange,
  label,
  hint,
  testId,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)} title={hint} data-testid={testId} disabled={disabled}>
      <span className="toggle-label">{label}</span>
      <span className="switch" aria-hidden="true">
        <span className="knob" />
      </span>
    </button>
  );
});

/** Labelled range slider with value readout. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  testId?: string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        data-testid={testId}
      />
    </div>
  );
}

/** Thin progress bar 0..1. */
export const Bar = memo(function Bar({ value, tone = 'accent', label, thin }: { value: number; tone?: Tone; label?: string; thin?: boolean }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div
      className={`bar tone-${tone} ${thin ? 'bar-thin' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <span style={{ transform: `scaleX(${v})` }} />
    </div>
  );
});

/** Key/value row used in telemetry cards. */
export const Row = memo(function Row({ k, v, tone, title, testId }: { k: ReactNode; v: ReactNode; tone?: Tone; title?: string; testId?: string }) {
  return (
    <div className="kv" title={title}>
      <span className="k">{k}</span>
      <span className={`v ${tone ? `tone-${tone}` : ''}`} data-testid={testId}>
        {v}
      </span>
    </div>
  );
});

/** Labelled form row (label above control). */
export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Pill({ tone = 'muted', children, title, testId, icon }: { tone?: Tone; children: ReactNode; title?: string; testId?: string; icon?: IconName }) {
  return (
    <span className={`pill tone-${tone}`} title={title} data-testid={testId}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

/** Small icon-only button with an accessible label + tooltip. */
export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  testId,
  disabled,
  size = 16,
  className,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  testId?: string;
  disabled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${className ?? ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      aria-pressed={pressed}
      data-testid={testId}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/** Compact inline SVG sparkline. */
export const Sparkline = memo(function Sparkline({
  values,
  min,
  max,
  width = 120,
  height = 28,
  tone = 'accent',
  label,
}: {
  values: readonly number[];
  min?: number;
  max?: number;
  width?: number;
  height?: number;
  tone?: Tone;
  label: string;
}) {
  const n = values.length;
  let lo = min ?? Infinity;
  let hi = max ?? -Infinity;
  if (min === undefined || max === undefined) {
    for (const v of values) {
      if (min === undefined) lo = Math.min(lo, v);
      if (max === undefined) hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) {
    lo = Number.isFinite(lo) ? lo - 1 : 0;
    hi = lo + 2;
  }
  const pad = 2;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? width : (i / (n - 1)) * width;
    const y = pad + (1 - (values[i] - lo) / (hi - lo)) * (height - 2 * pad);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const line = pts.join(' ');
  return (
    <svg className={`spark tone-${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
      {n > 1 && (
        <>
          <polygon className="spark-fill" points={`0,${height} ${line} ${width},${height}`} />
          <polyline className="spark-line" points={line} />
          <circle className="spark-dot" cx={width} cy={pts[n - 1].split(',')[1]} r={2} />
        </>
      )}
      {n <= 1 && <line className="spark-empty" x1={0} x2={width} y1={height / 2} y2={height / 2} />}
    </svg>
  );
});

/** Circular gauge (0..1). */
export const Ring = memo(function Ring({ value, size = 56, stroke = 5, tone = 'accent', children, label }: { value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div className={`ring tone-${tone}`} style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeLinecap="round"
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
});
