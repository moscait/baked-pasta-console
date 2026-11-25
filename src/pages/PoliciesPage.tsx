import React, { useCallback, useEffect, useState } from 'react';
import type { EdgeRouterPolicy, ServiceEdgeRouterPolicy, ServicePolicy } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { ModalDialog } from '../components/ModalDialog';
import { useCreateIntent } from '../components/useCreateIntent';

type PolicyTab = 'service-policies' | 'edge-router-policies' | 'service-edge-router-policies';

export const PoliciesPage: React.FC<{
  initialTab?: PolicyTab;
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ initialTab = 'service-policies', onToast }) => {
  const [tab, setTab] = useState<PolicyTab>(initialTab);
  const [servicePolicies, setServicePolicies] = useState<ServicePolicy[]>([]);
  const [erPolicies, setErPolicies] = useState<EdgeRouterPolicy[]>([]);
  const [serpPolicies, setSerpPolicies] = useState<ServiceEdgeRouterPolicy[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'Dial' | 'Bind'>('Dial');
  const [semantic, setSemantic] = useState<'AnyOf' | 'AllOf'>('AnyOf');
  const [leftRoles, setLeftRoles] = useState('#all');
  const [rightRoles, setRightRoles] = useState('#all');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const openNewServicePolicy = () => {
    setTab('service-policies');
    setName('');
    setType('Dial');
    setLeftRoles('#employees');
    setRightRoles('#web');
    setModalOpen(true);
  };

  useCreateIntent({ 'service-policy': openNewServicePolicy });

  const load = useCallback(async () => {
    try {
      const [sps, erps, serps] = await Promise.all([
        zitiService.list('service-policies'),
        zitiService.list('edge-router-policies'),
        zitiService.list('service-edge-router-policies'),
      ]);
      setServicePolicies(sps);
      setErPolicies(erps);
      setSerpPolicies(serps);
    } catch (err) {
      onToast('error', 'Failed to load policies', zitiService.errorText(err));
    }
  }, [onToast]);

  useEffect(() => {
    load();
    return zitiService.subscribe(load);
  }, [load]);

  const roleBadges = (roles: string[] = []) => (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span
          key={r}
          className="px-2 py-0.5 rounded bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-xs"
        >
          {r}
        </span>
      ))}
    </div>
  );

  const spColumns: ColumnDef<ServicePolicy>[] = [
    {
      key: 'name',
      header: 'Policy Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <span
          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            r.type === 'Dial'
              ? 'bg-[var(--ac-dial-soft)] text-[var(--ac-dial)]'
              : 'bg-[var(--ac-bind-soft)] text-[var(--ac-bind)]'
          }`}
        >
          {r.type}
        </span>
      ),
    },
    {
      key: 'identityRoles',
      header: 'Identity Roles',
      getValue: (r) => (r.identityRoles || []).join(', '),
      render: (r) => roleBadges(r.identityRoles),
    },
    {
      key: 'serviceRoles',
      header: 'Service Roles',
      getValue: (r) => (r.serviceRoles || []).join(', '),
      render: (r) => roleBadges(r.serviceRoles),
    },
    {
      key: 'semantic',
      header: 'Semantic',
      render: (r) => <span className="text-xs font-mono text-[var(--ac-muted)]">{r.semantic || 'AnyOf'}</span>,
    },
  ];

  const erpColumns: ColumnDef<EdgeRouterPolicy>[] = [
    {
      key: 'name',
      header: 'Router Policy Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'identityRoles',
      header: 'Identity Roles',
      render: (r) => roleBadges(r.identityRoles),
    },
    {
      key: 'edgeRouterRoles',
      header: 'Edge Router Roles',
      render: (r) => roleBadges(r.edgeRouterRoles),
    },
    {
      key: 'semantic',
      header: 'Semantic',
      render: (r) => <span className="text-xs font-mono text-[var(--ac-muted)]">{r.semantic || 'AnyOf'}</span>,
    },
  ];

  const serpColumns: ColumnDef<ServiceEdgeRouterPolicy>[] = [
    {
      key: 'name',
      header: 'Service Router Policy Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'serviceRoles',
      header: 'Service Roles',
      render: (r) => roleBadges(r.serviceRoles),
    },
    {
      key: 'edgeRouterRoles',
      header: 'Edge Router Roles',
      render: (r) => roleBadges(r.edgeRouterRoles),
    },
    {
      key: 'semantic',
      header: 'Semantic',
      render: (r) => <span className="text-xs font-mono text-[var(--ac-muted)]">{r.semantic || 'AnyOf'}</span>,
    },
  ];

  const headerTabs = (
    <div className="inline-flex rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] p-1 text-xs">
      {(
        [
          { id: 'service-policies', label: `Service Policies (${servicePolicies.length})` },
          { id: 'edge-router-policies', label: `Router Policies (${erPolicies.length})` },
          { id: 'service-edge-router-policies', label: `Service Router Policies (${serpPolicies.length})` },
        ] as const
      ).map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className={`px-3 py-1.5 rounded-lg cursor-pointer ${
            tab === t.id ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const normalizeRoles = (raw: string) =>
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('#') || s.startsWith('@') ? s : `#${s}`));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight m-0">Access & Routing Policies</h1>
        <p className="text-xs text-[var(--ac-muted)] m-0">
          Attribute-based Dial, Bind, Edge Router, and Service Edge Router policies.
        </p>
      </div>

      {tab === 'service-policies' && (
        <DataTable
          caption="Service Policies"
          data={servicePolicies}
          columns={spColumns}
          headerTabs={headerTabs}
          createLabel="New Service Policy"
          onCreate={openNewServicePolicy}
          onDelete={async (row) => {
            await zitiService.remove('service-policies', row.id);
            onToast('info', 'Service policy deleted', row.name);
            await load();
          }}
        />
      )}

      {tab === 'edge-router-policies' && (
        <DataTable
          caption="Edge Router Policies"
          data={erPolicies}
          columns={erpColumns}
          headerTabs={headerTabs}
          createLabel="New Router Policy"
          onCreate={() => {
            setName('');
            setLeftRoles('#all');
            setRightRoles('#public');
            setModalOpen(true);
          }}
          onDelete={async (row) => {
            await zitiService.remove('edge-router-policies', row.id);
            onToast('info', 'Router policy deleted', row.name);
            await load();
          }}
        />
      )}

      {tab === 'service-edge-router-policies' && (
        <DataTable
          caption="Service Edge Router Policies"
          data={serpPolicies}
          columns={serpColumns}
          headerTabs={headerTabs}
          createLabel="New Service Router Policy"
          onCreate={() => {
            setName('');
            setLeftRoles('#all');
            setRightRoles('#public');
            setModalOpen(true);
          }}
          onDelete={async (row) => {
            await zitiService.remove('service-edge-router-policies', row.id);
            onToast('info', 'Service router policy deleted', row.name);
            await load();
          }}
        />
      )}

      <ModalDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          tab === 'service-policies'
            ? 'Create Service Policy'
            : tab === 'edge-router-policies'
              ? 'Create Edge Router Policy'
              : 'Create Service Edge Router Policy'
        }
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (tab === 'service-policies') {
                await zitiService.create('service-policies', {
                  name: name.trim(),
                  type,
                  semantic,
                  identityRoles: normalizeRoles(leftRoles),
                  serviceRoles: normalizeRoles(rightRoles),
                  postureCheckRoles: [],
                });
              } else if (tab === 'edge-router-policies') {
                await zitiService.create('edge-router-policies', {
                  name: name.trim(),
                  semantic,
                  identityRoles: normalizeRoles(leftRoles),
                  edgeRouterRoles: normalizeRoles(rightRoles),
                });
              } else {
                await zitiService.create('service-edge-router-policies', {
                  name: name.trim(),
                  semantic,
                  serviceRoles: normalizeRoles(leftRoles),
                  edgeRouterRoles: normalizeRoles(rightRoles),
                });
              }
              onToast('success', 'Policy created', name.trim());
              setModalOpen(false);
              await load();
            } catch (err) {
              onToast('error', 'Save failed', zitiService.errorText(err));
            }
          }}
          className="space-y-4 text-xs"
        >
          <label className="block space-y-1">
            <span className="font-medium">Policy Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. developers-dial-api"
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          {tab === 'service-policies' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="font-medium">Type</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as 'Dial' | 'Bind')}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
                >
                  <option value="Dial">Dial (Client Use)</option>
                  <option value="Bind">Bind (Server Host)</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="font-medium">Role Matching Semantic</span>
                <select
                  value={semantic}
                  onChange={(e) => setSemantic(e.target.value as 'AnyOf' | 'AllOf')}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
                >
                  <option value="AnyOf">AnyOf (OR)</option>
                  <option value="AllOf">AllOf (AND)</option>
                </select>
              </label>
            </div>
          )}
          <label className="block space-y-1">
            <span className="font-medium">
              {tab === 'service-edge-router-policies' ? 'Service Roles' : 'Identity Roles'}
            </span>
            <input
              value={leftRoles}
              onChange={(e) => setLeftRoles(e.target.value)}
              placeholder="#employees, #sales or #all"
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">
              {tab === 'service-policies' ? 'Service Roles' : 'Edge Router Roles'}
            </span>
            <input
              value={rightRoles}
              onChange={(e) => setRightRoles(e.target.value)}
              placeholder={tab === 'service-policies' ? '#web, #crm-https' : '#public or #all'}
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
              Create Policy
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
};
