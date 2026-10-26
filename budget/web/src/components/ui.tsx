import { useEffect, useState, type ReactNode } from 'react';
import {
  addMonths,
  formatEur,
  formatMonthFr,
  parseEuroInput,
  type BudgetStatus,
  type Cents,
} from '@budget/shared';

export function Money({
  cents,
  signed = false,
  compact = false,
  className = '',
}: {
  cents: Cents;
  signed?: boolean;
  compact?: boolean;
  className?: string;
}): JSX.Element {
  const text = formatEur(cents, { compact });
  return <span className={`num ${className}`}>{signed && cents > 0 ? `+${text}` : text}</span>;
}

export function Loading({ label = 'Chargement…' }: { label?: string }): JSX.Element {
  return <div className="empty">{label}</div>;
}

export function ErrorBox({ error }: { error: Error | null }): JSX.Element {
  return <div className="banner banner-bad">{error?.message ?? 'Une erreur est survenue'}</div>;
}

export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return <div className="empty">{children}</div>;
}

export function Field({
  label,
  children,
  hint,
  group = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  /** Use for composite controls (buttons, segmented): a plain container instead of a label. */
  group?: boolean;
}): JSX.Element {
  const body = (
    <>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="muted small">{hint}</span> : null}
    </>
  );
  return group ? <div className="field">{body}</div> : <label className="field">{body}</label>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
}): JSX.Element {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Euro amount input that keeps what the user types and reports integer cents. */
export function MoneyInput({
  value,
  onChange,
  className = 'input',
  placeholder = '0',
  autoFocus,
  ariaLabel,
}: {
  value: Cents | null;
  onChange: (cents: Cents | null) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}): JSX.Element {
  const toText = (c: Cents | null): string => (c === null ? '' : String(c / 100).replace('.', ','));
  const [text, setText] = useState(toText(value));

  useEffect(() => {
    // Re-sync when the parent changes the value to something the current text does not represent.
    if (parseEuroInput(text) !== value && !(value === null && text.trim() === '')) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      className={className}
      inputMode="decimal"
      autoComplete="off"
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? null : parseEuroInput(e.target.value));
      }}
    />
  );
}

export function Progress({ ratio, status }: { ratio: number; status: BudgetStatus }): JSX.Element {
  return (
    <div className={`progress status-${status}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)}>
      <span style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">
        <p className="muted">{message}</p>
        <button
          className={`btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
        <button className="btn btn-block btn-ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Sheet>
  );
}

export function MonthSwitcher({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}): JSX.Element {
  return (
    <div className="month-switch">
      <button className="icon-btn" aria-label="Mois précédent" onClick={() => onChange(addMonths(month, -1))}>
        ‹
      </button>
      <span className="label">{formatMonthFr(month)}</span>
      <button className="icon-btn" aria-label="Mois suivant" onClick={() => onChange(addMonths(month, 1))}>
        ›
      </button>
    </div>
  );
}

export function statusBadgeClass(status: BudgetStatus): string {
  return status === 'over' ? 'badge-bad' : status === 'warn' ? 'badge-warn' : 'badge-good';
}
