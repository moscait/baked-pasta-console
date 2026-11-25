import React, { useCallback, useEffect, useState } from 'react';
import { QrCode, RotateCcw } from 'lucide-react';
import type { EdgeRouter, TransitRouter } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useCreateIntent } from '../components/useCreateIntent';
import { RouterFormDialog, RouterJwtDialog } from '../features/routers/RouterDialogs';
import { RouterKind, awaitingEnrollment } from '../features/routers/router-form.logic';

type AnyRouter = EdgeRouter | TransitRouter;
type Toast = (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;

const statusOf = (r: AnyRouter) => (r.isOnline ? 'Online' : awaitingEnrollment(r) ? 'Awaiting enrollment' : 'Offline');

const StatusBadge: React.FC<{ router: AnyRouter }> = ({ router }) => {
  const status = statusOf(router);
  const tone =
    status === 'Online'
      ? 'bg-[var(--ac-ok-soft)] text-[var(--ac-ok)]'
      : status === 'Awaiting enrollment'
        ? 'bg-[var(--ac-pending-soft)] text-[var(--ac-pending)]'
        : 'bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${tone}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
};

const actionBtn =
  'p-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer';

export const RoutersPage: React.FC<{ initialTab?: RouterKind; onToast: Toast }> = ({ initialTab = 'edge-routers', onToast }) => {
  const [tab, setTab] = useState<RouterKind>(initialTab);
  const [edgeRouters, setEdgeRouters] = useState<EdgeRouter[]>([]);
  const [transitRouters, setTransitRouters] = useState<TransitRouter[]>([]);
  const [form, setForm] = useState<{ kind: RouterKind; editing: AnyRouter | null } | null>(null);
  const [jwtForId, setJwtForId] = useState<string | null>(null);
  const [reEnroll, setReEnroll] = useState<{ kind: RouterKind; router: AnyRouter } | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const openNewEdgeRouter = () => {
    setTab('edge-routers');
    setForm({ kind: 'edge-routers', editing: null });
  };

  useCreateIntent({ 'edge-router': openNewEdgeRouter });

  const load = useCallback(async () => {
    try {
      const [ers, trs] = await Promise.all([zitiService.list('edge-routers'), zitiService.list('transit-routers')]);
      setEdgeRouters(ers);
      setTransitRouters(trs);
    } catch (err) {
      onToast('error', 'Failed to load routers', zitiService.errorText(err));
    }
  }, [onToast]);

  useEffect(() => {
    load();
    return zitiService.subscribe(load);
  }, [load]);

  const remove = (kind: RouterKind) => async (row: AnyRouter) => {
    await zitiService.remove(kind, row.id);
    onToast('info', kind === 'edge-routers' ? 'Edge Router deleted' : 'Transit Router deleted', row.name);
    await load();
  };

  const rowActions = (kind: RouterKind) => (row: AnyRouter) => (
    <>
      {row.enrollmentJwt && (
        <button
          type="button"
          onClick={() => setJwtForId(row.id)}
          title="Enrollment JWT"
          aria-label={`Enrollment JWT for ${row.name}`}
          className="p-1.5 rounded-lg border border-[var(--ac-dial)]/40 bg-[var(--ac-dial-soft)] text-[var(--ac-dial)] cursor-pointer"
        >
          <QrCode className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setReEnroll({ kind, router: row })}
        title="Re-enroll: revoke the router's certificate and issue a new enrollment JWT"
        aria-label={`Re-enroll ${row.name}`}
        className={actionBtn}
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </>
  );

  const statusColumn: ColumnDef<AnyRouter> = {
    key: 'isOnline',
    header: 'Status',
    getValue: statusOf,
    render: (r) => <StatusBadge router={r} />,
  };
  const costColumn: ColumnDef<AnyRouter> = {
    key: 'cost',
    header: 'Cost',
    type: 'number',
    getValue: (r) => r.cost ?? 0,
    render: (r) => <span className="font-mono text-xs">{r.cost ?? 0}</span>,
  };

  const edgeColumns: ColumnDef<EdgeRouter>[] = [
    { key: 'name', header: 'Edge Router Name', render: (r) => <span className="font-semibold font-mono">{r.name}</span> },
    {
      key: 'roleAttributes',
      header: 'Role Attributes',
      getValue: (r) => (r.roleAttributes || []).join(', '),
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.roleAttributes || []).map((a) => (
            <span key={a} className="px-2 py-0.5 rounded-md bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-xs">
              #{a}
            </span>
          ))}
        </div>
      ),
    },
    statusColumn,
    {
      key: 'isTunnelerEnabled',
      header: 'Tunneler',
      getValue: (r) => (r.isTunnelerEnabled ? 'Enabled' : 'Off'),
    },
    costColumn,
    {
      key: 'version',
      header: 'Version',
      getValue: (r) => r.versionInfo?.version || '',
      render: (r) => <span className="font-mono text-xs text-[var(--ac-muted)]">{r.versionInfo?.version || '—'}</span>,
    },
  ];

  const transitColumns: ColumnDef<TransitRouter>[] = [
    { key: 'name', header: 'Transit Router Name', render: (r) => <span className="font-semibold font-mono">{r.name}</span> },
    statusColumn,
    costColumn,
    { key: 'noTraversal', header: 'Traversal', getValue: (r) => (r.noTraversal ? 'No traversal' : 'Allowed') },
  ];

  // Looked up from the latest lists so the dialog shows the current token after a re-enroll.
  const jwtRouter = jwtForId
    ? [...edgeRouters, ...transitRouters].find((r) => r.id === jwtForId) || null
    : null;

  const tabButton = (kind: RouterKind, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setTab(kind)}
      className={`px-3 py-1.5 rounded-lg cursor-pointer ${
        tab === kind ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
      }`}
    >
      {label} ({count})
    </button>
  );
  const headerTabs = (
    <div className="inline-flex rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] p-1 text-xs">
      {tabButton('edge-routers', 'Edge Routers', edgeRouters.length)}
      {tabButton('transit-routers', 'Transit Routers', transitRouters.length)}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight m-0">Edge & Fabric Routers</h1>
        <p className="text-xs text-[var(--ac-muted)] m-0">
          Mesh overlay routers that transport and terminate encrypted zero-trust traffic.
        </p>
      </div>

      {tab === 'edge-routers' ? (
        <DataTable
          caption="OpenZiti Edge Routers"
          data={edgeRouters}
          columns={edgeColumns}
          headerTabs={headerTabs}
          createLabel="New Edge Router"
          onCreate={openNewEdgeRouter}
          onEdit={(row) => setForm({ kind: 'edge-routers', editing: row })}
          onDelete={remove('edge-routers')}
          extraActions={rowActions('edge-routers')}
          bulkDelete
        />
      ) : (
        <DataTable
          caption="OpenZiti Transit Routers"
          data={transitRouters}
          columns={transitColumns}
          headerTabs={headerTabs}
          createLabel="New Transit Router"
          onCreate={() => setForm({ kind: 'transit-routers', editing: null })}
          onEdit={(row) => setForm({ kind: 'transit-routers', editing: row })}
          onDelete={remove('transit-routers')}
          extraActions={rowActions('transit-routers')}
          bulkDelete
        />
      )}

      {form && (
        <RouterFormDialog
          kind={form.kind}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={(title, name) => onToast('success', title, name)}
        />
      )}
      {jwtRouter && <RouterJwtDialog router={jwtRouter} onClose={() => setJwtForId(null)} />}
      {reEnroll && (
        <ConfirmDialog
          title={`Re-enroll ${reEnroll.router.name}?`}
          confirmLabel="Re-enroll"
          onClose={() => setReEnroll(null)}
          onConfirm={async () => {
            await zitiService.reEnrollRouter(reEnroll.kind, reEnroll.router);
            onToast('success', 'Router re-enrolled', `${reEnroll.router.name} has a new enrollment JWT.`);
            setJwtForId(reEnroll.router.id);
          }}
        >
          <p className="m-0">
            The router's certificate is revoked now. If it is connected it disconnects, and it stays offline until it
            enrolls again with the new JWT.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
};
