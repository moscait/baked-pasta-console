// Set-up wizard: one service, the identity that hosts it, the users who may reach it, and the
// policies between them, named the way OpenZiti deployments usually name them.

import { AcModel, AcOp, clone, applyOps, identityRouters, serviceRouters } from './access-canvas.logic';

export interface ServiceTemplate {
  id: string;
  label: string;
  group: string;
  slug: string;
  port: number;
  protocols: ('tcp' | 'udp')[];
  users: string[];
  interceptTld?: string;
  note?: string;
}

export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  {
    id: 'ssh',
    label: 'SSH (remote shell)',
    group: 'Remote access',
    slug: 'ssh',
    port: 22,
    protocols: ['tcp'],
    users: ['it-admins', 'developers', 'sre'],
  },
  {
    id: 'rdp',
    label: 'Remote Desktop (RDP)',
    group: 'Remote access',
    slug: 'rdp',
    port: 3389,
    protocols: ['tcp'],
    users: ['it-admins', 'support', 'employees'],
  },
  {
    id: 'vnc',
    label: 'VNC screen sharing',
    group: 'Remote access',
    slug: 'vnc',
    port: 5900,
    protocols: ['tcp'],
    users: ['support', 'it-admins'],
  },
  {
    id: 'ollama',
    label: 'Ollama (LLM API)',
    group: 'Remote access',
    slug: 'ollama',
    port: 11434,
    protocols: ['tcp'],
    users: ['developers', 'employees', 'sre'],
    interceptTld: 'ziti.internal',
    note: 'Uses .ziti.internal so Ollama accepts the Host header on 127.0.0.1:11434 without extra host config.',
  },
  {
    id: 'https',
    label: 'Internal web app (HTTPS)',
    group: 'Web',
    slug: 'https',
    port: 443,
    protocols: ['tcp'],
    users: ['employees', 'developers'],
  },
  {
    id: 'http',
    label: 'Internal web app (HTTP)',
    group: 'Web',
    slug: 'http',
    port: 80,
    protocols: ['tcp'],
    users: ['employees', 'developers'],
    note: 'Traffic is encrypted end to end over Ziti even though the app speaks plain HTTP.',
  },
  {
    id: 'api',
    label: 'Internal API (HTTPS, 8443)',
    group: 'Web',
    slug: 'api',
    port: 8443,
    protocols: ['tcp'],
    users: ['developers', 'sre'],
  },
  {
    id: 'grafana',
    label: 'Grafana / dashboards',
    group: 'Web',
    slug: 'grafana',
    port: 3000,
    protocols: ['tcp'],
    users: ['sre', 'developers'],
  },
  {
    id: 'jenkins',
    label: 'Jenkins / CI server',
    group: 'Web',
    slug: 'jenkins',
    port: 8080,
    protocols: ['tcp'],
    users: ['developers', 'sre'],
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    group: 'Databases',
    slug: 'postgres',
    port: 5432,
    protocols: ['tcp'],
    users: ['dbas', 'developers'],
  },
  {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    group: 'Databases',
    slug: 'mysql',
    port: 3306,
    protocols: ['tcp'],
    users: ['dbas', 'developers'],
  },
  {
    id: 'mssql',
    label: 'Microsoft SQL Server',
    group: 'Databases',
    slug: 'mssql',
    port: 1433,
    protocols: ['tcp'],
    users: ['dbas', 'developers'],
  },
  {
    id: 'redis',
    label: 'Redis',
    group: 'Databases',
    slug: 'redis',
    port: 6379,
    protocols: ['tcp'],
    users: ['developers', 'sre'],
  },
  {
    id: 'smb',
    label: 'Windows file share (SMB)',
    group: 'Files and infrastructure',
    slug: 'smb',
    port: 445,
    protocols: ['tcp'],
    users: ['employees', 'finance', 'hr'],
  },
  {
    id: 'k8s',
    label: 'Kubernetes API',
    group: 'Files and infrastructure',
    slug: 'k8s-api',
    port: 6443,
    protocols: ['tcp'],
    users: ['platform-engineers', 'sre'],
  },
  {
    id: 'custom',
    label: 'Something else (choose the port)',
    group: 'Other',
    slug: 'app',
    port: 8080,
    protocols: ['tcp'],
    users: ['employees'],
  },
];

export interface UserGroup {
  attr: string;
  label: string;
}

export const USER_GROUPS: UserGroup[] = [
  { attr: 'employees', label: 'All employees' },
  { attr: 'it-admins', label: 'IT administrators' },
  { attr: 'developers', label: 'Developers' },
  { attr: 'sre', label: 'SRE / operations' },
  { attr: 'platform-engineers', label: 'Platform engineers' },
  { attr: 'dbas', label: 'Database administrators' },
  { attr: 'support', label: 'Support / help desk' },
  { attr: 'finance', label: 'Finance' },
  { attr: 'hr', label: 'HR' },
  { attr: 'sales', label: 'Sales' },
  { attr: 'contractors', label: 'Contractors' },
  { attr: 'executives', label: 'Executives' },
];

export interface WizardInput {
  templateId: string;
  system: string;
  serviceName: string;
  interceptHost: string;
  interceptPort: number;
  hostAddress: string;
  hostPort: number;
  protocols: ('tcp' | 'udp')[];
  hostMode: 'new' | 'existing';
  hostId: string;
  hostName: string;
  hostsAttr: string;
  usersAttr: string;
  userMode: 'new' | 'existing';
  userIds: string[];
  newUserName: string;
  reuseExisting?: boolean;
}

export interface ResourceConflict {
  kind: 'service' | 'config' | 'policy' | 'router-policy' | 'identity';
  label: string;
  name: string;
  id: string;
  field: 'serviceName' | 'hostName' | 'newUserName';
}

export const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^[#@]/, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const templateById = (id: string) =>
  SERVICE_TEMPLATES.find((t) => t.id === id) || SERVICE_TEMPLATES[SERVICE_TEMPLATES.length - 1];

export function suggest(
  templateId: string,
  system: string,
): Pick<
  WizardInput,
  | 'serviceName'
  | 'interceptHost'
  | 'interceptPort'
  | 'hostAddress'
  | 'hostPort'
  | 'protocols'
  | 'hostName'
  | 'hostsAttr'
  | 'usersAttr'
> {
  const t = templateById(templateId);
  const sys = slugify(system) || 'app-server';
  const suffix = `-${t.slug}`;
  const serviceName = sys.endsWith(suffix) ? sys : `${sys}${suffix}`;
  return {
    serviceName,
    interceptHost: `${sys}.${t.interceptTld || 'ziti'}`,
    interceptPort: t.port,
    hostAddress: '127.0.0.1',
    hostPort: t.port,
    protocols: [...t.protocols],
    hostName: sys,
    hostsAttr: `${serviceName}-hosts`,
    usersAttr: t.users[0],
  };
}

export function blankInput(templateId = 'ssh', system = ''): WizardInput {
  return {
    templateId,
    system,
    ...suggest(templateId, system),
    hostMode: 'new',
    hostId: '',
    userMode: 'new',
    userIds: [],
    newUserName: '',
    reuseExisting: false,
  };
}

export interface WizardCheck {
  field: string;
  message: string;
}

const validPort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;
const validName = (s: string) => /^[a-z0-9][a-z0-9._-]*$/.test(s);
const byNameCI = <T extends { name: string }>(list: T[] | undefined, n: string): T | undefined =>
  list?.find((x) => x.name.toLowerCase() === n.toLowerCase());

function serviceResourceConflicts(m: AcModel, serviceName: string): ResourceConflict[] {
  const name = serviceName.trim();
  if (!name) return [];
  const out: ResourceConflict[] = [];
  const svc = byNameCI(m.services, name);
  if (svc) out.push({ kind: 'service', label: 'Service', name: svc.name, id: svc.id, field: 'serviceName' });
  const ic = byNameCI(m.configs, `${name}.intercept.v1`);
  if (ic) out.push({ kind: 'config', label: 'Intercept Config', name: ic.name, id: ic.id, field: 'serviceName' });
  const hc = byNameCI(m.configs, `${name}.host.v1`);
  if (hc) out.push({ kind: 'config', label: 'Host Config', name: hc.name, id: hc.id, field: 'serviceName' });
  const bind = byNameCI(m.servicePolicies, `${name}-bind`);
  if (bind) out.push({ kind: 'policy', label: 'Bind Service Policy', name: bind.name, id: bind.id, field: 'serviceName' });
  const dial = byNameCI(m.servicePolicies, `${name}-dial`);
  if (dial) out.push({ kind: 'policy', label: 'Dial Service Policy', name: dial.name, id: dial.id, field: 'serviceName' });
  const serp = byNameCI(m.serps, `${name}-routers`);
  if (serp)
    out.push({
      kind: 'router-policy',
      label: 'Service Router Policy',
      name: serp.name,
      id: serp.id,
      field: 'serviceName',
    });
  const erp = byNameCI(m.erPolicies, `${name}-identities-routers`);
  if (erp)
    out.push({
      kind: 'router-policy',
      label: 'Edge Router Policy',
      name: erp.name,
      id: erp.id,
      field: 'serviceName',
    });
  return out;
}

/** Finds every existing resource on the controller whose name collides with what the wizard would create. */
export function detectConflicts(m: AcModel, w: WizardInput): ResourceConflict[] {
  const out: ResourceConflict[] = [...serviceResourceConflicts(m, w.serviceName)];
  if (w.hostMode === 'new' && w.hostName.trim()) {
    const h = byNameCI(m.identities, w.hostName.trim());
    if (h) out.push({ kind: 'identity', label: 'Identity', name: h.name, id: h.id, field: 'hostName' });
  }
  if (w.userMode === 'new' && w.newUserName.trim()) {
    const u = byNameCI(m.identities, w.newUserName.trim());
    if (u) out.push({ kind: 'identity', label: 'Identity', name: u.name, id: u.id, field: 'newUserName' });
  }
  return out;
}

/** Picks `<baseName>-2`, `<baseName>-3`, etc. that has zero conflicts across services, configs, and policies. */
export function suggestAvailableServiceName(m: AcModel, baseName: string): string {
  const clean = slugify(baseName) || 'app';
  if (!serviceResourceConflicts(m, clean).length) return clean;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${clean}-${i}`;
    if (!serviceResourceConflicts(m, candidate).length) return candidate;
  }
  return `${clean}-${Date.now()}`;
}

export function validate(m: AcModel, w: WizardInput): WizardCheck[] {
  const out: WizardCheck[] = [];
  const taken = (list: { name: string }[], n: string) => list.some((x) => x.name.toLowerCase() === n.toLowerCase());
  if (!w.system.trim()) out.push({ field: 'system', message: 'Name the system or machine it runs on.' });
  if (!validName(w.serviceName)) {
    out.push({ field: 'serviceName', message: 'Use lowercase letters, digits, dots and dashes.' });
  } else if (!w.reuseExisting) {
    const svcConflicts = serviceResourceConflicts(m, w.serviceName);
    if (svcConflicts.length) {
      const list = svcConflicts.map((c) => `${c.label} "${c.name}"`).join(', ');
      out.push({
        field: 'serviceName',
        message: `Already exists on controller: ${list}. Choose a different name or click "Update existing resources".`,
      });
    }
  }
  if (!w.interceptHost.trim() || /\s/.test(w.interceptHost))
    out.push({ field: 'interceptHost', message: 'Enter a hostname or IP address users will connect to.' });
  if (!validPort(w.interceptPort)) out.push({ field: 'interceptPort', message: 'Ports are 1 to 65535.' });
  if (!w.hostAddress.trim() || /\s/.test(w.hostAddress))
    out.push({ field: 'hostAddress', message: 'Enter the address the server listens on.' });
  if (!validPort(w.hostPort)) out.push({ field: 'hostPort', message: 'Ports are 1 to 65535.' });
  if (w.hostMode === 'existing' && !m.identities.some((i) => i.id === w.hostId))
    out.push({ field: 'hostId', message: 'Choose the identity that hosts it.' });
  if (w.hostMode === 'new') {
    if (!validName(w.hostName))
      out.push({ field: 'hostName', message: 'Use lowercase letters, digits, dots and dashes.' });
    else if (taken(m.identities, w.hostName))
      out.push({
        field: 'hostName',
        message: `An identity named ${w.hostName} already exists. Choose “Existing identity” to use it.`,
      });
  }
  if (!validName(w.hostsAttr))
    out.push({ field: 'hostsAttr', message: 'Use lowercase letters, digits, dots and dashes.' });
  if (!validName(w.usersAttr)) out.push({ field: 'usersAttr', message: 'Choose or type a user group.' });
  if (w.userMode === 'new') {
    if (!w.newUserName)
      out.push({
        field: 'newUserName',
        message: "Name the user's device, e.g. jdoe-laptop, or choose “Existing identities”.",
      });
    else if (!validName(w.newUserName))
      out.push({ field: 'newUserName', message: 'Use lowercase letters, digits, dots and dashes.' });
    else if (taken(m.identities, w.newUserName)) {
      out.push({
        field: 'newUserName',
        message: `An identity named ${w.newUserName} already exists. Choose “Existing identities” to use it.`,
      });
    }
  } else {
    const inGroup = m.identities.some((i) => !i.isAdmin && i.attrs.includes(w.usersAttr));
    if (!w.userIds.length && !inGroup)
      out.push({
        field: 'userIds',
        message: `Nobody has #${w.usersAttr} yet, so nobody could use it. Pick at least one identity, or create a new user device.`,
      });
  }
  return out;
}

export interface WizardItem {
  what: string;
  name: string;
  detail: string;
  existing?: boolean;
}
export interface WizardPlan {
  ops: AcOp[];
  items: WizardItem[];
  title: string;
  summary: string;
  next: string[];
  created: string[];
  updated: string[];
}

export function plan(m: AcModel, w: WizardInput, newId: () => string): WizardPlan {
  const ops: AcOp[] = [];
  const items: WizardItem[] = [];
  const svc = w.serviceName;
  const reuse = !!w.reuseExisting;
  const port = (p: number) => ({ low: p, high: p });

  const existingIntercept = reuse ? byNameCI(m.configs, `${svc}.intercept.v1`) : undefined;
  const existingHostCfg = reuse ? byNameCI(m.configs, `${svc}.host.v1`) : undefined;
  const intercept = {
    id: newId(),
    name: `${svc}.intercept.v1`,
    type: 'intercept.v1',
    data: { protocols: w.protocols, addresses: [w.interceptHost.trim()], portRanges: [port(w.interceptPort)] },
    existingId: existingIntercept?.id,
  };
  const host = {
    id: newId(),
    name: `${svc}.host.v1`,
    type: 'host.v1',
    data: { protocol: w.protocols[0], address: w.hostAddress.trim(), port: w.hostPort },
    existingId: existingHostCfg?.id,
  };
  ops.push({ op: 'createConfig', config: intercept }, { op: 'createConfig', config: host });
  items.push({
    what: 'Config (intercept.v1)',
    name: intercept.name,
    detail: `users connect to ${w.interceptHost}:${w.interceptPort}`,
    existing: !!existingIntercept,
  });
  items.push({
    what: 'Config (host.v1)',
    name: host.name,
    detail: `forwarded to ${w.hostAddress}:${w.hostPort} on the hosting identity`,
    existing: !!existingHostCfg,
  });

  const t = templateById(w.templateId);
  const existingSvc = reuse ? byNameCI(m.services, svc) : undefined;
  const svcAttrs = existingSvc ? [...new Set([...existingSvc.attrs, svc])] : [svc];
  const svcId = newId();
  ops.push({
    op: 'createService',
    service: {
      id: svcId,
      name: svc,
      attrs: svcAttrs,
      configs: [intercept.id, host.id],
      encryptionRequired: true,
      terminatorStrategy: 'smartrouting',
      existingId: existingSvc?.id,
    },
  });
  items.push({
    what: 'Service',
    name: svc,
    detail: `role attributes ${svcAttrs.map((a) => '#' + a).join(', ')}`,
    existing: !!existingSvc,
  });

  const sameNewIdentity = w.hostMode === 'new' && w.userMode === 'new' && w.newUserName === w.hostName;
  let hostLabel: string;
  if (w.hostMode === 'new') {
    const attrs = sameNewIdentity ? [...new Set([w.hostsAttr, w.usersAttr])] : [w.hostsAttr];
    ops.push({ op: 'createIdentity', identity: { id: newId(), name: w.hostName, attrs } });
    items.push({
      what: sameNewIdentity ? 'Identity (hosts & uses)' : 'Identity (hosts it)',
      name: w.hostName,
      detail: sameNewIdentity
        ? `role attributes ${attrs.map((a) => '#' + a).join(', ')}; enroll it on the server`
        : `role attribute #${w.hostsAttr}; enroll it on the server`,
    });
    hostLabel = w.hostName;
  } else {
    const h = m.identities.find((i) => i.id === w.hostId)!;
    if (!h.attrs.includes(w.hostsAttr)) ops.push({ op: 'addAttr', kind: 'identity', id: h.id, attr: w.hostsAttr });
    items.push({
      what: 'Identity (hosts it)',
      name: h.name,
      detail: `gets role attribute #${w.hostsAttr}`,
      existing: true,
    });
    hostLabel = h.name;
  }

  const users: string[] = [];
  for (const id of w.userMode === 'existing' ? w.userIds : []) {
    const u = m.identities.find((i) => i.id === id);
    if (!u) continue;
    users.push(u.name);
    const alreadyAddedByHost = w.hostMode === 'existing' && id === w.hostId && w.hostsAttr === w.usersAttr;
    if (!u.attrs.includes(w.usersAttr) && !alreadyAddedByHost) {
      ops.push({ op: 'addAttr', kind: 'identity', id, attr: w.usersAttr });
    }
    items.push({
      what: 'Identity (user)',
      name: u.name,
      detail: `gets role attribute #${w.usersAttr}`,
      existing: true,
    });
  }
  if (sameNewIdentity) {
    users.push(w.newUserName);
  } else if (w.userMode === 'new' && w.newUserName) {
    ops.push({ op: 'createIdentity', identity: { id: newId(), name: w.newUserName, attrs: [w.usersAttr] } });
    items.push({
      what: 'Identity (user)',
      name: w.newUserName,
      detail: `role attribute #${w.usersAttr}; enroll it on the user's device`,
    });
    users.push(w.newUserName);
  }
  const already = m.identities
    .filter((i) => !i.isAdmin && i.attrs.includes(w.usersAttr) && !users.includes(i.name))
    .map((i) => i.name);

  const existingBind = reuse ? byNameCI(m.servicePolicies, `${svc}-bind`) : undefined;
  const bindIdentityRoles = existingBind
    ? [...new Set([...existingBind.identityRoles, '#' + w.hostsAttr])]
    : ['#' + w.hostsAttr];
  const bindServiceRoles = existingBind ? [...new Set([...existingBind.serviceRoles, '#' + svc])] : ['#' + svc];
  ops.push({
    op: 'createPolicy',
    policy: {
      id: newId(),
      name: `${svc}-bind`,
      type: 'Bind',
      semantic: existingBind?.semantic || 'AnyOf',
      identityRoles: bindIdentityRoles,
      serviceRoles: bindServiceRoles,
      posture: existingBind?.posture || [],
      existingId: existingBind?.id,
    },
  });
  items.push({
    what: 'Bind service policy',
    name: `${svc}-bind`,
    detail: `#${w.hostsAttr} hosts #${svc}`,
    existing: !!existingBind,
  });

  const existingDial = reuse ? byNameCI(m.servicePolicies, `${svc}-dial`) : undefined;
  const dialIdentityRoles = existingDial
    ? [...new Set([...existingDial.identityRoles, '#' + w.usersAttr])]
    : ['#' + w.usersAttr];
  const dialServiceRoles = existingDial ? [...new Set([...existingDial.serviceRoles, '#' + svc])] : ['#' + svc];
  ops.push({
    op: 'createPolicy',
    policy: {
      id: newId(),
      name: `${svc}-dial`,
      type: 'Dial',
      semantic: existingDial?.semantic || 'AnyOf',
      identityRoles: dialIdentityRoles,
      serviceRoles: dialServiceRoles,
      posture: existingDial?.posture || [],
      existingId: existingDial?.id,
    },
  });
  items.push({
    what: 'Dial service policy',
    name: `${svc}-dial`,
    detail: `#${w.usersAttr} may use #${svc}`,
    existing: !!existingDial,
  });

  const after = applyOps(clone(m), ops);
  const svcAfter = after.services.find((s) => s.id === (existingSvc?.id || svcId))!;
  if (after.routers.length && !serviceRouters(after, svcAfter).length) {
    const existingSerp = reuse ? byNameCI(m.serps, `${svc}-routers`) : undefined;
    ops.push({
      op: 'createSerp',
      policy: {
        id: newId(),
        name: `${svc}-routers`,
        semantic: existingSerp?.semantic || 'AnyOf',
        serviceRoles: existingSerp ? [...new Set([...existingSerp.serviceRoles, '#' + svc])] : ['#' + svc],
        routerRoles: existingSerp ? [...new Set([...existingSerp.routerRoles, '#all'])] : ['#all'],
        existingId: existingSerp?.id,
      },
    });
    items.push({
      what: 'Service Router Policy',
      name: `${svc}-routers`,
      detail: `#${svc} may use all routers`,
      existing: !!existingSerp,
    });
  }
  const needRoutes = after.identities.filter(
    (i) => (i.attrs.includes(w.hostsAttr) || i.attrs.includes(w.usersAttr)) && !identityRouters(after, i).length,
  );
  if (after.routers.length && needRoutes.length) {
    const roles = [
      ...new Set(needRoutes.map((i) => (i.attrs.includes(w.hostsAttr) ? '#' + w.hostsAttr : '#' + w.usersAttr))),
    ];
    const existingErp = reuse ? byNameCI(m.erPolicies, `${svc}-identities-routers`) : undefined;
    ops.push({
      op: 'createErPolicy',
      policy: {
        id: newId(),
        name: `${svc}-identities-routers`,
        semantic: existingErp?.semantic || 'AnyOf',
        identityRoles: existingErp ? [...new Set([...existingErp.identityRoles, ...roles])] : roles,
        routerRoles: existingErp ? [...new Set([...existingErp.routerRoles, '#all'])] : ['#all'],
        existingId: existingErp?.id,
      },
    });
    items.push({
      what: 'Router Policy',
      name: `${svc}-identities-routers`,
      detail: `${roles.join(', ')} may use all routers`,
      existing: !!existingErp,
    });
  }

  const next: string[] = [];
  if (w.hostMode === 'new') {
    next.push(
      `On the server, enroll ${w.hostName} with its one-time token (Identities → ${w.hostName} → Token): ` +
        `sudo ziti-edge-tunnel enroll --jwt ${w.hostName}.jwt --identity /opt/openziti/etc/identities/${w.hostName}.json, then restart ziti-edge-tunnel.`,
    );
  }
  if (w.userMode === 'new' && w.newUserName && !sameNewIdentity) {
    next.push(`Enroll ${w.newUserName} in Ziti Desktop Edge (or another tunneler) on that user's device with its token.`);
  }
  next.push(
    `Users connect to ${w.interceptHost}:${w.interceptPort} with their usual client; Ziti carries it to ${w.hostAddress}:${w.hostPort} on ${hostLabel}.`,
  );

  const who = [...users, ...already];
  const created = ops.flatMap((o) => (o.op === 'createIdentity' ? [o.identity.name] : []));
  const updated = [
    ...new Set(
      ops
        .flatMap((o) => (o.op === 'addAttr' ? [m.identities.find((i) => i.id === o.id)?.name] : []))
        .filter(Boolean),
    ),
  ] as string[];
  return {
    ops,
    items,
    next,
    created,
    updated,
    title: `Set up ${svc} for #${w.usersAttr}`,
    summary:
      `${t.label} on ${hostLabel}, reachable at ${w.interceptHost}:${w.interceptPort} by #${w.usersAttr}` +
      (who.length ? ` (${who.slice(0, 3).join(', ')}${who.length > 3 ? ` and ${who.length - 3} more` : ''})` : ' (nobody has it yet)') +
      '.',
  };
}
