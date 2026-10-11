import type { ReactNode } from 'react';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  /** Extra content under the label (art, hint). */
  content?: ReactNode;
}

export interface RadioCardsProps<T extends string> {
  name: string;
  legend: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (value: T) => void;
  variant?: 'segmented' | 'cards';
  /** data-testid prefix: each option gets `${testIdPrefix}-${value}`. */
  testIdPrefix: string;
}

/** Radio group drawn as segmented buttons or cards. Real radio inputs, so arrow keys and screen readers just work. */
export function RadioCards<T extends string>({ name, legend, value, options, onChange, variant = 'segmented', testIdPrefix }: RadioCardsProps<T>) {
  return (
    <fieldset className={`radio-cards radio-cards--${variant}`}>
      <legend className="field__label">{legend}</legend>
      <div className="radio-cards__row">
        {options.map((o) => (
          <label key={o.value} className={`radio-card ${o.value === value ? 'is-selected' : ''}`}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              data-testid={`${testIdPrefix}-${o.value}`}
            />
            {o.content}
            <span className="radio-card__label">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
