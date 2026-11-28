import React from 'react';
import { X } from 'lucide-react';
import type { AcModel } from './access-canvas.logic';
import { DrawerKind, FollowUp, Pending, plural } from './canvas-page.shared';
import type { AdvisorState } from './useAdvisor';

/** "Why can't they connect?": every requirement for an identity to reach a service. */
const AdvisorPanel: React.FC<{
  draft: AcModel | null;
  advisor: AdvisorState;
  onIdentity: (id: string) => void;
  onService: (id: string) => void;
}> = ({ draft, advisor, onIdentity, onService }) => {
  const { identity, service, failure } = advisor;
  return (
    <>
      <p className="text-[var(--ac-muted)] m-0">
        Checks every requirement OpenZiti needs for an identity to reach a service. Double-click any card on the canvas to inspect it here.
      </p>
      {!identity || !service ? (
        <div className="p-4 rounded-xl border border-dashed border-[var(--ac-line)] text-[var(--ac-muted)]">
          Add at least one identity and one service to test the path between them.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2.5">
            <label className="space-y-1">
              <span className="text-[var(--ac-muted)]">Identity</span>
              <select
                value={advisor.activeIdentityId}
                onChange={(e) => onIdentity(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-xs"
              >
                {advisor.clientGroups.map((g) => (
                  <optgroup key={g.attr} label={g.attr ? '#' + g.attr : 'no attributes'}>
                    {g.members.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[var(--ac-muted)]">Service</span>
              <select
                value={advisor.activeServiceId}
                onChange={(e) => onService(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-xs"
              >
                {draft?.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className={`p-3 rounded-xl font-semibold ${
              failure ? 'bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]' : 'bg-[var(--ac-ok-soft)] text-[var(--ac-ok)]'
            }`}
          >
            {failure
              ? `✕ ${identity.name} can't reach ${service.name}: ${failure.t.toLowerCase()}`
              : `✓ ${identity.name} can reach ${service.name}${advisor.needsPosture ? ' (after posture check)' : ''}`}
          </div>

          <ol className="list-none p-0 m-0 divide-y divide-[var(--ac-line)]">
            {advisor.steps.map((x, idx) => (
              <li key={idx} className="py-2.5 flex items-start gap-2.5">
                <span
                  className={`w-5 h-5 rounded-full inline-grid place-items-center text-[11px] font-bold flex-none ${
                    x.st === 'ok'
                      ? 'bg-[var(--ac-ok-soft)] text-[var(--ac-ok)]'
                      : x.st === 'bad'
                        ? 'bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]'
                        : 'bg-[var(--ac-pending-soft)] text-[var(--ac-pending)]'
                  }`}
                >
                  {x.st === 'ok' ? '✓' : x.st === 'bad' ? '✕' : '!'}
                </span>
                <div className="space-y-0.5">
                  <div className="font-semibold">{x.t}</div>
                  {x.d && <div className="text-[var(--ac-muted)]">{x.d}</div>}
                  {x.fix && <div className="text-[var(--ac-ink)]">Fix: {x.fix}</div>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
};

/** Queued change sets with their API calls, follow-up steps, and Apply / Discard / Undo. */
const PendingPanel: React.FC<{
  pending: Pending[];
  followUps: FollowUp[];
  busy: boolean;
  canUndo: boolean;
  onApply: () => void;
  onDiscard: (id: string) => void;
  onDiscardAll: () => void;
  onUndo: () => void;
  onDismissFollowUp: (idx: number) => void;
}> = ({ pending, followUps, busy, canUndo, onApply, onDiscard, onDiscardAll, onUndo, onDismissFollowUp }) => (
  <>
    {followUps.map((f, idx) => (
      <div key={idx} className="p-3 rounded-xl border border-[var(--ac-ok)] bg-[var(--ac-ok-soft)] space-y-2">
        <div className="flex items-center justify-between font-semibold">
          <span>To finish: {f.title}</span>
          <button type="button" onClick={() => onDismissFollowUp(idx)} className="text-xs underline cursor-pointer">
            Done
          </button>
        </div>
        <ol className="list-decimal pl-4 space-y-1 m-0">
          {f.steps.map((st, sIdx) => (
            <li key={sIdx}>{st}</li>
          ))}
        </ol>
      </div>
    ))}

    <p className="text-[var(--ac-muted)] m-0">
      Nothing is sent to the controller until you click Apply. Changes execute in order.
    </p>

    {pending.length > 0 ? (
      pending.map((c) => (
        <div
          key={c.id}
          className="p-3 rounded-xl border border-dashed border-[var(--ac-pending)] bg-[var(--ac-pending-soft)] space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{c.title}</div>
              <div className="text-[var(--ac-muted)]">{c.summary}</div>
            </div>
            <button
              type="button"
              onClick={() => onDiscard(c.id)}
              disabled={busy}
              className="text-xs text-[var(--ac-muted)] hover:text-[var(--ac-ink)] underline cursor-pointer"
            >
              Discard
            </button>
          </div>
          <details className="text-[11px]">
            <summary className="cursor-pointer text-[var(--ac-muted)]">{plural(c.calls.length, 'API call', 'API calls')}</summary>
            <pre className="mt-1.5 p-2.5 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] overflow-x-auto font-mono text-[11px]">
              {c.calls.join('\n\n')}
            </pre>
          </details>
        </div>
      ))
    ) : (
      <div className="p-4 rounded-xl border border-dashed border-[var(--ac-line)] text-[var(--ac-muted)]">
        No pending changes. Drag an identity onto a service, move a card to another group, or run the Set up a service wizard.
      </div>
    )}

    <div className="sticky bottom-0 pt-3 pb-1 bg-[var(--ac-surface)] border-t border-[var(--ac-line)] flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onApply}
        disabled={!pending.length || busy}
        className="px-3.5 py-1.5 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer disabled:opacity-50"
      >
        {busy ? 'Working…' : pending.length ? `Apply ${plural(pending.length, 'change', 'changes')}` : 'Apply changes'}
      </button>
      <button
        type="button"
        onClick={onDiscardAll}
        disabled={!pending.length || busy}
        className="px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer disabled:opacity-50"
      >
        Discard all
      </button>
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo || busy}
        className="px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer disabled:opacity-50"
      >
        Undo last apply
      </button>
    </div>
  </>
);

/** Right-hand floating drawer showing either the access advisor or the pending changes. */
export const CanvasDrawer: React.FC<{
  kind: DrawerKind;
  onClose: () => void;
  advisor: React.ComponentProps<typeof AdvisorPanel>;
  pending: React.ComponentProps<typeof PendingPanel>;
}> = ({ kind, onClose, advisor, pending }) => (
  <aside
    aria-label={kind === 'pending' ? 'Pending changes' : 'Check access'}
    className="absolute top-14 right-3 bottom-14 z-10 w-[min(420px,calc(100%-24px))] flex flex-col rounded-2xl bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-2xl overflow-hidden"
  >
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ac-line)] bg-[var(--ac-surface-2)]">
      <h2 className="text-sm font-semibold m-0">{kind === 'pending' ? 'Pending changes' : "Why can't they connect?"}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="p-1 rounded-md text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>

    <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
      {kind === 'advisor' ? <AdvisorPanel {...advisor} /> : <PendingPanel {...pending} />}
    </div>
  </aside>
);
