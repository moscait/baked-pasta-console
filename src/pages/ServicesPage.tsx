import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Config, ConfigType, Service, Terminator } from '../services/api-types';
import { revertsOf, zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { ModalDialog } from '../components/ModalDialog';
import { AccessWizard } from '../features/access-canvas/AccessWizard';
import { AcModel } from '../features/access-canvas/access-canvas.logic';
import { ConfigPicker } from '../features/services/ConfigPicker';
import {
  KNOWN_SERVICE_CONFIG_TYPES,
  configTemplate,
  configTypeName,
  describeServiceEndpoint,
  duplicateTypes,
  parseConfigData,
  servicesByConfig,
} from '../features/services/service-configs';
import { ExternalLink, Lock, Sparkles } from 'lucide-react';

export const ServicesPage: React.FC<{
  initialTab?: 'services' | 'configs' | 'config-types' | 'terminators';
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ initialTab = 'services', onToast }) => {
  const [tab, setTab] = useState<'services' | 'configs' | 'config-types' | 'terminators'>(initialTab);
  const [services, setServices] = useState<Service[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [configTypes, setConfigTypes] = useState<ConfigType[]>([]);
  const [terminators, setTerminators] = useState<Terminator[]>([]);
  const [canvasModel, setCanvasModel] = useState<AcModel | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [svcModal, setSvcModal] = useState(false);
  const [editingSvc, setEditingSvc] = useState<Service | null>(null);
  const [svcName, setSvcName] = useState('');
  const [svcAttrs, setSvcAttrs] = useState('');
  const [svcConfigs, setSvcConfigs] = useState<string[]>([]);

  const [cfgModal, setCfgModal] = useState(false);
  const [editingCfg, setEditingCfg] = useState<Config | null>(null);
  const [cfgName, setCfgName] = useState('');
  const [cfgTypeId, setCfgTypeId] = useState('');
  const [cfgJson, setCfgJson] = useState('{}');
  const [cfgError, setCfgError] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const load = useCallback(async () => {
    try {
      const [svcs, cfgs, cts, terms, m] = await Promise.all([
        zitiService.list('services'),
        zitiService.list('configs'),
        zitiService.list('config-types'),
        zitiService.list('terminators'),
        zitiService.loadCanvasModel(),
      ]);
      setServices(svcs);
      setConfigs(cfgs);
      setConfigTypes(cts);
      setTerminators(terms);
      setCanvasModel(m);
    } catch (err) {
      onToast('error', 'Load failed', zitiService.errorText(err));
    }
  }, [onToast]);

  useEffect(() => {
    load();
    return zitiService.subscribe(load);
  }, [load]);

  const configMap = new Map(configs.map((c) => [c.id, c]));
  const usedBy = useMemo(() => servicesByConfig(services), [services]);

  /** Config types for the New Config select: known service types first, then the rest by name. */
  const typeOptions = useMemo(() => {
    const rank = (t: ConfigType) => {
      const i = KNOWN_SERVICE_CONFIG_TYPES.findIndex((k) => k.name === t.name);
      return i < 0 ? KNOWN_SERVICE_CONFIG_TYPES.length : i;
    };
    return [...configTypes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [configTypes]);

  const openNewConfig = () => {
    const first = typeOptions[0];
    setEditingCfg(null);
    setCfgName('');
    setCfgTypeId(first?.id || '');
    setCfgJson(configTemplate(first?.name || ''));
    setCfgError('');
    setCfgModal(true);
  };

  const openEditConfig = (row: Config) => {
    setEditingCfg(row);
    setCfgName(row.name);
    setCfgTypeId(row.configTypeId);
    setCfgJson(JSON.stringify(row.data ?? {}, null, 2));
    setCfgError('');
    setCfgModal(true);
  };

  const editingCfgUsers = editingCfg ? usedBy.get(editingCfg.id) || [] : [];

  const serviceColumns: ColumnDef<Service>[] = [
    {
      key: 'name',
      header: 'Service Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'endpoint',
      header: 'Access Endpoint',
      getValue: (r) => {
        const ep = describeServiceEndpoint(r, configMap);
        return ep.url || ep.interceptDisplay || '';
      },
      render: (r) => {
        const ep = describeServiceEndpoint(r, configMap);
        if (!ep.interceptDisplay && !ep.hostDisplay) {
          return <span className="text-xs text-[var(--ac-muted)]">No intercept config</span>;
        }
        return (
          <div className="space-y-0.5 text-xs">
            {ep.url ? (
              <a
                href={ep.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono font-semibold text-[var(--ac-dial)] hover:underline"
              >
                <span>{ep.url}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            ) : ep.interceptDisplay ? (
              <code className="font-mono font-semibold text-[var(--ac-ink)]">{ep.interceptDisplay}</code>
            ) : null}
            {ep.hostDisplay && (
              <div className="font-mono text-[11px] text-[var(--ac-muted)]">→ {ep.hostDisplay}</div>
            )}
          </div>
        );
      },
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
      key: 'configs',
      header: 'Attached Configs',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.configs || []).map((cid: string) => {
            const c = configMap.get(cid);
            return (
              <span
                key={cid}
                className="px-2 py-0.5 rounded bg-[var(--ac-bind-soft)] text-[var(--ac-bind)] font-mono text-xs"
              >
                {c ? c.name : cid}
              </span>
            );
          })}
        </div>
      ),
    },
    {
      key: 'encryptionRequired',
      header: 'Encryption',
      render: (r) => (
        <span className="inline-flex items-center gap-1 text-xs text-[var(--ac-ok)] font-medium">
          <Lock className="w-3.5 h-3.5" />
          {r.encryptionRequired !== false ? 'E2E Required' : 'Optional'}
        </span>
      ),
    },
  ];

  const configColumns: ColumnDef<Config>[] = [
    {
      key: 'name',
      header: 'Config Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      getValue: (r) => configTypeName(r, configTypes),
      render: (r) => (
        <span className="px-2 py-0.5 rounded bg-[var(--ac-surface-2)] font-mono text-xs">
          {configTypeName(r, configTypes)}
        </span>
      ),
    },
    {
      key: 'usedBy',
      header: 'Used By',
      getValue: (r) => (usedBy.get(r.id) || []).map((s) => s.name).join(', '),
      render: (r) => {
        const users = usedBy.get(r.id) || [];
        return users.length ? (
          <span className="font-mono text-xs">{users.map((s) => s.name).join(', ')}</span>
        ) : (
          <span className="text-xs text-[var(--ac-muted)]">No services</span>
        );
      },
    },
    {
      key: 'data',
      header: 'Endpoint / JSON Summary',
      render: (r) => (
        <code className="text-xs text-[var(--ac-muted)]">{JSON.stringify(r.data)}</code>
      ),
    },
  ];

  const configTypeColumns: ColumnDef<ConfigType>[] = [
    {
      key: 'name',
      header: 'Schema Type Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'id',
      header: 'ID',
      render: (r) => <span className="font-mono text-xs text-[var(--ac-muted)]">{r.id}</span>,
    },
  ];

  const terminatorColumns: ColumnDef<Terminator>[] = [
    {
      key: 'service',
      header: 'Service',
      getValue: (r) => r.service?.name || r.serviceId || '',
      render: (r) => <span className="font-semibold font-mono">{r.service?.name || r.serviceId}</span>,
    },
    {
      key: 'router',
      header: 'Edge Router',
      getValue: (r) => r.router?.name || r.routerId || '',
      render: (r) => <span className="font-mono text-xs">{r.router?.name || r.routerId}</span>,
    },
    {
      key: 'address',
      header: 'Binding Address',
      render: (r) => <code className="text-xs">{r.address}</code>,
    },
    {
      key: 'precedence',
      header: 'Precedence / Cost',
      render: (r) => (
        <span className="text-xs text-[var(--ac-muted)]">
          {r.precedence || 'default'} (cost {r.cost ?? 0})
        </span>
      ),
    },
  ];

  const headerTabs = (
    <div className="inline-flex rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] p-1 text-xs">
      {(
        [
          { id: 'services', label: `Services (${services.length})` },
          { id: 'configs', label: `Configs (${configs.length})` },
          { id: 'config-types', label: `Config Types (${configTypes.length})` },
          { id: 'terminators', label: `Terminators (${terminators.length})` },
        ] as const
      ).map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className={`px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
            tab === t.id
              ? 'bg-[var(--ac-dial)] text-white font-semibold'
              : 'text-[var(--ac-muted)] hover:text-[var(--ac-ink)]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight m-0">Services & Configurations</h1>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Zero-trust applications, intercept/host configurations, and live service terminators.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--ac-bind)] text-white text-xs font-semibold shadow-sm hover:opacity-95 cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          <span>Guided Service Wizard</span>
        </button>
      </div>

      {tab === 'services' && (
        <DataTable
          caption="OpenZiti Services"
          data={services}
          columns={serviceColumns}
          headerTabs={headerTabs}
          createLabel="New Service"
          onCreate={() => {
            setEditingSvc(null);
            setSvcName('');
            setSvcAttrs('');
            setSvcConfigs([]);
            setSvcModal(true);
          }}
          onEdit={(row) => {
            setEditingSvc(row);
            setSvcName(row.name);
            setSvcAttrs((row.roleAttributes || []).join(', '));
            setSvcConfigs(row.configs || []);
            setSvcModal(true);
          }}
          onDelete={async (row) => {
            await zitiService.remove('services', row.id);
            onToast('info', 'Service deleted', row.name);
            await load();
          }}
        />
      )}

      {tab === 'configs' && (
        <DataTable
          caption="OpenZiti Configurations"
          data={configs}
          columns={configColumns}
          headerTabs={headerTabs}
          createLabel="New Config"
          onCreate={openNewConfig}
          onEdit={openEditConfig}
          onDelete={async (row) => {
            await zitiService.remove('configs', row.id);
            onToast('info', 'Config deleted', row.name);
            await load();
          }}
        />
      )}

      {tab === 'config-types' && (
        <DataTable
          caption="Config Types"
          data={configTypes}
          columns={configTypeColumns}
          headerTabs={headerTabs}
        />
      )}

      {tab === 'terminators' && (
        <DataTable
          caption="Terminators"
          data={terminators}
          columns={terminatorColumns}
          headerTabs={headerTabs}
          onDelete={async (row) => {
            await zitiService.remove('terminators', row.id);
            onToast('info', 'Terminator deleted', row.id);
            await load();
          }}
        />
      )}

      {/* Guided Service Wizard */}
      {wizardOpen && canvasModel && (
        <AccessWizard
          open={wizardOpen}
          model={canvasModel}
          onClose={() => setWizardOpen(false)}
          onQueued={async (plan) => {
            try {
              await zitiService.applyCanvasOps(plan.ops);
              setWizardOpen(false);
              onToast('success', 'Service set up end-to-end!', plan.summary);
            } catch (err) {
              // Roll back what was created so a failed setup does not leave half a service behind.
              const failures = await zitiService.revertCanvasOps(revertsOf(err));
              const msg = failures.length
                ? `${zitiService.errorText(err)}. Rolling back also failed: ${zitiService.describeRevertFailures(failures)}`
                : `${zitiService.errorText(err)}. Nothing was kept.`;
              onToast('error', 'Failed to apply wizard', msg);
              throw new Error(msg);
            } finally {
              await load();
            }
          }}
        />
      )}

      {/* Quick Service Modal */}
      <ModalDialog
        open={svcModal}
        onClose={() => setSvcModal(false)}
        title={editingSvc ? `Edit Service: ${editingSvc.name}` : 'Create Service'}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const dupes = duplicateTypes(svcConfigs, configs, configTypes);
            if (dupes.length) {
              onToast('warning', 'One config per type', `Choose a single ${dupes.join(', ')} config before saving.`);
              return;
            }
            const roleAttributes = svcAttrs
              .split(/[,\s]+/)
              .map((s) => s.trim().replace(/^#/, ''))
              .filter(Boolean);
            try {
              if (editingSvc) {
                await zitiService.patch('services', editingSvc.id, {
                  name: svcName.trim(),
                  roleAttributes,
                  configs: svcConfigs,
                });
                onToast('success', 'Service updated', svcName.trim());
              } else {
                await zitiService.create('services', {
                  name: svcName.trim(),
                  roleAttributes,
                  configs: svcConfigs,
                  encryptionRequired: true,
                  terminatorStrategy: 'smartrouting',
                });
                onToast('success', 'Service created', svcName.trim());
              }
              setSvcModal(false);
              await load();
            } catch (err) {
              onToast('error', 'Save failed', zitiService.errorText(err));
            }
          }}
          className="space-y-4 text-xs"
        >
          <label className="block space-y-1">
            <span className="font-medium">Service Name</span>
            <input
              required
              value={svcName}
              onChange={(e) => setSvcName(e.target.value)}
              placeholder="e.g. crm-https"
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Role Attributes</span>
            <input
              value={svcAttrs}
              onChange={(e) => setSvcAttrs(e.target.value)}
              placeholder="e.g. web, crm-https"
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          <div className="space-y-1">
            <span className="font-medium">Attached Configurations</span>
            <p className="m-0 text-[var(--ac-muted)]">
              At most one config of each type. Configs are shared: edit their contents on the Configs tab.
            </p>
            <ConfigPicker
              configs={configs}
              configTypes={configTypes}
              services={services}
              serviceId={editingSvc?.id}
              selected={svcConfigs}
              onChange={setSvcConfigs}
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ac-line)]">
            <button
              type="button"
              onClick={() => setSvcModal(false)}
              className="px-4 py-2 rounded-lg border border-[var(--ac-line)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
            >
              Save Service
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Create / Edit Config Modal */}
      <ModalDialog
        open={cfgModal}
        onClose={() => setCfgModal(false)}
        title={editingCfg ? `Edit Configuration: ${editingCfg.name}` : 'Create Configuration'}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = parseConfigData(cfgJson);
            if ('error' in parsed) {
              setCfgError(parsed.error);
              return;
            }
            setCfgError('');
            const name = cfgName.trim();
            try {
              if (editingCfg) {
                // The type of an existing config cannot change; only its name and data.
                await zitiService.patch('configs', editingCfg.id, { name, data: parsed.data });
                onToast('success', 'Configuration updated', name);
              } else {
                const type = configTypes.find((t) => t.id === cfgTypeId);
                if (!type) {
                  setCfgError('Choose a config type. The controller reported none.');
                  return;
                }
                await zitiService.create('configs', { name, configTypeId: type.id, data: parsed.data });
                onToast('success', 'Configuration created', name);
              }
              setCfgModal(false);
              await load();
            } catch (err) {
              // The controller validates data against the type's schema; show its reason.
              setCfgError(zitiService.errorText(err));
              onToast('error', 'Save failed', zitiService.errorText(err));
            }
          }}
          className="space-y-4 text-xs"
        >
          <label className="block space-y-1">
            <span className="font-medium">Configuration Name</span>
            <input
              required
              value={cfgName}
              onChange={(e) => setCfgName(e.target.value)}
              placeholder="e.g. app.intercept.v1"
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Config Type</span>
            {editingCfg ? (
              <div className="px-3 py-2 rounded-lg border border-[var(--ac-line)] text-sm font-mono text-[var(--ac-muted)]">
                {configTypeName(editingCfg, configTypes)} (cannot be changed)
              </div>
            ) : (
              <select
                value={cfgTypeId}
                onChange={(e) => {
                  const t = configTypes.find((x) => x.id === e.target.value);
                  setCfgTypeId(e.target.value);
                  setCfgJson(configTemplate(t?.name || ''));
                  setCfgError('');
                }}
                className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
              >
                {!typeOptions.length && <option value="">No config types on this controller</option>}
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          {editingCfg && editingCfgUsers.length > 0 && (
            <p className="m-0 px-3 py-2 rounded-lg bg-[var(--ac-pending-soft)]">
              Used by {editingCfgUsers.map((s) => s.name).join(', ')}. Changes apply to every one of them.
            </p>
          )}
          <label className="block space-y-1">
            <span className="font-medium">Data (JSON object)</span>
            <textarea
              rows={10}
              value={cfgJson}
              onChange={(e) => {
                setCfgJson(e.target.value);
                if (cfgError) setCfgError('');
              }}
              spellCheck={false}
              aria-invalid={cfgError ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono text-xs"
            />
          </label>
          {cfgError && (
            <p role="alert" className="m-0 px-3 py-2 rounded-lg bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]">
              {cfgError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ac-line)]">
            <button
              type="button"
              onClick={() => setCfgModal(false)}
              className="px-4 py-2 rounded-lg border border-[var(--ac-line)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
            >
              {editingCfg ? 'Save Config' : 'Create Config'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
};
