import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CurrencyInput, type CurrencyInputProps } from './CurrencyInput';
import { sanitizeNumericText } from './NumberField';

/** Controlled wrapper that records every emitted value. */
function Harness(props: Partial<CurrencyInputProps> & { initial?: number | null; onEmit?: (v: number | null) => void }) {
  const { initial = null, onEmit, ...rest } = props;
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <label htmlFor="amount">Amount</label>
      <CurrencyInput
        id="amount"
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onEmit?.(v);
        }}
        {...rest}
      />
      <button type="button">elsewhere</button>
      <output data-testid="value">{value === null ? 'null' : String(value)}</output>
    </>
  );
}

describe('CurrencyInput', () => {
  it('shows a formatted value with cents and the currency symbol', () => {
    render(<Harness initial={1234.5} />);
    expect(screen.getByLabelText('Amount')).toHaveValue('1,234.50');
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('accepts typed digits and emits numbers on every change', async () => {
    const onEmit = vi.fn();
    render(<Harness onEmit={onEmit} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '32000.5');
    expect(onEmit).toHaveBeenLastCalledWith(32000.5);
    expect(input).toHaveValue('32000.5'); // raw while focused
    expect(screen.getByTestId('value')).toHaveTextContent('32000.5');
  });

  it('formats as currency on blur and returns to raw digits on focus', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '25000');
    await userEvent.tab();
    expect(input).toHaveValue('25,000.00');
    await userEvent.click(input);
    expect(input).toHaveValue('25000');
  });

  it('ignores letters, symbols and extra decimal points, and caps cents at two digits', async () => {
    const onEmit = vi.fn();
    render(<Harness onEmit={onEmit} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '$1,2a3.4.567');
    expect(input).toHaveValue('123.45');
    expect(onEmit).toHaveBeenLastCalledWith(123.45);
  });

  it('emits null when cleared', async () => {
    const onEmit = vi.fn();
    render(<Harness initial={500} onEmit={onEmit} />);
    await userEvent.clear(screen.getByLabelText('Amount'));
    expect(onEmit).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('value')).toHaveTextContent('null');
  });

  it('shows min/max messages after blur, not while typing', async () => {
    render(<Harness min={100} max={50000} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '60000');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter no more than $50,000.');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter at least $100.');
  });

  it('renders external error text and links it with aria-describedby', () => {
    render(<Harness initial={10} error="The server rejected this amount." />);
    const input = screen.getByLabelText('Amount');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The server rejected this amount.');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('uses the given currency symbol', () => {
    render(<Harness initial={10} currency="EUR" />);
    expect(screen.getByText('€')).toBeInTheDocument();
  });

  it('supports whole-unit amounts', async () => {
    const onEmit = vi.fn();
    render(<Harness cents={false} onEmit={onEmit} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '1200.99');
    expect(onEmit).toHaveBeenLastCalledWith(120099);
    await userEvent.tab();
    expect(input).toHaveValue('120,099');
  });

  it('shows a new value set from outside while focused (e.g. a quick pick)', async () => {
    function External() {
      const [value, setValue] = useState<number | null>(100);
      return (
        <>
          <label htmlFor="a">A</label>
          <CurrencyInput id="a" value={value} onValueChange={setValue} />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setValue(750)}>
            Set 750
          </button>
        </>
      );
    }
    render(<External />);
    const input = screen.getByLabelText('A');
    await userEvent.click(input);
    await userEvent.click(screen.getByRole('button', { name: 'Set 750' }));
    expect(input).toHaveValue('750');
  });
});

describe('sanitizeNumericText', () => {
  it('keeps digits and a single decimal point', () => {
    expect(sanitizeNumericText('1,234.567', 2)).toBe('1234.56');
    expect(sanitizeNumericText('..5', 2)).toBe('.5');
    expect(sanitizeNumericText('12.3', 0)).toBe('12');
    expect(sanitizeNumericText('-40', 2)).toBe('-40'); // kept so min validation can flag it
    expect(sanitizeNumericText('1.234,56', 2)).toBe('1234.56'); // decimal comma
    expect(sanitizeNumericText('12,5', 2)).toBe('12.5');
    expect(sanitizeNumericText('1,234', 2)).toBe('1234'); // thousands comma
  });
});
