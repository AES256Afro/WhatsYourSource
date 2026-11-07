import { useState } from 'react';
import { Check } from '../Icons';

export function ProviderCard({
  icon,
  title,
  subtitle,
  subtitleTone,
  isDefault,
  onMakeDefault,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  subtitleTone?: 'ok' | 'bad';
  isDefault: boolean;
  onMakeDefault?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-2.5 rounded-xl border p-3 ${isDefault ? 'border-accent bg-accent-wash' : 'border-line'} ${disabled ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] ${isDefault ? 'bg-accent-fill text-white' : 'bg-surface-2 text-ink-2'}`}
        >
          {icon}
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="text-[14px] font-semibold">{title}</span>
          {subtitle && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] ${subtitleTone === 'ok' ? 'font-semibold text-ok' : subtitleTone === 'bad' ? 'font-semibold text-bad' : 'text-ink-2'}`}
            >
              {subtitleTone === 'ok' && <Check size={11} />}
              <span className="truncate">{subtitle}</span>
            </span>
          )}
        </span>
        {isDefault ? (
          <span className="rounded-full bg-accent-fill px-2 py-0.5 text-[11px] font-semibold text-white">Default</span>
        ) : (
          onMakeDefault &&
          !disabled && (
            <button className="wys-btn h-[30px] px-2.5 text-[12px]" onClick={onMakeDefault}>
              Make default
            </button>
          )
        )}
      </div>
      {children}
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[40px] items-center gap-3 border-b border-surface-2 py-1.5 text-[13px] last:border-b-0">
      <span className="flex grow flex-col">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-ink-2">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border-0 p-0 transition-colors ${checked ? 'bg-accent-fill' : 'bg-line-2'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

/** Local draft that follows the committed value when it changes from outside (the React "derived state" pattern). */
function useDraft(value: string): [string, (v: string) => void] {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setV(value);
  }
  return [v, setV];
}

export function DebouncedTextarea({ id, value, onCommit, placeholder }: { id: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useDraft(value);
  return (
    <textarea
      id={id}
      className="wys-input h-16 resize-none py-2 text-[12px]"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      placeholder={placeholder}
    />
  );
}

/** Text input that writes to settings on blur/Enter, not on every keystroke. */
export function CommitInput({
  id,
  value,
  onCommit,
  type = 'text',
  placeholder,
  className = '',
  list,
}: {
  id: string;
  value: string;
  onCommit: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
  list?: string;
}) {
  const [v, setV] = useDraft(value);
  const commit = () => v !== value && onCommit(v.trim());
  return (
    <input
      id={id}
      type={type}
      list={list}
      className={`wys-input ${className}`}
      value={v}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

export function SecretInput({ id, value, onCommit, placeholder }: { id: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <CommitInput id={id} type={show ? 'text' : 'password'} value={value} onCommit={onCommit} placeholder={placeholder} className="min-w-0 grow" />
      <button className="wys-btn px-2.5" type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide key' : 'Show key'}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export type Status = { kind: 'idle' | 'checking' | 'ok' | 'bad'; text?: string };
