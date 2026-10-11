import { useId } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  testId?: string;
}

/** On/off setting with a label and optional hint. A real checkbox underneath, so keyboard and screen readers just work. */
export function Switch({ checked, onChange, label, hint, testId }: SwitchProps) {
  const id = useId();
  return (
    <label className="switch" htmlFor={id}>
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {hint && <span className="switch__hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </label>
  );
}
