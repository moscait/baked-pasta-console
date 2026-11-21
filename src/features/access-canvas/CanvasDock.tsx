import React from 'react';
import { DrawerKind, plural } from './canvas-page.shared';

/** Floating top-right buttons: Check access, pending changes, Apply. */
export const CanvasDock: React.FC<{
  drawer: DrawerKind | null;
  onToggleDrawer: (d: DrawerKind) => void;
  /** null when there is no identity/service pair to check yet. */
  advisorOk: boolean | null;
  pendingCount: number;
  pulse: boolean;
  busy: boolean;
  onApply: () => void;
}> = ({ drawer, onToggleDrawer, advisorOk, pendingCount, pulse, busy, onApply }) => (
  <div className="absolute top-3 right-3 z-10 flex items-center gap-2" role="toolbar" aria-label="Changes and checks">
    <button
      type="button"
      onClick={() => onToggleDrawer('advisor')}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-medium shadow-md cursor-pointer transition-all ${
        drawer === 'advisor'
          ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-[var(--ac-ink)]'
          : 'border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-muted)] hover:text-[var(--ac-ink)]'
      }`}
    >
      {advisorOk !== null && (
        <span className={`w-2.5 h-2.5 rounded-full ${advisorOk ? 'bg-[var(--ac-ok)]' : 'bg-[var(--ac-bad)]'}`} />
      )}
      <span>Check access</span>
    </button>

    <button
      type="button"
      onClick={() => onToggleDrawer('pending')}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-medium shadow-md cursor-pointer transition-all ${
        pulse ? 'scale-105 ring-4 ring-[var(--ac-pending)]/30' : ''
      } ${
        pendingCount > 0
          ? 'border-[var(--ac-pending)] bg-[var(--ac-pending-soft)] text-[var(--ac-ink)]'
          : drawer === 'pending'
            ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-[var(--ac-ink)]'
            : 'border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-muted)]'
      }`}
    >
      {pendingCount > 0 ? (
        <>
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--ac-pending)]" />
          <span>{plural(pendingCount, 'pending change', 'pending changes')} · Review</span>
        </>
      ) : (
        <span>No pending changes</span>
      )}
    </button>

    {pendingCount > 0 && (
      <button
        type="button"
        onClick={onApply}
        disabled={busy}
        className="px-4 py-1.5 rounded-full bg-[var(--ac-dial)] text-white text-xs font-semibold shadow-md cursor-pointer hover:opacity-95"
      >
        {busy ? 'Applying…' : 'Apply'}
      </button>
    )}
  </div>
);
