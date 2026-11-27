import React, { useState } from 'react';
import { ModalDialog } from './ModalDialog';
import { zitiService } from '../services/ziti-service';

/**
 * Asks before a destructive action and runs it. The dialog stays open showing the error if
 * the action fails, and closes only when it succeeds.
 */
export const ConfirmDialog: React.FC<{
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}> = ({ title, children, confirmLabel, onConfirm, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(zitiService.errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog open onClose={onClose} title={title}>
      <div className="space-y-4 text-xs">
        <div className="text-[var(--ac-muted)] space-y-2">{children}</div>
        {error && (
          <p role="alert" className="m-0 rounded-lg border border-[var(--ac-bad)]/40 bg-[var(--ac-bad-soft)] px-3 py-2 text-[var(--ac-bad)]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ac-line)]">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--ac-line)] cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-[var(--ac-bad)] text-white font-semibold cursor-pointer disabled:opacity-60"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
