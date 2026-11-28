import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, FileUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { downloadText } from '../components/csv';
import {
  API_BINDINGS,
  CLIENT_AUTH_POLICIES,
  ControllerConfig,
  EVENT_SUBSCRIPTIONS,
  LOG_LEVELS,
  ValidationIssue,
  defaultConfig,
  fromYaml,
  toYaml,
  validate,
} from '../features/config-builder/controller-config.model';
import {
  ConfigKind,
  RouterConfig,
  TUNNEL_MODES,
  defaultRouterConfig,
  detectKind,
  parseConfigText,
  routerFromDocument,
  routerToYaml,
  validateRouter,
} from '../features/config-builder/router-config.model';

// ------------------------------------------------------------------ generic field model

type FieldType = 'text' | 'number' | 'nullable-number' | 'bool' | 'select' | 'list';

interface FieldSpec {
  path: string;
  label: string;
  type?: FieldType;
  options?: { id: string; label: string }[];
  hint?: string;
  placeholder?: string;
  /** Controller sections only: shown only when this returns true for the current config. */
  when?: (cfg: ControllerConfig) => boolean;
}

interface SectionSpec {
  id: string;
  label: string;
  blurb: string;
  fields: FieldSpec[];
}

const getAt = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

/** Returns a copy of `obj` with `path` set, cloning only the objects along the path. */
function setAt<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const src = obj as Record<string, unknown>;
  const copy = Array.isArray(obj) ? ([...obj] as unknown as Record<string, unknown>) : { ...src };
  copy[head] = rest.length ? setAt(src[head], rest.join('.'), value) : value;
  return copy as T;
}

const opts = (ids: readonly string[]) => ids.map((id) => ({ id, label: id }));

const CONTROLLER_SECTIONS: SectionSpec[] = [
  {
    id: 'identity',
    label: 'Identity & PKI',
    blurb: 'The certificate and key this controller presents, and the CA bundle it trusts.',
    fields: [
      { path: 'mode', label: 'Deployment', type: 'select', options: [{ id: 'standalone', label: 'Standalone' }, { id: 'ha', label: 'HA cluster' }] },
      { path: 'trustDomain', label: 'Trust domain', placeholder: 'e.g. example.ziti', hint: 'SPIFFE trust domain. Required in HA clusters.' },
      { path: 'identity.cert', label: 'Client certificate' },
      { path: 'identity.serverCert', label: 'Server certificate chain' },
      { path: 'identity.key', label: 'Private key' },
      { path: 'identity.ca', label: 'CA bundle' },
      { path: 'db', label: 'Database path', when: (c) => c.mode === 'standalone' },
      { path: 'cluster.dataDir', label: 'Data directory', when: (c) => c.mode === 'ha' },
      { path: 'cluster.snapshotInterval', label: 'Snapshot interval', when: (c) => c.mode === 'ha' },
      { path: 'cluster.snapshotThreshold', label: 'Snapshot threshold', type: 'number', when: (c) => c.mode === 'ha' },
      { path: 'cluster.electionTimeout', label: 'Election timeout', when: (c) => c.mode === 'ha' },
      { path: 'cluster.heartbeatTimeout', label: 'Heartbeat timeout', when: (c) => c.mode === 'ha' },
      { path: 'cluster.logLevel', label: 'Raft log level', type: 'select', options: opts(LOG_LEVELS), when: (c) => c.mode === 'ha' },
      { path: 'cluster.preferredLeader', label: 'Preferred leader', type: 'bool', when: (c) => c.mode === 'ha' },
    ],
  },
  {
    id: 'ctrl',
    label: 'Router listener',
    blurb: 'The listener routers dial to reach the controller, and the address it advertises.',
    fields: [
      { path: 'ctrl.listener', label: 'Listener', placeholder: 'tls:0.0.0.0:6262' },
      { path: 'ctrl.advertiseAddress', label: 'Advertise address', placeholder: 'tls:ctrl.example.com:6262', hint: 'Must be reachable by every router.' },
      { path: 'ctrl.connectTimeoutMs', label: 'Connect timeout (ms)', type: 'number' },
      { path: 'ctrl.maxQueuedConnects', label: 'Max queued connects', type: 'number' },
    ],
  },
  {
    id: 'network',
    label: 'Circuits',
    blurb: 'Route timeouts, retries, smart rerouting and router cost limits.',
    fields: [
      { path: 'network.cycleSeconds', label: 'Cycle (s)', type: 'number' },
      { path: 'network.routeTimeoutSeconds', label: 'Route timeout (s)', type: 'number' },
      { path: 'network.createCircuitRetries', label: 'Circuit retries', type: 'number' },
      { path: 'network.pendingLinkTimeoutSeconds', label: 'Pending link timeout (s)', type: 'number' },
      { path: 'network.minRouterCost', label: 'Min router cost', type: 'number' },
      { path: 'network.routerConnectChurnLimit', label: 'Router connect churn limit' },
      { path: 'network.smartReroute', label: 'Smart reroute', type: 'bool' },
      { path: 'network.rerouteFraction', label: 'Reroute fraction', type: 'number' },
      { path: 'network.rerouteCap', label: 'Reroute cap', type: 'number' },
    ],
  },
  {
    id: 'edge',
    label: 'Edge',
    blurb: 'The edge API address, sessions, enrollment and token lifetimes.',
    fields: [
      { path: 'edge.enabled', label: 'Edge enabled', type: 'bool' },
      { path: 'edge.apiAddress', label: 'API address', placeholder: 'ctrl.example.com:1280' },
      { path: 'edge.sessionTimeout', label: 'Session timeout' },
      { path: 'edge.totpHostname', label: 'TOTP hostname' },
      { path: 'edge.signingCert', label: 'Signing certificate' },
      { path: 'edge.signingKey', label: 'Signing key' },
      { path: 'edge.identityEnrollmentDuration', label: 'Identity enrollment duration' },
      { path: 'edge.routerEnrollmentDuration', label: 'Router enrollment duration' },
      { path: 'edge.accessTokenDuration', label: 'Access token duration' },
      { path: 'edge.refreshTokenDuration', label: 'Refresh token duration' },
      { path: 'edge.authRateLimiter', label: 'Auth rate limiter', type: 'bool' },
      { path: 'edge.authRateLimiterMax', label: 'Rate limiter max size', type: 'number' },
    ],
  },
  { id: 'web', label: 'Web listeners', blurb: 'Which APIs (and this console) are served on which addresses.', fields: [] },
  {
    id: 'events',
    label: 'Events & health',
    blurb: 'Write controller events to a file, and how often health checks run.',
    fields: [{ path: 'healthCheckInterval', label: 'Health check interval' }],
  },
];

const ROUTER_SECTIONS: SectionSpec[] = [
  {
    id: 'r-identity',
    label: 'Identity & PKI',
    blurb: 'The certificate and key this router presents, and the CA bundle it uses to verify the controller.',
    fields: [
      { path: 'identity.cert', label: 'Client certificate' },
      { path: 'identity.serverCert', label: 'Server certificate chain' },
      { path: 'identity.key', label: 'Private key' },
      { path: 'identity.ca', label: 'CA bundle' },
    ],
  },
  {
    id: 'r-ctrl',
    label: 'Controllers',
    blurb: 'The controller endpoints this router dials (tls:host:port). List every controller in an HA cluster.',
    fields: [
      { path: 'ctrl.endpoints', label: 'Controller endpoints (one per line)', type: 'list' },
      { path: 'ctrl.endpointsFile', label: 'Endpoints file' },
    ],
  },
  {
    id: 'r-link',
    label: 'Links',
    blurb: 'How this router connects to other routers. A dialer connects out; a listener accepts connections in.',
    fields: [
      { path: 'link.dial', label: 'Dial links', type: 'bool' },
      { path: 'link.listen', label: 'Listen for links', type: 'bool' },
      { path: 'link.bind', label: 'Bind', placeholder: 'tls:0.0.0.0:10080' },
      { path: 'link.advertise', label: 'Advertise', placeholder: 'tls:router.example.com:10080' },
      { path: 'link.outQueueSize', label: 'Out queue size', type: 'nullable-number' },
      { path: 'link.listenGroups', label: 'Listener groups (one per line)', type: 'list' },
      { path: 'link.dialGroups', label: 'Dialer groups (one per line)', type: 'list' },
    ],
  },
  {
    id: 'r-edge',
    label: 'Edge & tunnel',
    blurb: 'Where SDKs and tunnelers connect, and whether this router also tunnels.',
    fields: [
      { path: 'edge.enabled', label: 'Edge listener', type: 'bool' },
      { path: 'edge.address', label: 'Address', placeholder: 'tls:0.0.0.0:3022' },
      { path: 'edge.advertise', label: 'Advertise', placeholder: 'router.example.com:3022' },
      { path: 'edge.connectTimeoutMs', label: 'Connect timeout (ms)', type: 'nullable-number' },
      { path: 'edge.getSessionTimeout', label: 'Get session timeout (s)', type: 'nullable-number' },
      { path: 'tunnel.enabled', label: 'Tunnel', type: 'bool' },
      { path: 'tunnel.mode', label: 'Mode', type: 'select', options: TUNNEL_MODES.map((m) => ({ id: m.id, label: `${m.label}: ${m.hint}` })) },
      { path: 'tunnel.resolver', label: 'Resolver', placeholder: 'udp://127.0.0.1:53' },
      { path: 'tunnel.dnsSvcIpRange', label: 'DNS service IP range', placeholder: '100.64.0.1/10' },
      { path: 'tunnel.lanIf', label: 'LAN interface' },
    ],
  },
  {
    id: 'r-csr',
    label: 'Certificate request',
    blurb: 'Subject and SANs for the router’s certificate. Clients verify the router by these names and addresses.',
    fields: [
      { path: 'csr.country', label: 'Country' },
      { path: 'csr.province', label: 'Province' },
      { path: 'csr.locality', label: 'Locality' },
      { path: 'csr.organization', label: 'Organization' },
      { path: 'csr.organizationalUnit', label: 'Organizational unit' },
      { path: 'csr.dns', label: 'DNS SANs (one per line)', type: 'list' },
      { path: 'csr.ip', label: 'IP SANs (one per line)', type: 'list' },
    ],
  },
  {
    id: 'r-tuning',
    label: 'Tuning',
    blurb: 'Forwarder queues, metrics and controller health pings. Leave blank to use the router default.',
    fields: [
      { path: 'forwarder.xgressDialQueueLength', label: 'Xgress dial queue length', type: 'nullable-number' },
      { path: 'forwarder.xgressDialWorkerCount', label: 'Xgress dial workers', type: 'nullable-number' },
      { path: 'forwarder.linkDialQueueLength', label: 'Link dial queue length', type: 'nullable-number' },
      { path: 'forwarder.linkDialWorkerCount', label: 'Link dial workers', type: 'nullable-number' },
      { path: 'metrics.reportInterval', label: 'Metrics report interval' },
      { path: 'metrics.messageQueueSize', label: 'Metrics queue size', type: 'nullable-number' },
      { path: 'health.ctrlPingInterval', label: 'Controller ping interval' },
      { path: 'health.ctrlPingTimeout', label: 'Controller ping timeout' },
      { path: 'health.ctrlPingInitialDelay', label: 'Controller ping initial delay' },
      { path: 'health.minLinks', label: 'Min links for healthy', type: 'nullable-number' },
    ],
  },
];

const inputCls =
  'w-full px-2.5 py-1.5 rounded-lg border bg-[var(--ac-surface-2)] font-mono text-xs aria-[invalid=true]:border-[var(--ac-bad)] border-[var(--ac-line)]';

/** One form field bound to a model path. */
const Field: React.FC<{ spec: FieldSpec; value: unknown; issue?: ValidationIssue; onChange: (v: unknown) => void }> = ({
  spec,
  value,
  issue,
  onChange,
}) => {
  const id = `cb-${spec.path}`;
  const type = spec.type || 'text';
  if (type === 'bool') {
    return (
      <label className="flex items-center gap-2 cursor-pointer py-1">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span className="font-medium">{spec.label}</span>
        {spec.hint && <span className="text-[11px] text-[var(--ac-muted)]">{spec.hint}</span>}
      </label>
    );
  }
  return (
    <label htmlFor={id} className="block space-y-1">
      <span className="block font-medium">{spec.label}</span>
      {type === 'select' ? (
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {spec.options!.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === 'list' ? (
        <textarea
          id={id}
          rows={3}
          value={((value as string[]) || []).join('\n')}
          onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
          aria-invalid={!!issue}
          className={inputCls}
        />
      ) : (
        <input
          id={id}
          type={type === 'text' ? 'text' : 'number'}
          value={value === null || value === undefined ? '' : String(value)}
          placeholder={spec.placeholder ?? (type === 'nullable-number' ? 'default' : undefined)}
          onChange={(e) => {
            const raw = e.target.value;
            if (type === 'text') onChange(raw);
            else if (type === 'nullable-number') onChange(raw.trim() === '' ? null : Number(raw));
            else onChange(raw.trim() === '' ? 0 : Number(raw));
          }}
          aria-invalid={!!issue}
          className={inputCls}
        />
      )}
      {issue ? (
        <span className="block text-[11px] text-[var(--ac-bad)]">{issue.message}</span>
      ) : (
        spec.hint && <span className="block text-[11px] text-[var(--ac-muted)]">{spec.hint}</span>
      )}
    </label>
  );
};

// ------------------------------------------------------------------ page

/**
 * Config Builder: create or edit an OpenZiti controller (`ctrl.yml`) or router (`router.yml`)
 * config with validation and a live YAML preview. An opened file keeps every key the form does
 * not manage. Nothing is sent to the controller; the result is downloaded or copied.
 */
export const ConfigBuilderPage: React.FC = () => {
  const [kind, setKind] = useState<ConfigKind>('controller');
  const [cfg, setCfg] = useState<ControllerConfig>(() => defaultConfig());
  const [rcfg, setRcfg] = useState<RouterConfig>(() => defaultRouterConfig());
  const [active, setActive] = useState('identity');
  const [verbose, setVerbose] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loadMsg, setLoadMsg] = useState<{ error?: string; warnings: string[] }>({ warnings: [] });
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const sections = kind === 'router' ? ROUTER_SECTIONS : CONTROLLER_SECTIONS;
  const section = sections.find((s) => s.id === active) || sections[0];
  const model = kind === 'router' ? rcfg : cfg;

  const issues = useMemo(() => (kind === 'router' ? validateRouter(rcfg) : validate(cfg)), [kind, cfg, rcfg]);
  const yamlText = useMemo(() => (kind === 'router' ? routerToYaml(rcfg) : toYaml(cfg, verbose)), [kind, cfg, rcfg, verbose]);
  const issueByField = new Map(issues.filter((i) => i.field).map((i) => [i.field!, i]));
  const errorCount = issues.filter((i) => i.level === 'error').length;

  const update = (path: string, value: unknown) => {
    if (kind === 'router') setRcfg((c) => setAt(c, path, value));
    else setCfg((c) => setAt(c, path, value));
  };

  const switchKind = (k: ConfigKind) => {
    setKind(k);
    setActive((k === 'router' ? ROUTER_SECTIONS : CONTROLLER_SECTIONS)[0].id);
  };

  const openFile = async (file: File) => {
    try {
      const text = await file.text();
      const doc = parseConfigText(text);
      const detected = detectKind(doc);
      const k: ConfigKind = detected === 'unknown' ? kind : detected;
      let warnings: string[];
      if (k === 'router') {
        const r = routerFromDocument(doc);
        setRcfg(r.cfg);
        warnings = r.warnings;
      } else {
        const r = fromYaml(text);
        setCfg(r.cfg);
        warnings = r.warnings;
      }
      if (detected === 'unknown') warnings = [`Could not tell if this is a controller or router config; opened it as a ${k} config.`, ...warnings];
      switchKind(k);
      setFileName(file.name);
      setLoadMsg({ warnings });
    } catch (err) {
      setLoadMsg({ error: `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`, warnings: [] });
    }
  };

  const reset = () => {
    if (kind === 'router') setRcfg(defaultRouterConfig());
    else setCfg(defaultConfig());
    setFileName(null);
    setLoadMsg({ warnings: [] });
  };

  const outName = fileName || (kind === 'router' ? 'router.yml' : 'ctrl.yml');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight m-0">Config Builder</h1>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Build or edit a controller or router config file with validation. Nothing is sent to the controller; download
            the file and deploy it yourself.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div role="tablist" aria-label="Config kind" className="inline-flex p-1 rounded-xl bg-[var(--ac-surface-2)] border border-[var(--ac-line)]">
            {(['controller', 'router'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => switchKind(k)}
                className={`px-3 py-1 rounded-lg capitalize cursor-pointer ${kind === k ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'}`}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".yml,.yaml,.json,text/yaml,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = '';
            }}
          />
          <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] cursor-pointer">
            <FileUp className="w-3.5 h-3.5" />
            <span>Open file…</span>
          </button>
          <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] cursor-pointer">
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Start over</span>
          </button>
        </div>
      </div>

      {(loadMsg.error || loadMsg.warnings.length > 0 || fileName) && (
        <div
          role="status"
          className={`p-3 rounded-xl border text-xs space-y-1 ${
            loadMsg.error ? 'border-[var(--ac-bad)] bg-[var(--ac-bad-soft)]' : 'border-[var(--ac-line)] bg-[var(--ac-surface)]'
          }`}
        >
          {loadMsg.error ? (
            <div>{loadMsg.error}</div>
          ) : (
            <div>
              Editing <strong className="font-mono">{fileName}</strong>. Keys this form does not manage are kept as they are.
            </div>
          )}
          {loadMsg.warnings.map((w) => (
            <div key={w} className="text-[var(--ac-pending)]">
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[13rem_minmax(0,1fr)_minmax(0,1fr)] gap-4 items-start">
        <nav aria-label="Sections" className="flex xl:flex-col flex-wrap gap-1 text-xs">
          {sections.map((s) => {
            const n = issues.filter((i) => i.section === s.id && i.level === 'error').length;
            const w = issues.filter((i) => i.section === s.id && i.level === 'warn').length;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                aria-current={s.id === section.id}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left cursor-pointer ${
                  s.id === section.id ? 'bg-[var(--ac-dial-soft)] text-[var(--ac-dial)] font-semibold' : 'hover:bg-[var(--ac-surface-2)] text-[var(--ac-ink)]'
                }`}
              >
                <span>{s.label}</span>
                {n > 0 ? (
                  <span className="px-1.5 rounded-full bg-[var(--ac-bad)] text-white text-[10px] font-bold">{n}</span>
                ) : w > 0 ? (
                  <span className="px-1.5 rounded-full bg-[var(--ac-pending-soft)] text-[var(--ac-pending)] text-[10px] font-bold">{w}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <section className="p-4 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] space-y-3 text-xs">
          <div>
            <h2 className="text-sm font-semibold m-0">{section.label}</h2>
            <p className="m-0 text-[var(--ac-muted)]">{section.blurb}</p>
          </div>

          {issues
            .filter((i) => i.section === section.id && !i.field)
            .map((i) => (
              <div
                key={i.message}
                className={`flex items-start gap-1.5 p-2 rounded-lg ${i.level === 'error' ? 'bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]' : 'bg-[var(--ac-pending-soft)] text-[var(--ac-pending)]'}`}
              >
                <AlertTriangle className="w-3.5 h-3.5 flex-none mt-px" />
                <span>{i.message}</span>
              </div>
            ))}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {section.fields
              .filter((f) => !f.when || (kind === 'controller' && f.when(cfg)))
              .map((f) => (
                <div key={f.path} className={f.type === 'list' || f.type === 'bool' ? 'md:col-span-2' : undefined}>
                  <Field spec={f} value={getAt(model, f.path)} issue={issueByField.get(f.path)} onChange={(v) => update(f.path, v)} />
                </div>
              ))}
          </div>

          {kind === 'controller' && section.id === 'web' && <WebListenersEditor cfg={cfg} setCfg={setCfg} />}
          {kind === 'controller' && section.id === 'events' && <EventLoggersEditor cfg={cfg} setCfg={setCfg} />}
        </section>

        <section className="rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] text-xs flex flex-col min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[var(--ac-line)]">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{outName}</span>
              {errorCount > 0 ? (
                <span className="px-2 py-0.5 rounded-full bg-[var(--ac-bad-soft)] text-[var(--ac-bad)] font-semibold">
                  {errorCount} error{errorCount === 1 ? '' : 's'}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-[var(--ac-ok-soft)] text-[var(--ac-ok)] font-semibold">Valid</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {kind === 'controller' && (
                <label className="inline-flex items-center gap-1 cursor-pointer" title="Also write values that equal the controller default">
                  <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} />
                  Include defaults
                </label>
              )}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(yamlText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--ac-line)] cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[var(--ac-ok)]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={() => downloadText(outName, yamlText, 'application/yaml;charset=utf-8')}
                title={errorCount ? 'The file has validation errors; it may not start.' : undefined}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
            </div>
          </div>
          <pre className="m-0 p-3 overflow-auto max-h-[70vh] font-mono text-[11px] leading-relaxed">{yamlText}</pre>
        </section>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ list editors (controller)

const smallBtn =
  'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer';

const WebListenersEditor: React.FC<{
  cfg: ControllerConfig;
  setCfg: React.Dispatch<React.SetStateAction<ControllerConfig>>;
}> = ({ cfg, setCfg }) => {
  const setWeb = (fn: (web: ControllerConfig['web']) => ControllerConfig['web']) => setCfg((c) => ({ ...c, web: fn(c.web) }));
  const patchListener = (i: number, patch: Partial<ControllerConfig['web'][number]>) =>
    setWeb((web) => web.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <div className="space-y-3">
      {cfg.web.map((w, i) => (
        <div key={i} className="p-3 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] space-y-2.5">
          <div className="flex items-end gap-2">
            <label className="flex-1 space-y-1">
              <span className="block font-medium">Listener name</span>
              <input value={w.name} onChange={(e) => patchListener(i, { name: e.target.value })} className={inputCls} />
            </label>
            <button type="button" onClick={() => setWeb((web) => web.filter((_, j) => j !== i))} className={`${smallBtn} text-[var(--ac-bad)]`} aria-label={`Remove listener ${w.name}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            <div className="font-medium">Bind points</div>
            {w.bindPoints.map((bp, b) =>
              bp.identity ? (
                <div key={b} className="text-[var(--ac-muted)]">
                  Overlay bind point (service <code>{bp.identity.service || '?'}</code>) — kept as in the file.
                </div>
              ) : (
                <div key={b} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                  <input
                    aria-label="Interface"
                    placeholder="interface 0.0.0.0:1280"
                    value={bp.interface}
                    onChange={(e) => patchListener(i, { bindPoints: w.bindPoints.map((x, k) => (k === b ? { ...x, interface: e.target.value } : x)) })}
                    className={inputCls}
                  />
                  <input
                    aria-label="Address"
                    placeholder="address ctrl.example.com:1280"
                    value={bp.address}
                    onChange={(e) => patchListener(i, { bindPoints: w.bindPoints.map((x, k) => (k === b ? { ...x, address: e.target.value } : x)) })}
                    className={inputCls}
                  />
                  <button type="button" onClick={() => patchListener(i, { bindPoints: w.bindPoints.filter((_, k) => k !== b) })} className={smallBtn} aria-label="Remove bind point">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ),
            )}
            <button type="button" onClick={() => patchListener(i, { bindPoints: [...w.bindPoints, { interface: '0.0.0.0:443', address: '' }] })} className={smallBtn}>
              <Plus className="w-3.5 h-3.5" />
              <span>Bind point</span>
            </button>
          </div>

          <div className="space-y-1">
            <div className="font-medium">APIs</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {API_BINDINGS.map((a) => (
                <label key={a.id} title={a.hint} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!w.apis[a.id]} onChange={(e) => patchListener(i, { apis: { ...w.apis, [a.id]: e.target.checked } })} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>

          {w.apis.spa && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="block font-medium">Console URL path</span>
                <input value={w.spaPath} onChange={(e) => patchListener(i, { spaPath: e.target.value })} className={inputCls} />
              </label>
              <label className="space-y-1">
                <span className="block font-medium">Console files on disk</span>
                <input value={w.spaLocation} onChange={(e) => patchListener(i, { spaLocation: e.target.value })} className={inputCls} />
              </label>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setWeb((web) => [
            ...web,
            { name: `listener-${web.length + 1}`, bindPoints: [{ interface: '0.0.0.0:8443', address: '' }], apis: { 'health-checks': true }, spaPath: 'zac', spaLocation: '' },
          ])
        }
        className={smallBtn}
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Web listener</span>
      </button>
      <p className="m-0 text-[11px] text-[var(--ac-muted)]">
        Client certificate policies for overlay bind points: {CLIENT_AUTH_POLICIES.map((p) => p.label).join(', ')}. Edit those in the file.
      </p>
    </div>
  );
};

const EventLoggersEditor: React.FC<{
  cfg: ControllerConfig;
  setCfg: React.Dispatch<React.SetStateAction<ControllerConfig>>;
}> = ({ cfg, setCfg }) => {
  const setEvents = (fn: (ev: ControllerConfig['events']) => ControllerConfig['events']) => setCfg((c) => ({ ...c, events: fn(c.events) }));
  const patch = (i: number, p: Partial<ControllerConfig['events'][number]>) => setEvents((ev) => ev.map((e, j) => (j === i ? { ...e, ...p } : e)));
  return (
    <div className="space-y-3">
      <div className="font-medium">Event loggers</div>
      {cfg.events.length === 0 && <p className="m-0 text-[var(--ac-muted)]">No event loggers. Events are not written anywhere.</p>}
      {cfg.events.map((ev, i) => (
        <div key={i} className="p-3 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_6rem_2fr_auto] gap-2 items-end">
            <label className="space-y-1">
              <span className="block font-medium">Name</span>
              <input value={ev.name} onChange={(e) => patch(i, { name: e.target.value })} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className="block font-medium">Format</span>
              <select value={ev.format} onChange={(e) => patch(i, { format: e.target.value as 'json' | 'cs' })} className={inputCls}>
                <option value="json">json</option>
                <option value="cs">cs</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block font-medium">File path</span>
              <input value={ev.path} onChange={(e) => patch(i, { path: e.target.value })} className={inputCls} />
            </label>
            <button type="button" onClick={() => setEvents((list) => list.filter((_, j) => j !== i))} className={`${smallBtn} text-[var(--ac-bad)]`} aria-label={`Remove logger ${ev.name}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {EVENT_SUBSCRIPTIONS.map((s) => (
              <label key={s} className="inline-flex items-center gap-1.5 cursor-pointer font-mono">
                <input
                  type="checkbox"
                  checked={ev.subscriptions.includes(s)}
                  onChange={(e) =>
                    patch(i, { subscriptions: e.target.checked ? [...ev.subscriptions, s] : ev.subscriptions.filter((x) => x !== s) })
                  }
                />
                {s}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setEvents((list) => [
            ...list,
            { name: list.length ? `logger-${list.length + 1}` : 'jsonLogger', subscriptions: ['circuit', 'session'], format: 'json', path: '/var/log/ziti/events.json' },
          ])
        }
        className={smallBtn}
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Event logger</span>
      </button>
    </div>
  );
};
