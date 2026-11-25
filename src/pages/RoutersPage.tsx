import React, { useCallback, useEffect, useState } from 'react';
import type { EdgeRouter, TransitRouter } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { ModalDialog } from '../components/ModalDialog';
import { useCreateIntent } from '../components/useCreateIntent';

export const RoutersPage: React.FC<{
  initialTab?: 'edge-routers' | 'transit-routers';
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ initialTab = 'edge-routers', onToast }) => {
  const [tab, setTab] = useState<'edge-routers' | 'transit-routers'>(initialTab);
  const [edgeRouters, setEdgeRouters] = useState<EdgeRouter[]>([]);
  const [transitRouters, setTransitRouters] = useState<TransitRouter[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EdgeRouter | null>(null);
  const [name, setName] = useState('');
  const [attrsText, setAttrsText] = useState('');
  const [cost, setCost] = useState(0);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const openNewEdgeRouter = () => {
    setTab('edge-routers');
    setEditing(null);
    setName('');
    setAttrsText('public');
    setCost(0);
    setModalOpen(true);
  };

  useCreateIntent({ 'edge-router': openNewEdgeRouter });

  const load = useCallback(async () => {
    try {
      const [ers, trs] = await Promise.all([
        zitiService.list('edge-routers'),
        zitiService.list('transit-routers'),
      ]);
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

  const edgeColumns: ColumnDef<EdgeRouter>[] = [
    {
      key: 'name',
      header: 'Edge Router Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'roleAttributes',
      header: 'Role Attributes',
      getValue: (r) => (r.roleAttributes || []).join(', '),
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.roleAttributes || []).map((a: string) => (
            <span
              key={a}
              className="px-2 py-0.5 rounded-md bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-xs"
            >
              #{a}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'isOnline',
      header: 'Status',
      getValue: (r) => (r.isOnline ? 'Online' : 'Offline'),
      render: (r) => (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
            r.isOnline ? 'bg-[var(--ac-ok-soft)] text-[var(--ac-ok)]' : 'bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${r.isOnline ? 'bg-[var(--ac-ok)]' : 'bg-[var(--ac-bad)]'}`} />
          {r.isOnline ? 'Online' : 'Offline'}
        </span>
      ),
    },
    {
      key: 'cost',
      header: 'Routing Cost',
      type: 'number',
      getValue: (r) => r.cost ?? 0,
      render: (r) => <span className="font-mono text-xs">{r.cost ?? 0}</span>,
    },
    {
      key: 'version',
      header: 'Version',
      getValue: (r) => r.versionInfo?.version || '',
      render: (r) => <span className="font-mono text-xs text-[var(--ac-muted)]">{r.versionInfo?.version || '—'}</span>,
    },
  ];

  const transitColumns: ColumnDef<TransitRouter>[] = [
    {
      key: 'name',
      header: 'Transit Router Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'isOnline',
      header: 'Status',
      render: (r) => (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
            r.isOnline ? 'bg-[var(--ac-ok-soft)] text-[var(--ac-ok)]' : 'bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]'
          }`}
        >
          {r.isOnline ? 'Online' : 'Offline'}
        </span>
      ),
    },
    {
      key: 'cost',
      header: 'Cost',
      type: 'number',
      render: (r) => <span className="font-mono text-xs">{r.cost ?? 0}</span>,
    },
  ];

  const headerTabs = (
    <div className="inline-flex rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] p-1 text-xs">
      <button
        type="button"
        onClick={() => setTab('edge-routers')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'edge-routers' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        Edge Routers ({edgeRouters.length})
      </button>
      <button
        type="button"
        onClick={() => setTab('transit-routers')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'transit-routers' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        Transit Routers ({transitRouters.length})
      </button>
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
          onEdit={(row) => {
            setEditing(row);
            setName(row.name);
            setAttrsText((row.roleAttributes || []).join(', '));
            setCost(row.cost ?? 0);
            setModalOpen(true);
          }}
          onDelete={async (row) => {
            await zitiService.remove('edge-routers', row.id);
            onToast('info', 'Edge Router deleted', row.name);
            await load();
          }}
        />
      ) : (
        <DataTable
          caption="OpenZiti Transit Routers"
          data={transitRouters}
          columns={transitColumns}
          headerTabs={headerTabs}
        />
      )}

      <ModalDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Edge Router: ${editing.name}` : 'Create Edge Router'}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const roleAttributes = attrsText
              .split(/[,\s]+/)
              .map((s) => s.trim().replace(/^#/, ''))
              .filter(Boolean);
            try {
              if (editing) {
                await zitiService.patch('edge-routers', editing.id, {
                  name: name.trim(),
                  roleAttributes,
                  cost,
                });
                onToast('success', 'Edge Router updated', name.trim());
              } else {
                await zitiService.create('edge-routers', {
                  name: name.trim(),
                  roleAttributes,
                  cost,
                  isTunnelerEnabled: true,
                });
                onToast('success', 'Edge Router created', name.trim());
              }
              setModalOpen(false);
              await load();
            } catch (err) {
              onToast('error', 'Save failed', zitiService.errorText(err));
            }
          }}
          className="space-y-4 text-xs"
        >
          <label className="block space-y-1">
            <span className="font-medium">Router Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. us-west-edge-01"
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Role Attributes</span>
            <input
              value={attrsText}
              onChange={(e) => setAttrsText(e.target.value)}
              placeholder="e.g. public, us-west"
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Routing Cost</span>
            <input
              type="number"
              min={0}
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ac-line)]">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[var(--ac-line)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
            >
              Save Router
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
};
