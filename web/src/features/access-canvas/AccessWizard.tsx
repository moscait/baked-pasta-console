import React, { useState } from 'react';
import {
  AcIdentity,
  AcModel,
} from './access-canvas.logic';
import {
  SERVICE_TEMPLATES,
  ServiceTemplate,
  USER_GROUPS,
  WizardCheck,
  WizardInput,
  WizardPlan,
  blankInput,
  detectConflicts,
  plan,
  slugify,
  suggest,
  suggestAvailableServiceName,
  templateById,
  validate,
} from './access-wizard.logic';
import { ModalDialog } from '../../components/ModalDialog';
import { AlertTriangle, Check, Server, Shield, Users, Sparkles } from 'lucide-react';

type Step = 0 | 1 | 2 | 3;
const STEP_FIELDS: Record<Step, string[]> = {
  0: ['system', 'serviceName', 'interceptHost', 'interceptPort'],
  1: ['hostId', 'hostName', 'hostsAttr', 'hostAddress', 'hostPort'],
  2: ['usersAttr', 'newUserName', 'userIds'],
  3: [],
};

interface AccessWizardProps {
  open: boolean;
  model: AcModel;
  newId?: () => string;
  onQueued: (plan: WizardPlan) => void | Promise<void>;
  onApplyNow?: (plan: WizardPlan) => void | Promise<void>;
  onClose: () => void;
}

const defaultNewId = (() => {
  let n = 0;
  return () => `new-w${++n}`;
})();

export const AccessWizard: React.FC<AccessWizardProps> = ({ open, model, newId = defaultNewId, onQueued, onApplyNow, onClose }) => {
  const steps = [
    { label: 'Service', icon: Sparkles },
    { label: 'Server', icon: Server },
    { label: 'Users', icon: Users },
    { label: 'Review', icon: Shield },
  ];
  const templateGroups = [...new Set(SERVICE_TEMPLATES.map((t) => t.group))];

  const [step, setStep] = useState<Step>(0);
  const [w, setW] = useState<WizardInput>(() => blankInput('ssh', ''));
  const [edited, setEdited] = useState<Set<string>>(() => new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const template = templateById(w.templateId);
  const people: AcIdentity[] = model.identities
    .filter((i) => !i.isAdmin)
    .sort((a, b) => a.name.localeCompare(b.name));

  const countAttr = (a: string) => model.identities.filter((i) => i.attrs.includes(a)).length;
  const knownGroups = USER_GROUPS.map((g) => ({ ...g, count: countAttr(g.attr) }));
  const existingGroups = [...new Set(model.identities.filter((i) => !i.isAdmin).flatMap((i) => i.attrs))]
    .filter((a) => !USER_GROUPS.some((g) => g.attr === a))
    .sort()
    .map((a) => ({ attr: a, label: '#' + a, count: countAttr(a) }));

  const rankGroup = (g: { attr: string; count: number }) => {
    const i = template.users.indexOf(g.attr);
    return i >= 0 ? i : g.count ? 10 : 20;
  };
  const userGroups = [...knownGroups, ...existingGroups].sort(
    (a, b) => rankGroup(a) - rankGroup(b) || a.label.localeCompare(b.label),
  );

  const resuggest = (nextTemplateId: string, nextSystem: string, currentEdited: Set<string>, currentW: WizardInput) => {
    const s = suggest(nextTemplateId, nextSystem);
    const untouched = Object.fromEntries(Object.entries(s).filter(([k]) => !currentEdited.has(k)));
    const updated: WizardInput = {
      ...currentW,
      templateId: nextTemplateId,
      system: nextSystem,
      ...untouched,
      reuseExisting: false,
    };
    if (!currentEdited.has('hostsAttr')) updated.hostsAttr = `${updated.serviceName}-hosts`;
    if (!currentEdited.has('hostMode')) {
      const sys = slugify(nextSystem);
      const existingHost = sys ? people.find((i) => i.name.toLowerCase() === sys) : undefined;
      if (existingHost) {
        updated.hostMode = 'existing';
        updated.hostId = existingHost.id;
      } else {
        updated.hostMode = 'new';
        updated.hostId = '';
      }
    }
    setApplyError('');
    setW(updated);
  };

  const touchAndUpdate = <K extends keyof WizardInput>(field: K, value: WizardInput[K]) => {
    const nextEdited = new Set(edited);
    nextEdited.add(field as string);
    setEdited(nextEdited);
    setApplyError('');
    setW((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'serviceName') {
        next.reuseExisting = false;
        if (!nextEdited.has('hostsAttr')) {
          next.hostsAttr = `${value}-hosts`;
        }
      }
      return next;
    });
  };

  const cleanField = (field: 'hostsAttr' | 'usersAttr' | 'newUserName' | 'hostName' | 'serviceName') => {
    setW((prev) => ({ ...prev, [field]: slugify(String(prev[field])) }));
  };

  const conflicts = detectConflicts(model, w);
  const serviceConflicts = conflicts.filter((c) => c.field === 'serviceName');
  const hostConflict = conflicts.find((c) => c.field === 'hostName');
  const userConflict = conflicts.find((c) => c.field === 'newUserName');
  const nextServiceName = serviceConflicts.length ? suggestAvailableServiceName(model, w.serviceName) : w.serviceName;

  const checks = validate(model, w);
  const hasFieldConflict = (field: string) => conflicts.some((c) => c.field === field);
  const errorFor = (field: string): string => {
    const msg = checks.find((c) => c.field === field)?.message || '';
    if (!msg) return '';
    if (showErrors || hasFieldConflict(field)) return msg;
    return '';
  };
  const stepErrors = (s: Step): WizardCheck[] => checks.filter((c) => STEP_FIELDS[s].includes(c.field));

  const handleNext = () => {
    if (stepErrors(step).length) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setApplyError('');
    if (step < 3) setStep((step + 1) as Step);
  };

  const handleBack = () => {
    if (step > 0) {
      setStep((step - 1) as Step);
      setShowErrors(false);
      setApplyError('');
    }
  };

  const goTo = (target: number) => {
    for (let s = 0; s < target; s++) {
      if (stepErrors(s as Step).length) {
        setStep(s as Step);
        setShowErrors(true);
        return;
      }
    }
    setApplyError('');
    setStep(target as Step);
  };

  const runSubmit = async (submitter: (p: WizardPlan) => void | Promise<void>) => {
    if (checks.length) {
      setShowErrors(true);
      return;
    }
    setApplyError('');
    setApplying(true);
    try {
      await submitter(plan(model, w, newId));
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err) || 'Failed to apply wizard changes.');
    } finally {
      setApplying(false);
    }
  };

  const handleFinish = () => {
    void runSubmit(onQueued);
  };

  const handleApplyNow = () => {
    if (!onApplyNow) return;
    void runSubmit(onApplyNow);
  };

  const result = step === 3 ? plan(model, w, newId) : null;
  const usersInGroup = people.filter((i) => i.attrs.includes(w.usersAttr));

  return (
    <ModalDialog open={open} onClose={onClose} title="Set up a service (End-to-End Wizard)" wide>
      <div className="space-y-6">
        {/* Stepper */}
        <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2 list-none p-0 m-0" aria-label="Steps">
          {steps.map((s, idx) => {
            const Icon = s.icon;
            const active = step === idx;
            const done = step > idx;
            return (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={() => goTo(idx)}
                  aria-current={active ? 'step' : undefined}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium cursor-pointer transition-all ${
                    active
                      ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-[var(--ac-ink)] shadow-sm'
                      : done
                        ? 'border-[var(--ac-ok)]/40 bg-[var(--ac-ok-soft)]/50 text-[var(--ac-ink)]'
                        : 'border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-muted)] hover:border-[var(--ac-muted)]'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full inline-grid place-items-center text-xs font-bold ${
                      active
                        ? 'bg-[var(--ac-dial)] text-white'
                        : done
                          ? 'bg-[var(--ac-ok)] text-white'
                          : 'bg-[var(--ac-surface-2)] text-[var(--ac-muted)] border border-[var(--ac-line)]'
                    }`}
                  >
                    {done ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                  </span>
                  <Icon className="w-4 h-4 opacity-75" />
                  <span>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Step Validation Summary Banner */}
        {showErrors && stepErrors(step).length > 0 && (
          <div
            role="alert"
            className="p-3.5 rounded-xl border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)] text-xs space-y-1"
          >
            <div className="font-semibold text-[var(--ac-bad)] flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 flex-none" />
              <span>
                Resolve {stepErrors(step).length === 1 ? 'this issue' : `these ${stepErrors(step).length} issues`} to continue:
              </span>
            </div>
            <ul className="list-disc pl-5 m-0 space-y-0.5 text-[var(--ac-ink)]">
              {stepErrors(step).map((c) => (
                <li key={c.field}>{c.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Step 0: Service */}
        {step === 0 && (
          <div className="space-y-5">
            <p className="text-sm text-[var(--ac-muted)] m-0">
              What do people need to reach? Pick the closest template; you can customize any name, hostname, or port.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" role="radiogroup" aria-label="Kind of service">
              {templateGroups.map((group) => (
                <div key={group} className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--ac-muted)]">{group}</div>
                  {SERVICE_TEMPLATES.filter((t) => t.group === group).map((t: ServiceTemplate) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={w.templateId === t.id}
                      onClick={() => resuggest(t.id, w.system, edited, w)}
                      className={`w-full flex items-baseline justify-between gap-2 text-left px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        w.templateId === t.id
                          ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] font-semibold text-[var(--ac-ink)]'
                          : 'border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-ink)] hover:border-[var(--ac-muted)]'
                      }`}
                    >
                      <span>{t.label}</span>
                      <span className="text-[11px] text-[var(--ac-muted)] font-mono">
                        {t.id === 'custom' ? 'TCP' : `:${t.port}`}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {template.note && (
              <div className="text-xs px-3 py-2 rounded-lg bg-[var(--ac-dial-soft)] text-[var(--ac-ink)] border border-[var(--ac-dial)]/30">
                {template.note}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1 text-xs font-medium">
                <span>System or server name</span>
                <input
                  value={w.system}
                  onChange={(e) => resuggest(w.templateId, e.target.value, edited, w)}
                  placeholder="e.g. devbox, billing, crm-prod"
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm text-[var(--ac-ink)]"
                />
                <span className="block text-[11px] text-[var(--ac-muted)] font-normal">
                  Names below are built from this, e.g. <code>{w.system ? w.serviceName : `crm-${template.slug}`}</code>.
                </span>
                {errorFor('system') && <span className="block text-xs text-[var(--ac-bad)]">{errorFor('system')}</span>}
              </label>

              <label className="block space-y-1 text-xs font-medium">
                <span>Service name</span>
                <input
                  value={w.serviceName}
                  onChange={(e) => touchAndUpdate('serviceName', e.target.value)}
                  onBlur={() => cleanField('serviceName')}
                  className={`w-full px-3 py-2 rounded-lg border bg-[var(--ac-surface-2)] text-sm font-mono text-[var(--ac-ink)] ${
                    errorFor('serviceName') ? 'border-[var(--ac-bad)]' : 'border-[var(--ac-line)]'
                  }`}
                />
                {errorFor('serviceName') && (
                  <span className="block text-xs text-[var(--ac-bad)]">{errorFor('serviceName')}</span>
                )}
              </label>

              <label className="block space-y-1 text-xs font-medium">
                <span>Users connect to (intercept address)</span>
                <input
                  value={w.interceptHost}
                  onChange={(e) => touchAndUpdate('interceptHost', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono text-[var(--ac-ink)]"
                />
                <span className="block text-[11px] text-[var(--ac-muted)] font-normal">
                  A private Ziti intercept DNS name like <code>{w.interceptHost || 'crm.ziti'}</code>.
                </span>
                {errorFor('interceptHost') && (
                  <span className="block text-xs text-[var(--ac-bad)]">{errorFor('interceptHost')}</span>
                )}
              </label>

              <label className="block space-y-1 text-xs font-medium">
                <span>Intercept Port</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={w.interceptPort}
                  onChange={(e) => touchAndUpdate('interceptPort', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono text-[var(--ac-ink)]"
                />
                {errorFor('interceptPort') && (
                  <span className="block text-xs text-[var(--ac-bad)]">{errorFor('interceptPort')}</span>
                )}
              </label>
            </div>

            {serviceConflicts.length > 0 && !w.reuseExisting && (
              <div
                role="alert"
                className="p-3.5 rounded-xl border border-[var(--ac-pending)] bg-[var(--ac-pending-soft)] text-xs space-y-2.5"
              >
                <div className="flex items-start gap-2 font-semibold text-[var(--ac-ink)]">
                  <AlertTriangle className="w-4 h-4 text-[var(--ac-pending)] flex-none mt-0.5" />
                  <div>
                    Existing resources on the controller conflict with{' '}
                    <code className="font-mono">{w.serviceName}</code>:
                  </div>
                </div>
                <ul className="list-disc pl-6 m-0 space-y-0.5 text-[var(--ac-ink)]">
                  {serviceConflicts.map((c) => (
                    <li key={`${c.kind}:${c.id}`}>
                      <span className="font-medium">{c.label}:</span>{' '}
                      <code className="font-mono">{c.name}</code>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const nextEdited = new Set(edited);
                      nextEdited.add('serviceName');
                      setEdited(nextEdited);
                      setApplyError('');
                      setW((prev) => ({
                        ...prev,
                        serviceName: nextServiceName,
                        reuseExisting: false,
                        hostsAttr: nextEdited.has('hostsAttr') ? prev.hostsAttr : `${nextServiceName}-hosts`,
                      }));
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer hover:opacity-95"
                  >
                    Use available name ({nextServiceName})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setApplyError('');
                      setW((prev) => ({ ...prev, reuseExisting: true }));
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-ink)] font-semibold cursor-pointer hover:border-[var(--ac-muted)]"
                  >
                    Update existing {w.serviceName} resources
                  </button>
                </div>
              </div>
            )}

            {serviceConflicts.length > 0 && w.reuseExisting && (
              <div className="p-3 rounded-xl border border-[var(--ac-dial)]/40 bg-[var(--ac-dial-soft)] text-xs flex flex-wrap items-center justify-between gap-2">
                <span>
                  Updating existing <code className="font-mono">{w.serviceName}</code> resources in place (
                  {serviceConflicts.map((c) => c.label).join(', ')}) and adding any missing ones.
                </span>
                <button
                  type="button"
                  onClick={() => setW((prev) => ({ ...prev, reuseExisting: false }))}
                  className="underline font-medium text-[var(--ac-dial)] cursor-pointer"
                >
                  Use a new name instead
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 1: Server */}
        {step === 1 && (
          <div className="space-y-5">
            <p className="text-sm text-[var(--ac-muted)] m-0">
              An identity on (or next to) the server receives the traffic and forwards it to the target application. It runs a tunneler such as <code>ziti-edge-tunnel</code>.
            </p>
            <div className="flex gap-2" role="radiogroup" aria-label="Hosting identity">
              {(['new', 'existing'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={w.hostMode === m}
                  onClick={() => {
                    const nextEdited = new Set(edited);
                    nextEdited.add('hostMode');
                    setEdited(nextEdited);
                    const sys = slugify(w.system);
                    const defaultHostId = people.find((i) => i.name.toLowerCase() === sys)?.id || w.hostId;
                    setW((prev) => ({ ...prev, hostMode: m, hostId: m === 'existing' ? defaultHostId : prev.hostId }));
                  }}
                  className={`px-4 py-1.5 rounded-full border text-xs font-medium cursor-pointer ${
                    w.hostMode === m
                      ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-[var(--ac-ink)]'
                      : 'border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-muted)]'
                  }`}
                >
                  {m === 'new' ? 'New hosting identity' : 'Existing identity'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {w.hostMode === 'new' ? (
                <label className="block space-y-1 text-xs font-medium">
                  <span>Hosting identity name</span>
                  <input
                    value={w.hostName}
                    onChange={(e) => touchAndUpdate('hostName', e.target.value)}
                    onBlur={() => cleanField('hostName')}
                    className={`w-full px-3 py-2 rounded-lg border bg-[var(--ac-surface-2)] text-sm font-mono ${
                      errorFor('hostName') ? 'border-[var(--ac-bad)]' : 'border-[var(--ac-line)]'
                    }`}
                  />
                  <span className="block text-[11px] text-[var(--ac-muted)] font-normal">
                    Usually the server machine&apos;s hostname. You&apos;ll enroll it on that server.
                  </span>
                  {errorFor('hostName') && (
                    <span className="block text-xs text-[var(--ac-bad)]">{errorFor('hostName')}</span>
                  )}
                  {hostConflict && (
                    <div className="mt-1.5 p-2.5 rounded-lg border border-[var(--ac-pending)] bg-[var(--ac-pending-soft)] flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Identity <code className="font-mono">{hostConflict.name}</code> already exists on the controller.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const nextEdited = new Set(edited);
                          nextEdited.add('hostMode');
                          setEdited(nextEdited);
                          setApplyError('');
                          setW((prev) => ({ ...prev, hostMode: 'existing', hostId: hostConflict.id }));
                        }}
                        className="px-2.5 py-1 rounded-md bg-[var(--ac-dial)] text-white font-semibold cursor-pointer hover:opacity-95"
                      >
                        Use existing identity &ldquo;{hostConflict.name}&rdquo;
                      </button>
                    </div>
                  )}
                </label>
              ) : (
                <label className="block space-y-1 text-xs font-medium">
                  <span>Select existing hosting identity</span>
                  <select
                    value={w.hostId}
                    onChange={(e) => setW((prev) => ({ ...prev, hostId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
                  >
                    <option value="">Choose…</option>
                    {people.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.attrs.length ? ` (#${i.attrs.join(', #')})` : ''}
                        {i.enrolled ? '' : ' · not enrolled'}
                      </option>
                    ))}
                  </select>
                  {errorFor('hostId') && (
                    <span className="block text-xs text-[var(--ac-bad)]">{errorFor('hostId')}</span>
                  )}
                </label>
              )}

              <label className="block space-y-1 text-xs font-medium">
                <span>Role attribute for hosts</span>
                <input
                  value={w.hostsAttr}
                  onChange={(e) => touchAndUpdate('hostsAttr', e.target.value)}
                  onBlur={() => cleanField('hostsAttr')}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
                />
                <span className="block text-[11px] text-[var(--ac-muted)] font-normal">
                  The Bind policy selects hosts by <code>#{w.hostsAttr}</code> for easy HA scaling later.
                </span>
                {errorFor('hostsAttr') && (
                  <span className="block text-xs text-[var(--ac-bad)]">{errorFor('hostsAttr')}</span>
                )}
              </label>

              <label className="block space-y-1 text-xs font-medium">
                <span>Target server address (from hosting identity)</span>
                <input
                  value={w.hostAddress}
                  onChange={(e) => touchAndUpdate('hostAddress', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
                />
                <span className="block text-[11px] text-[var(--ac-muted)] font-normal">
                  <code>127.0.0.1</code> when the tunneler runs on the server itself; or LAN IP/DNS.
                </span>
                {errorFor('hostAddress') && (
                  <span className="block text-xs text-[var(--ac-bad)]">{errorFor('hostAddress')}</span>
                )}
              </label>

              <label className="block space-y-1 text-xs font-medium">
                <span>Target server port</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={w.hostPort}
                  onChange={(e) => touchAndUpdate('hostPort', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
                />
                {errorFor('hostPort') && (
                  <span className="block text-xs text-[var(--ac-bad)]">{errorFor('hostPort')}</span>
                )}
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Users */}
        {step === 2 && (
          <div className="space-y-5">
            <p className="text-sm text-[var(--ac-muted)] m-0">
              Who may dial <code>{w.serviceName}</code>? Access is granted to a role attribute group so onboarding future users only requires tagging their identity.
            </p>

            <div className="space-y-2">
              <div className="text-xs font-medium">User group (role attribute)</div>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="User group">
                {userGroups.map((g) => (
                  <button
                    key={g.attr}
                    type="button"
                    role="radio"
                    aria-checked={w.usersAttr === g.attr}
                    onClick={() => touchAndUpdate('usersAttr', g.attr)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs cursor-pointer ${
                      w.usersAttr === g.attr
                        ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] font-semibold text-[var(--ac-ink)]'
                        : 'border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-muted)]'
                    }`}
                  >
                    <span>{g.label}</span>
                    {g.count > 0 && <span className="text-[11px] opacity-75">({g.count})</span>}
                    {template.users.includes(g.attr) && (
                      <span className="text-[10px] uppercase font-bold text-[var(--ac-ok)]">suggested</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <label className="block space-y-1 text-xs font-medium max-w-sm">
              <span>Role attribute name</span>
              <input
                value={w.usersAttr}
                onChange={(e) => touchAndUpdate('usersAttr', e.target.value)}
                onBlur={() => cleanField('usersAttr')}
                className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
              />
              {errorFor('usersAttr') && (
                <span className="block text-xs text-[var(--ac-bad)]">{errorFor('usersAttr')}</span>
              )}
            </label>

            <div className="space-y-2">
              <div className="text-xs font-medium">Who will use it right away?</div>
              <div className="flex gap-2" role="radiogroup" aria-label="Users">
                {(['new', 'existing'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={w.userMode === m}
                    onClick={() => setW((prev) => ({ ...prev, userMode: m }))}
                    className={`px-4 py-1.5 rounded-full border text-xs font-medium cursor-pointer ${
                      w.userMode === m
                        ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-[var(--ac-ink)]'
                        : 'border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-muted)]'
                    }`}
                  >
                    {m === 'new' ? 'New user device' : 'Existing identities'}
                  </button>
                ))}
              </div>
            </div>

            {w.userMode === 'new' ? (
              <label className="block space-y-1 text-xs font-medium max-w-md">
                <span>Device identity name</span>
                <input
                  value={w.newUserName}
                  onChange={(e) => {
                    setApplyError('');
                    setW((prev) => ({ ...prev, newUserName: e.target.value }));
                  }}
                  onBlur={() => cleanField('newUserName')}
                  placeholder="e.g. jdoe-laptop"
                  className={`w-full px-3 py-2 rounded-lg border bg-[var(--ac-surface-2)] text-sm font-mono ${
                    errorFor('newUserName') ? 'border-[var(--ac-bad)]' : 'border-[var(--ac-line)]'
                  }`}
                />
                <span className="block text-[11px] text-[var(--ac-muted)] font-normal">
                  One identity per device. It gets <code>#{w.usersAttr}</code> and a one-time JWT enrollment token.
                </span>
                {errorFor('newUserName') && (
                  <span className="block text-xs text-[var(--ac-bad)]">{errorFor('newUserName')}</span>
                )}
                {userConflict && (
                  <div className="mt-1.5 p-2.5 rounded-lg border border-[var(--ac-pending)] bg-[var(--ac-pending-soft)] flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Identity <code className="font-mono">{userConflict.name}</code> already exists on the controller.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setApplyError('');
                        setW((prev) => ({
                          ...prev,
                          userMode: 'existing',
                          userIds: prev.userIds.includes(userConflict.id)
                            ? prev.userIds
                            : [...prev.userIds, userConflict.id],
                        }));
                      }}
                      className="px-2.5 py-1 rounded-md bg-[var(--ac-dial)] text-white font-semibold cursor-pointer hover:opacity-95"
                    >
                      Use existing identity &ldquo;{userConflict.name}&rdquo;
                    </button>
                  </div>
                )}
              </label>
            ) : (
              <div className="space-y-2">
                {usersInGroup.length > 0 && (
                  <p className="text-xs text-[var(--ac-muted)] m-0">
                    Already in <code>#{w.usersAttr}</code>: {usersInGroup.map((i) => i.name).join(', ')}. Pick more to add them:
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                  {people
                    .filter((i) => !i.attrs.includes(w.usersAttr))
                    .map((i) => {
                      const picked = w.userIds.includes(i.id);
                      return (
                        <button
                          key={i.id}
                          type="button"
                          onClick={() => {
                            const s = new Set(w.userIds);
                            if (s.has(i.id)) s.delete(i.id);
                            else s.add(i.id);
                            setW((prev) => ({ ...prev, userIds: [...s] }));
                          }}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs cursor-pointer ${
                            picked
                              ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] font-semibold'
                              : 'border-[var(--ac-line)] bg-[var(--ac-surface)]'
                          }`}
                        >
                          <span>{i.name}</span>
                          <span className="text-[11px] text-[var(--ac-muted)] font-mono">
                            {picked ? '✓' : i.attrs.length ? `#${i.attrs[0]}` : ''}
                          </span>
                        </button>
                      );
                    })}
                </div>
                {errorFor('userIds') && (
                  <span className="block text-xs text-[var(--ac-bad)]">{errorFor('userIds')}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && result && (
          <div className="space-y-4">
            {applyError && (
              <div
                role="alert"
                className="p-3.5 rounded-xl border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)] text-xs space-y-1"
              >
                <div className="font-semibold text-[var(--ac-bad)] flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 flex-none" />
                  <span>Controller rejected wizard apply</span>
                </div>
                <div className="text-[var(--ac-ink)]">{applyError}</div>
              </div>
            )}
            <div className="p-3.5 rounded-xl bg-[var(--ac-dial-soft)] border border-[var(--ac-dial)]/30 text-sm">
              <div className="font-semibold">{result.summary}</div>
              <div className="text-xs text-[var(--ac-muted)] mt-1">
                {onApplyNow
                  ? 'Click Create & Apply Now to provision everything immediately, or Stage in Pending Changes to inspect the API calls on the canvas first.'
                  : 'Everything below will be created and applied to the controller immediately.'}
              </div>
            </div>

            <div className="bpc-table-region rounded-xl border border-[var(--ac-line)]">
              <table className="bpc-table">
                <thead>
                  <tr>
                    <th scope="col">Creates / Updates</th>
                    <th scope="col">Name</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="font-medium">
                        {it.what}
                        {it.existing && <span className="text-xs text-[var(--ac-muted)] ml-1">(existing)</span>}
                      </td>
                      <td>
                        <code className="text-xs px-1.5 py-0.5 rounded bg-[var(--ac-surface-2)]">{it.name}</code>
                      </td>
                      <td className="text-xs text-[var(--ac-muted)]">{it.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-xs space-y-2">
              <div className="font-semibold text-sm">After you apply</div>
              <ol className="list-decimal pl-5 space-y-1 m-0">
                {result.next.map((n, idx) => (
                  <li key={idx}>{n}</li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-4 border-t border-[var(--ac-line)]">
          <div>
            {step > 0 && (
              <button
                type="button"
                onClick={handleBack}
                disabled={applying}
                className="px-4 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-medium cursor-pointer hover:border-[var(--ac-muted)] disabled:opacity-50"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="px-4 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-sm font-medium cursor-pointer hover:border-[var(--ac-muted)] disabled:opacity-50"
            >
              Cancel
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-5 py-2 rounded-lg bg-[var(--ac-dial)] text-white text-sm font-semibold cursor-pointer hover:opacity-95"
              >
                Next
              </button>
            ) : onApplyNow ? (
              <>
                <button
                  type="button"
                  onClick={handleFinish}
                  disabled={applying}
                  className="px-4 py-2 rounded-lg border border-[var(--ac-dial)] text-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-sm font-semibold cursor-pointer hover:opacity-95 disabled:opacity-50"
                >
                  Stage in Pending Changes
                </button>
                <button
                  type="button"
                  onClick={handleApplyNow}
                  disabled={applying}
                  className="px-5 py-2 rounded-lg bg-[var(--ac-dial)] text-white text-sm font-semibold cursor-pointer hover:opacity-95 disabled:opacity-50"
                >
                  {applying ? 'Applying…' : 'Create & Apply Now'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                disabled={applying}
                className="px-5 py-2 rounded-lg bg-[var(--ac-dial)] text-white text-sm font-semibold cursor-pointer hover:opacity-95 disabled:opacity-50"
              >
                {applying ? 'Applying…' : 'Create & Apply Now'}
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
};
