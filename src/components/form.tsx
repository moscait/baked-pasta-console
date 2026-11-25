import React, { useCallback, useState } from 'react';
import type { FormOutcome } from './form-values';
import { zitiService } from '../services/ziti-service';

/** Form state plus a typed single-field setter. */
export function useDraft<T extends object>(init: () => T) {
  const [draft, setDraft] = useState<T>(init);
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => setDraft((d) => ({ ...d, [key]: value })), []);
  return [draft, set] as const;
}

/**
 * Submit handler for an entity form: validates via `build`, shows its errors, otherwise saves
 * and calls `onDone`. A failed save stays open with the controller's message.
 */
export function useFormSubmit<B>(build: () => FormOutcome<B>, save: (body: B) => Promise<void>, onDone: () => void) {
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = build();
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      await save(result.body);
      onDone();
    } catch (err) {
      setErrors([zitiService.errorText(err)]);
    } finally {
      setBusy(false);
    }
  };
  return { errors, busy, submit };
}

/** Shared look for text inputs, selects and textareas in entity forms. */
export const inputCls =
  'w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono disabled:opacity-50';

export const Field: React.FC<{ label: string; hint?: React.ReactNode; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <label className="block space-y-1">
    <span className="font-medium">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-[var(--ac-muted)]">{hint}</span>}
  </label>
);

export const CheckField: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: React.ReactNode;
  disabled?: boolean;
}> = ({ label, checked, onChange, hint, disabled }) => (
  <label className={`flex items-start gap-2 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <input
      type="checkbox"
      className="mt-0.5"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>
      <span className="font-medium">{label}</span>
      {hint && <span className="block text-[11px] text-[var(--ac-muted)]">{hint}</span>}
    </span>
  </label>
);

export const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <fieldset className="space-y-3 rounded-xl border border-[var(--ac-line)] p-3">
    <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ac-muted)]">{title}</legend>
    {children}
  </fieldset>
);

export const ErrorList: React.FC<{ errors: string[] }> = ({ errors }) =>
  errors.length ? (
    <ul
      role="alert"
      className="m-0 list-disc space-y-0.5 rounded-lg border border-[var(--ac-bad)]/40 bg-[var(--ac-bad-soft)] py-2 pl-6 pr-3 text-[var(--ac-bad)]"
    >
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  ) : null;

export const FormActions: React.FC<{ onCancel: () => void; submitLabel: string; busy?: boolean }> = ({
  onCancel,
  submitLabel,
  busy,
}) => (
  <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ac-line)]">
    <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-[var(--ac-line)] cursor-pointer">
      Cancel
    </button>
    <button
      type="submit"
      disabled={busy}
      className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer disabled:opacity-60"
    >
      {busy ? 'Saving…' : submitLabel}
    </button>
  </div>
);

/** A textarea for a free-form JSON map; parse with `parseJsonObject` on submit. */
export const JsonObjectField: React.FC<{
  label: string;
  value: string;
  onChange: (text: string) => void;
  hint?: React.ReactNode;
  rows?: number;
}> = ({ label, value, onChange, hint, rows = 4 }) => (
  <Field label={label} hint={hint}>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      spellCheck={false}
      placeholder={'{\n  "key": "value"\n}'}
      className={`${inputCls} text-xs`}
    />
  </Field>
);
