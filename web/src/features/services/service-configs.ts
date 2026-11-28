import type { Config, ConfigType, Service } from '../../services/api-types';

/**
 * Config types the console knows are attached to services, in display order. Other types
 * (custom ones, or a type another tool uses for its own storage) are still attachable but
 * are shown separately so they are not mistaken for service configuration.
 */
export const KNOWN_SERVICE_CONFIG_TYPES: { name: string; purpose: string; template?: object }[] = [
  {
    name: 'intercept.v1',
    purpose: 'What clients dial: the address and ports a tunneler intercepts.',
    template: { protocols: ['tcp'], addresses: ['app.ziti'], portRanges: [{ low: 443, high: 443 }] },
  },
  {
    name: 'host.v1',
    purpose: 'Where the hosting tunneler forwards traffic.',
    template: { protocol: 'tcp', address: '127.0.0.1', port: 8080 },
  },
  {
    name: 'host.v2',
    purpose: 'Hosting with one or more terminators.',
    template: { terminators: [{ protocol: 'tcp', address: '127.0.0.1', port: 8080 }] },
  },
  { name: 'ziti-tunneler-client.v1', purpose: 'Legacy client intercept (older tunnelers).' },
  { name: 'ziti-tunneler-server.v1', purpose: 'Legacy hosting (older tunnelers).' },
];

const KNOWN_INDEX = new Map(KNOWN_SERVICE_CONFIG_TYPES.map((t, i) => [t.name, i]));

/** The config's type name, falling back to the type id when the name is not embedded. */
export function configTypeName(config: Config, types: ConfigType[]): string {
  return config.configType?.name || types.find((t) => t.id === config.configTypeId)?.name || config.configTypeId;
}

export interface ConfigTypeGroup {
  typeId: string;
  typeName: string;
  known: boolean;
  purpose?: string;
  configs: Config[];
}

/** Configs grouped by type: known service types first (in a fixed order), then the rest. */
export function groupConfigsByType(configs: Config[], types: ConfigType[]): ConfigTypeGroup[] {
  const byType = new Map<string, ConfigTypeGroup>();
  for (const c of configs) {
    let g = byType.get(c.configTypeId);
    if (!g) {
      const typeName = configTypeName(c, types);
      const known = KNOWN_INDEX.has(typeName);
      g = {
        typeId: c.configTypeId,
        typeName,
        known,
        purpose: known ? KNOWN_SERVICE_CONFIG_TYPES[KNOWN_INDEX.get(typeName)!].purpose : undefined,
        configs: [],
      };
      byType.set(c.configTypeId, g);
    }
    g.configs.push(c);
  }
  const rank = (g: ConfigTypeGroup) => (g.known ? KNOWN_INDEX.get(g.typeName)! : KNOWN_SERVICE_CONFIG_TYPES.length);
  for (const g of byType.values()) g.configs.sort((a, b) => a.name.localeCompare(b.name));
  return [...byType.values()].sort((a, b) => rank(a) - rank(b) || a.typeName.localeCompare(b.typeName));
}

/**
 * Selects `configId` for its type, replacing any other selected config of the same type
 * (a service may have at most one config per type), or clears the type when `configId` is
 * null. Ids not found in `configs` are kept untouched.
 */
export function selectConfigForType(
  selected: string[],
  typeId: string,
  configId: string | null,
  configs: Config[],
): string[] {
  const typeOf = new Map(configs.map((c) => [c.id, c.configTypeId]));
  const kept = selected.filter((id) => typeOf.get(id) !== typeId);
  return configId ? [...kept, configId] : kept;
}

/** Config types that have more than one selected config (the controller rejects these). */
export function duplicateTypes(selected: string[], configs: Config[], types: ConfigType[]): string[] {
  const count = new Map<string, number>();
  const name = new Map<string, string>();
  for (const id of selected) {
    const c = configs.find((x) => x.id === id);
    if (!c) continue;
    count.set(c.configTypeId, (count.get(c.configTypeId) || 0) + 1);
    name.set(c.configTypeId, configTypeName(c, types));
  }
  return [...count].filter(([, n]) => n > 1).map(([t]) => name.get(t)!);
}

/** For each config id, the services that attach it. */
export function servicesByConfig(services: Service[]): Map<string, Service[]> {
  const out = new Map<string, Service[]>();
  for (const s of services) {
    for (const id of s.configs || []) {
      if (!out.has(id)) out.set(id, []);
      out.get(id)!.push(s);
    }
  }
  return out;
}

/** Starting JSON for a new config of this type. */
export function configTemplate(typeName: string): string {
  const t = KNOWN_SERVICE_CONFIG_TYPES.find((x) => x.name === typeName)?.template;
  return JSON.stringify(t ?? {}, null, 2);
}

/** Parses config data typed by the user: it must be a JSON object. */
export function parseConfigData(text: string): { data: Record<string, unknown> } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { error: `Not valid JSON: ${(err as Error).message}` };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Config data must be a JSON object, e.g. { "port": 443 }.' };
  }
  return { data: value as Record<string, unknown> };
}

export interface ServiceEndpointInfo {
  interceptDisplay?: string;
  hostDisplay?: string;
  url?: string;
  protocol?: string;
}

const HTTPS_PORTS = new Set([443, 8443, 6443]);
const HTTP_PORTS = new Set([80, 3000, 5000, 8000, 8080, 8888, 9000, 11434]);

function looksLikeIntercept(cfg: Config): boolean {
  const t = cfg.configType?.name;
  if (t === 'intercept.v1' || t === 'ziti-tunneler-client.v1') return true;
  if (t) return false;
  const d = cfg.data || {};
  return Array.isArray(d.addresses) || Array.isArray(d.portRanges) || (typeof d.hostname === 'string' && !('protocol' in d));
}

function looksLikeHost(cfg: Config): boolean {
  const t = cfg.configType?.name;
  if (t === 'host.v1' || t === 'host.v2' || t === 'ziti-tunneler-server.v1') return true;
  if (t) return false;
  const d = cfg.data || {};
  return Array.isArray(d.terminators) || 'address' in d || ('hostname' in d && 'protocol' in d);
}

/** Extracts user-facing intercept and forwarding target details from a service's attached configs. */
export function describeServiceEndpoint(
  service: Pick<Service, 'name' | 'configs'>,
  configs: Config[] | Map<string, Config>,
): ServiceEndpointInfo {
  const map = configs instanceof Map ? configs : new Map(configs.map((c) => [c.id, c]));
  let interceptAddress: string | undefined;
  let protocol = 'tcp';
  let singlePort: number | undefined;
  let interceptDisplay: string | undefined;
  let hostDisplay: string | undefined;

  for (const id of service.configs || []) {
    const cfg = map.get(id);
    if (!cfg || !cfg.data || typeof cfg.data !== 'object') continue;
    const d = cfg.data;

    if (!interceptDisplay && looksLikeIntercept(cfg)) {
      const addrs = Array.isArray(d.addresses) ? d.addresses : [];
      const primaryAddr = typeof addrs[0] === 'string' ? addrs[0] : typeof d.hostname === 'string' ? d.hostname : undefined;
      const protos = Array.isArray(d.protocols) ? d.protocols : [];
      const proto = typeof protos[0] === 'string' ? protos[0] : typeof d.protocol === 'string' ? d.protocol : 'tcp';
      protocol = proto.toLowerCase();

      const ranges = Array.isArray(d.portRanges) ? d.portRanges : [];
      const firstRange = ranges[0] as { low?: unknown; high?: unknown } | undefined;
      if (primaryAddr) {
        interceptAddress = primaryAddr;
        if (firstRange && typeof firstRange.low === 'number' && typeof firstRange.high === 'number') {
          if (firstRange.low === firstRange.high) {
            singlePort = firstRange.low;
            interceptDisplay = `${primaryAddr}:${firstRange.low}`;
          } else {
            interceptDisplay = `${primaryAddr}:${firstRange.low}-${firstRange.high}`;
          }
        } else if (typeof d.port === 'number') {
          singlePort = d.port;
          interceptDisplay = `${primaryAddr}:${d.port}`;
        } else {
          interceptDisplay = primaryAddr;
        }
      }
      continue;
    }

    if (!hostDisplay && looksLikeHost(cfg)) {
      const terms = Array.isArray(d.terminators) ? d.terminators : [];
      const h = (terms[0] && typeof terms[0] === 'object' ? terms[0] : d) as Record<string, unknown>;
      const addr = typeof h.address === 'string' ? h.address : typeof h.hostname === 'string' ? h.hostname : undefined;
      const port = typeof h.port === 'number' ? h.port : undefined;
      if (addr && port !== undefined) hostDisplay = `${addr}:${port}`;
      else if (addr) hostDisplay = addr;
    }
  }

  let url: string | undefined;
  if (
    interceptAddress &&
    singlePort !== undefined &&
    protocol === 'tcp' &&
    !interceptAddress.includes('*') &&
    !interceptAddress.includes('/')
  ) {
    const lowerName = service.name.toLowerCase();
    const isHttps = HTTPS_PORTS.has(singlePort) || lowerName.includes('https') || lowerName.includes('k8s-api');
    const isHttp =
      HTTP_PORTS.has(singlePort) || /\b(http|ollama|grafana|jenkins|api|web)\b/i.test(service.name);
    if (isHttps) url = `https://${interceptAddress}:${singlePort}`;
    else if (isHttp) url = `http://${interceptAddress}:${singlePort}`;
  }

  return {
    interceptDisplay,
    hostDisplay,
    url,
    protocol: interceptDisplay ? protocol : undefined,
  };
}
