import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type {
  AuthPolicy,
  CertificateAuthority,
  Config,
  HostingPrecedence,
  Identity,
  Service,
  ServiceConfigOverride,
} from '../../services/api-types';
import { zitiService } from '../../services/ziti-service';
import { useServiceLoad } from '../../components/state-hooks';
import { ModalDialog } from '../../components/ModalDialog';
import {
  CheckField,
  ErrorList,
  Field,
  FormActions,
  FormSection,
  JsonObjectField,
  inputCls,
  useDraft,
  useFormSubmit,
} from '../../components/form';
import {
  ENROLLMENT_METHODS,
  EnrollmentMethod,
  HOSTING_PRECEDENCES,
  identityBody,
  identityDraft,
} from './identity-form.logic';

/** Create or edit an identity. Mount it when opening so the draft starts fresh. */
export const IdentityFormDialog: React.FC<{
  editing: Identity | null;
  onClose: () => void;
  onSaved: (title: string, detail: string) => void;
}> = ({ editing, onClose, onSaved }) => {
  const [draft, set] = useDraft(() => identityDraft(editing || undefined));
  const [cas, setCas] = useState<CertificateAuthority[]>([]);
  const [policies, setPolicies] = useState<AuthPolicy[]>([]);
  const [lookupError, setLookupError] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([zitiService.list('cas'), zitiService.list('auth-policies')])
      .then(([c, p]) => {
        if (!live) return;
        setCas(c);
        setPolicies(p);
      })
      .catch((err) => live && setLookupError(`Couldn't load CAs and auth policies: ${zitiService.errorText(err)}`));
    return () => {
      live = false;
    };
  }, []);

  const { errors, busy, submit } = useFormSubmit(
    () => identityBody(draft, !editing),
    async (body) => {
      if (editing) {
        await zitiService.patch('identities', editing.id, body);
        onSaved('Identity updated', body.name);
      } else {
        await zitiService.create('identities', body);
        onSaved('Identity created', draft.enrollment === 'none' ? body.name : `${body.name} is ready for enrollment.`);
      }
    },
    onClose,
  );

  return (
    <ModalDialog open wide onClose={onClose} title={editing ? `Edit Identity: ${editing.name}` : 'Create Identity'}>
      <form onSubmit={submit} className="space-y-4 text-xs" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Identity name">
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. jdoe-laptop or billing-db-host"
              className={inputCls}
            />
          </Field>
          <Field label="Role attributes" hint={<>Policies grant Dial or Bind access by these, e.g. <code>#sales</code>.</>}>
            <input
              value={draft.roleAttributes}
              onChange={(e) => set('roleAttributes', e.target.value)}
              placeholder="e.g. sales, employees, ssh-users"
              className={inputCls}
            />
          </Field>
        </div>
        <CheckField
          label="Admin"
          checked={draft.isAdmin}
          onChange={(v) => set('isAdmin', v)}
          hint="Full Edge Management API privileges."
          disabled={!!editing?.isDefaultAdmin}
        />

        {!editing && (
          <FormSection title="Enrollment">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Method">
                <select
                  value={draft.enrollment}
                  onChange={(e) => set('enrollment', e.target.value as EnrollmentMethod)}
                  className={inputCls}
                >
                  {ENROLLMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              {draft.enrollment === 'ottca' && (
                <Field label="Certificate authority">
                  <select value={draft.enrollmentCaId} onChange={(e) => set('enrollmentCaId', e.target.value)} className={inputCls}>
                    <option value="">Choose a CA…</option>
                    {cas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {draft.enrollment === 'updb' && (
                <Field label="Username">
                  <input
                    value={draft.enrollmentUsername}
                    onChange={(e) => set('enrollmentUsername', e.target.value)}
                    className={inputCls}
                  />
                </Field>
              )}
            </div>
          </FormSection>
        )}

        <FormSection title="Authentication">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Auth policy">
              <select value={draft.authPolicyId} onChange={(e) => set('authPolicyId', e.target.value)} className={inputCls}>
                {!draft.authPolicyId && <option value="">Controller default</option>}
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="External ID" hint="Matched by JWT signers and CAs that map users by external ID.">
              <input value={draft.externalId} onChange={(e) => set('externalId', e.target.value)} className={inputCls} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Hosting defaults">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Default hosting cost" hint="0–65535, applied to services this identity hosts.">
              <input
                inputMode="numeric"
                value={draft.defaultHostingCost}
                onChange={(e) => set('defaultHostingCost', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Default hosting precedence">
              <select
                value={draft.defaultHostingPrecedence}
                onChange={(e) => set('defaultHostingPrecedence', e.target.value as HostingPrecedence)}
                className={inputCls}
              >
                {HOSTING_PRECEDENCES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>
        </FormSection>

        <JsonObjectField
          label="App data"
          value={draft.appData}
          onChange={(v) => set('appData', v)}
          hint="Free-form JSON that SDK applications can read about themselves."
        />

        <ErrorList errors={lookupError ? [lookupError, ...errors] : errors} />
        <FormActions onCancel={onClose} submitLabel={editing ? 'Save changes' : 'Create identity'} busy={busy} />
      </form>
    </ModalDialog>
  );
};

/** Per-identity service config overrides (`identities/{id}/service-configs`). */
export const ConfigOverridesDialog: React.FC<{
  identity: Identity;
  onClose: () => void;
  onChanged: (title: string, detail: string) => void;
}> = ({ identity, onClose, onChanged }) => {
  const [overrides, setOverrides] = useState<ServiceConfigOverride[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [configId, setConfigId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Loads once per mount; the page keys this dialog by identity, so a different identity remounts it.
  const load = useServiceLoad(
    () =>
      Promise.all([
        zitiService.listServiceConfigOverrides(identity.id),
        zitiService.list('services'),
        zitiService.list('configs'),
      ]),
    ([o, s, c]) => {
      setOverrides(o);
      setServices(s);
      setConfigs(c);
    },
    (err) => {
      setError(zitiService.errorText(err));
      setOverrides((prev) => prev || []);
    },
    { onChange: false },
  );

  const serviceName = (o: ServiceConfigOverride) =>
    o.service?.name || services.find((s) => s.id === o.serviceId)?.name || o.serviceId;
  const configOf = (o: ServiceConfigOverride) => configs.find((c) => c.id === o.configId);
  const configLabel = (c: Config | undefined, fallback: string) =>
    c ? `${c.name} (${c.configType?.name || c.configTypeId})` : fallback;
  const exists = !!overrides?.some((o) => o.serviceId === serviceId && o.configId === configId);

  const change = async (action: () => Promise<void>, title: string, detail: string) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged(title, detail);
      await load();
    } catch (err) {
      setError(zitiService.errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceId || !configId || exists) return;
    const svc = services.find((s) => s.id === serviceId)?.name || serviceId;
    void change(
      async () => {
        await zitiService.addServiceConfigOverride(identity.id, serviceId, configId);
        setConfigId('');
      },
      'Override added',
      `${identity.name} → ${svc}`,
    );
  };

  return (
    <ModalDialog open wide onClose={onClose} title={`Config overrides: ${identity.name}`}>
      <div className="space-y-4 text-xs">
        <p className="m-0 text-[var(--ac-muted)]">
          When this identity uses a service, an override replaces the service's config of the same type, e.g. a
          different intercept address or host for just this device.
        </p>
        {overrides === null ? (
          <p className="m-0">Loading…</p>
        ) : overrides.length === 0 ? (
          <p className="m-0 italic text-[var(--ac-muted)]">No overrides.</p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[var(--ac-muted)] border-b border-[var(--ac-line)]">
                <th className="py-1.5 font-medium">Service</th>
                <th className="py-1.5 font-medium">Config</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={`${o.serviceId}:${o.configId}`} className="border-b border-[var(--ac-line)]">
                  <td className="py-1.5 font-mono">{serviceName(o)}</td>
                  <td className="py-1.5 font-mono">{configLabel(configOf(o), o.config?.name || o.configId)}</td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void change(
                          () => zitiService.removeServiceConfigOverride(identity.id, o.serviceId, o.configId),
                          'Override removed',
                          `${identity.name} → ${serviceName(o)}`,
                        )
                      }
                      aria-label={`Remove override for ${serviceName(o)}`}
                      className="p-1.5 rounded-lg border border-[var(--ac-line)] text-[var(--ac-bad)] cursor-pointer disabled:opacity-60"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Field label="Service">
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputCls}>
              <option value="">Choose a service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Config">
            <select value={configId} onChange={(e) => setConfigId(e.target.value)} className={inputCls}>
              <option value="">Choose a config…</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {configLabel(c, c.id)}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="submit"
            disabled={busy || !serviceId || !configId || exists}
            className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer disabled:opacity-60"
          >
            Add override
          </button>
        </form>
        {exists && <p className="m-0 text-[var(--ac-muted)]">That override already exists.</p>}
        <ErrorList errors={error ? [error] : []} />
      </div>
    </ModalDialog>
  );
};
