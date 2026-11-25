import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Tag } from 'lucide-react';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { ModalDialog } from '../components/ModalDialog';
import {
  ATTR_KIND_LABEL,
  AttrKind,
  AttributeInput,
  AttributeRow,
  buildAttributeIndex,
} from '../features/attributes/attributes.logic';

const KINDS: AttrKind[] = ['identity', 'service', 'router', 'posture'];

const EMPTY: AttributeInput = {
  identities: [],
  services: [],
  edgeRouters: [],
  postureChecks: [],
  servicePolicies: [],
  edgeRouterPolicies: [],
  serviceEdgeRouterPolicies: [],
};

/** Every `#attribute` on the network, who carries it, which policies select it, and mismatches. */
export const AttributesPage: React.FC<{
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ onToast }) => {
  const [input, setInput] = useState<AttributeInput>(EMPTY);
  const [detail, setDetail] = useState<AttributeRow | null>(null);
  const [issuesOnly, setIssuesOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const [identities, services, edgeRouters, postureChecks, servicePolicies, edgeRouterPolicies, serps] =
        await Promise.all([
          zitiService.list('identities'),
          zitiService.list('services'),
          zitiService.list('edge-routers'),
          zitiService.list('posture-checks'),
          zitiService.list('service-policies'),
          zitiService.list('edge-router-policies'),
          zitiService.list('service-edge-router-policies'),
        ]);
      setInput({
        identities,
        services,
        edgeRouters,
        postureChecks,
        servicePolicies,
        edgeRouterPolicies,
        serviceEdgeRouterPolicies: serps,
      });
    } catch (err) {
      onToast('error', 'Failed to load attributes', zitiService.errorText(err));
    }
  }, [onToast]);

  useEffect(() => {
    load();
    return zitiService.subscribe(load);
  }, [load]);

  const rows = useMemo(() => buildAttributeIndex(input), [input]);
  const danglingCount = rows.filter((r) => r.dangling.length > 0).length;
  const shown = issuesOnly ? rows.filter((r) => r.dangling.length > 0) : rows;

  const countCol = (kind: AttrKind, header: string): ColumnDef<AttributeRow> => ({
    key: kind,
    header,
    type: 'number',
    getValue: (r) => r.members[kind].length,
    render: (r) => (
      <span className={`font-mono text-xs ${r.members[kind].length ? '' : 'text-[var(--ac-muted)]'}`}>
        {r.members[kind].length}
      </span>
    ),
  });

  const columns: ColumnDef<AttributeRow>[] = [
    {
      key: 'name',
      header: 'Attribute',
      render: (r) => (
        <button
          type="button"
          onClick={() => setDetail(r)}
          className="font-semibold font-mono text-[var(--ac-dial)] hover:underline cursor-pointer"
        >
          #{r.name}
        </button>
      ),
    },
    countCol('identity', 'Identities'),
    countCol('service', 'Services'),
    countCol('router', 'Edge Routers'),
    countCol('posture', 'Posture Checks'),
    {
      key: 'refs',
      header: 'Used by Policies',
      type: 'number',
      getValue: (r) => r.refs.length,
      render: (r) => <span className="font-mono text-xs">{r.refs.length}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      getValue: (r) =>
        r.dangling.length ? 'Selects nothing' : r.unused ? 'Not used by any policy' : 'OK',
      render: (r) =>
        r.dangling.length ? (
          <span
            title={r.dangling.map((d) => `${d.policyName} selects #${r.name} on ${ATTR_KIND_LABEL[d.selects]}`).join('\n')}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--ac-bad-soft)] text-[var(--ac-bad)] text-[11px] font-semibold"
          >
            <AlertTriangle className="w-3 h-3" />
            Policy selects nothing
          </span>
        ) : r.unused ? (
          <span className="px-2 py-0.5 rounded-full bg-[var(--ac-surface-2)] text-[var(--ac-muted)] text-[11px]">
            Not used by any policy
          </span>
        ) : (
          <span className="text-[11px] text-[var(--ac-ok)] font-medium">OK</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight m-0">Attributes</h1>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Every <code>#attribute</code> on the network: which identities, services, routers and posture checks carry
            it, and which policies select it.
          </p>
        </div>
        {danglingCount > 0 && (
          <button
            type="button"
            onClick={() => setIssuesOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
              issuesOnly
                ? 'border-[var(--ac-bad)] bg-[var(--ac-bad)] text-white'
                : 'border-[var(--ac-bad)]/50 bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {issuesOnly ? 'Show all attributes' : `${danglingCount} attribute${danglingCount === 1 ? '' : 's'} selected by a policy but carried by nothing`}
            </span>
          </button>
        )}
      </div>

      <DataTable caption="Attributes" data={shown} columns={columns} searchPlaceholder="Search attribute, member, or policy…" />

      {detail && (
        <ModalDialog open={!!detail} onClose={() => setDetail(null)} wide title={<span className="font-mono">#{detail.name}</span>}>
          <div className="space-y-4 text-xs">
            {detail.dangling.length > 0 && (
              <div role="alert" className="p-3 rounded-lg border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)] space-y-1">
                {detail.dangling.map((d) => (
                  <div key={`${d.policyId}-${d.selects}`}>
                    <strong className="font-mono">{d.policyName}</strong> ({d.policyType}) selects{' '}
                    <code>#{detail.name}</code> on {ATTR_KIND_LABEL[d.selects]}, but none carry it, so that part of the
                    policy matches nothing.
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {KINDS.map((k) => (
                <section key={k} className="p-3 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] space-y-1.5">
                  <div className="font-semibold capitalize">
                    {ATTR_KIND_LABEL[k]} ({detail.members[k].length})
                  </div>
                  {detail.members[k].length ? (
                    <ul className="m-0 p-0 list-none flex flex-wrap gap-1">
                      {detail.members[k].map((m) => (
                        <li key={m.id} className="px-2 py-0.5 rounded-md bg-[var(--ac-surface)] border border-[var(--ac-line)] font-mono">
                          {m.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[var(--ac-muted)]">—</div>
                  )}
                </section>
              ))}
            </div>

            <section className="space-y-1.5">
              <div className="font-semibold inline-flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[var(--ac-dial)]" />
                Policies selecting #{detail.name} ({detail.refs.length})
              </div>
              {detail.refs.length ? (
                <ul className="m-0 p-0 list-none space-y-1">
                  {detail.refs.map((ref) => (
                    <li key={`${ref.policyId}-${ref.selects}`} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">{ref.policyName}</span>
                      <span className="text-[var(--ac-muted)]">
                        {ref.policyType}, selecting {ATTR_KIND_LABEL[ref.selects]}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[var(--ac-muted)]">No policy selects this attribute, so it grants nothing yet.</p>
              )}
            </section>
          </div>
        </ModalDialog>
      )}
    </div>
  );
};
