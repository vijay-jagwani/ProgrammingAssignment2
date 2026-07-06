import { useEffect, useRef, useState } from 'react';

export function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: abs >= 1000 ? 0 : 2 })}`;
}
export function fmtNum(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Two-step submit: first click arms, second click (within 3s) fires. */
export function ConfirmButton({
  onConfirm, children, disabled, className = 'primary',
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3000);
        } else {
          clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        }
      }}
    >
      {armed ? 'Click again to confirm' : children}
    </button>
  );
}

/** Numeric input with a soft sanity cap (warns, engine enforces hard caps). */
export function NumInput({
  value, onChange, softCap, min = 0, step = 1, width,
}: {
  value: number;
  onChange: (v: number) => void;
  softCap?: number;
  min?: number;
  step?: number;
  width?: number;
}) {
  const suspicious = softCap !== undefined && value > softCap;
  return (
    <input
      className={`num${suspicious ? ' warn-cap' : ''}`}
      type="number"
      min={min}
      step={step}
      value={Number.isFinite(value) ? value : ''}
      style={width ? { width } : undefined}
      title={suspicious ? `Unusually large — double-check (over ${fmtNum(softCap!)})` : undefined}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
    />
  );
}
