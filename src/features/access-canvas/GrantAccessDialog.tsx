import React, { useMemo } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { AcEndpoint, AcGrantResult, AcModel, AcOp, buildOptions, groups } from './access-canvas.logic';
import { plural } from './canvas-page.shared';

export interface GrantState {
  src: AcEndpoint;
  tgt: AcEndpoint | null;
  result?: AcGrantResult;
  selected: number;
  targetVal: string;
}

/** Ranked ways to give an identity (or group) access to a service (or group), with impact. */
export const GrantAccessDialog: React.FC<{
  state: GrantState;
  onChange: (next: GrantState) => void;
  onClose: () => void;
  draft: AcModel;
  newId: () => string;
  onQueue: (title: string, summary: string, ops: AcOp[]) => void;
}> = ({ state, onChange, onClose, draft, newId, onQueue }) => {
  const targetChoices = useMemo(
    () => [
      ...groups(draft.services)
        .filter(([a]) => a)
        .map(([a]) => ({ value: JSON.stringify({ kind: 'group', attr: a }), label: '#' + a, group: 'Service groups' })),
      ...draft.services.map((s) => ({
        value: JSON.stringify({ kind: 'service', id: s.id }),
        label: s.name,
        group: 'Services',
      })),
    ],
    [draft],
  );
  const { result } = state;

  const queueSelected = () => {
    const r = result!;
    const o = r.opts[state.selected];
    if (!o) return;
    const i = o.impact;
    onQueue(
      o.title,
      `${r.srcLabel} → ${r.tgtLabel}. ${
        i.pairs ? `${plural(i.identities, 'identity', 'identities')}, ${plural(i.services, 'service', 'services')}` : 'no new access'
      }.`,
      o.ops,
    );
    onClose();
  };

  return (
    <ModalDialog
      open
      onClose={onClose}
      title={
        result
          ? `How should ${result.srcLabel} get ${result.tgtLabel}?`
          : `Give ${
              state.src.kind === 'group'
                ? '#' + state.src.attr
                : draft.identities.find((i) => i.id === state.src.id)?.name || ''
            } access`
      }
    >
      <div className="space-y-4 text-xs">
        {result && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono">
              {result.srcLabel}
            </span>
            <span className="text-[var(--ac-muted)]">({plural(result.srcCount, 'identity', 'identities')}) → dial →</span>
            <span className="px-2 py-0.5 rounded bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono">
              {result.tgtLabel}
            </span>
            <span className="text-[var(--ac-muted)]">({plural(result.tgtCount, 'service', 'services')})</span>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-[var(--ac-muted)]">Service or service group</span>
          <select
            value={state.targetVal}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              const tgt: AcEndpoint = JSON.parse(val);
              const res = buildOptions(draft, state.src, tgt, newId);
              onChange({
                ...state,
                tgt,
                targetVal: val,
                result: res,
                selected: Math.max(0, res.opts.findIndex((o) => o.recommended)),
              });
            }}
            className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
          >
            {!state.tgt && <option value="">Choose…</option>}
            {(['Service groups', 'Services'] as const).map((g) => (
              <optgroup key={g} label={g}>
                {targetChoices
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

        {result && (
          <>
            <p className="text-[var(--ac-muted)] m-0">
              OpenZiti grants access through attribute-based policies. Pick the option that matches your intent.
            </p>
            {result.unhosted.length > 0 && (
              <div className="p-3 rounded-lg border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]">
                {result.unhosted.join(', ')} {result.unhosted.length === 1 ? 'has' : 'have'} no hosting identity yet. Access will be granted, but connections won&apos;t complete until a Bind policy exists.
              </div>
            )}
            {result.already ? (
              <div className="p-3 rounded-lg bg-[var(--ac-ok-soft)] text-[var(--ac-ok)] font-medium">
                ✓ Already allowed by {result.allowedBy.join(', ')}. Nothing to change.
              </div>
            ) : (
              <div className="space-y-2">
                {result.opts.map((o, idx) => (
                  <label
                    key={idx}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${
                      state.selected === idx
                        ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)]'
                        : 'border-[var(--ac-line)] bg-[var(--ac-surface)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="grant-opt"
                      checked={state.selected === idx}
                      onChange={() => onChange({ ...state, selected: idx })}
                      className="mt-1"
                    />
                    <div className="space-y-1 flex-1">
                      <div className="font-semibold flex flex-wrap items-center gap-2">
                        <span>{o.title}</span>
                        {o.recommended && (
                          <span className="px-1.5 py-0.5 rounded bg-[var(--ac-ok-soft)] text-[var(--ac-ok)] text-[10px] uppercase">
                            Recommended
                          </span>
                        )}
                        {o.exception && (
                          <span className="px-1.5 py-0.5 rounded bg-[var(--ac-pending-soft)] text-[var(--ac-pending)] text-[10px] uppercase">
                            Exception
                          </span>
                        )}
                      </div>
                      <div className="text-[var(--ac-muted)]">{o.why}</div>
                      <div className="font-medium">
                        {o.impact.pairs
                          ? `Grants ${plural(o.impact.identities, 'identity', 'identities')} access to ${plural(
                              o.impact.services,
                              'service',
                              'services',
                            )} (${plural(o.impact.pairs, 'new pair', 'new pairs')}).`
                          : 'No new access.'}
                      </div>
                      {o.impact.outside.length > 0 && (
                        <div className="text-[var(--ac-bad)]">Also grants: {o.impact.outside.join(', ')}</div>
                      )}
                      {o.impact.noRoute > 0 && (
                        <div className="text-[var(--ac-bad)]">{o.impact.noRoute} of them can&apos;t reach a router for it yet.</div>
                      )}
                      <details className="text-[11px]">
                        <summary className="cursor-pointer text-[var(--ac-muted)]">{plural(o.calls.length, 'API call', 'API calls')}</summary>
                        <pre className="mt-1.5 p-2 rounded bg-[var(--ac-surface)] border border-[var(--ac-line)] overflow-x-auto font-mono">
                          {o.calls.join('\n\n')}
                        </pre>
                      </details>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ac-line)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] cursor-pointer"
          >
            Cancel
          </button>
          {result && !result.already && (
            <button
              type="button"
              onClick={queueSelected}
              className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
            >
              Add to pending changes
            </button>
          )}
        </div>
      </div>
    </ModalDialog>
  );
};
