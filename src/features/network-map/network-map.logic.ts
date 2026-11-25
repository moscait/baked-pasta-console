/**
 * Network map: fabric circuits and links normalised across controller versions, entity
 * geolocation (`tags.geolocation = "lat,lng"`, as the upstream console's Geolocate map uses),
 * and the map paths a circuit takes. Pure, so it is tested without Leaflet or the DOM.
 */

// ------------------------------------------------------------------ fabric API shapes

type Ref = { id?: string; name?: string };

/** `/fabric/v1/circuits`. Field names vary across controller versions, so most are optional. */
export interface FabricCircuit {
  id: string;
  clientId?: string;
  client?: Ref;
  initiator?: Ref;
  sourceId?: string;
  host?: Ref;
  hostId?: string;
  serviceId?: string;
  service?: Ref;
  terminatorId?: string;
  terminator?: Ref & { hostId?: string; identityId?: string; identity?: string | Ref };
  path?: { nodes?: (Ref | string)[]; links?: (Ref | string)[] };
  tags?: Record<string, unknown>;
  createdAt?: string;
}

/** `/fabric/v1/links`. Latencies are in nanoseconds. */
export interface FabricLink {
  id: string;
  sourceRouter?: Ref;
  destRouter?: Ref;
  sourceRouterId?: string;
  destRouterId?: string;
  src?: Ref;
  dst?: Ref;
  state?: string;
  down?: boolean;
  cost?: number;
  staticCost?: number;
  protocol?: string;
  sourceLatency?: number;
  destLatency?: number;
}

/** `/fabric/v1/routers`: every router the controller knows, with live connection state. */
export interface FabricRouter {
  id: string;
  name: string;
  connected?: boolean;
  cost?: number;
  noTraversal?: boolean;
  tags?: Record<string, unknown>;
}

export interface FabricEntities {
  circuits: FabricCircuit;
  links: FabricLink;
  routers: FabricRouter;
}

// ------------------------------------------------------------------ geolocation

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Parses a `"lat,lng"` tag. Returns null for anything that is not a valid coordinate pair. */
export function parseGeolocation(tag: unknown): GeoPoint | null {
  if (typeof tag !== 'string') return null;
  const parts = tag.split(',');
  if (parts.length !== 2) return null;
  const [latStr, lngStr] = parts.map((p) => p.trim());
  if (!/^-?\d+(\.\d+)?$/.test(latStr) || !/^-?\d+(\.\d+)?$/.test(lngStr)) return null;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Formats a point as the tag value, rounded to ~1 m and with longitude wrapped into [-180, 180]. */
export function formatGeolocation(p: GeoPoint): string {
  const lng = ((((p.lng + 180) % 360) + 360) % 360) - 180;
  const lat = Math.max(-90, Math.min(90, p.lat));
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

// ------------------------------------------------------------------ circuits & links

export interface MapCircuit {
  id: string;
  serviceId: string;
  serviceName: string;
  /** Identity that dialed the service, when the controller reports it. */
  clientId: string | null;
  /** Identity hosting the service (the terminator's host), when known. */
  hostId: string | null;
  /** Routers the circuit traverses, in order from the client side. */
  routerIds: string[];
  linkIds: string[];
  createdAt: string | null;
}

const idOf = (v: Ref | string | undefined | null): string | null =>
  typeof v === 'string' ? v || null : v?.id || null;

const tagString = (tags: Record<string, unknown> | undefined, key: string): string | null => {
  const v = tags?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/**
 * Normalises a fabric circuit. Client and host identities come from the edge's circuit tags
 * (`clientId`, `hostId`) first, then the other shapes controller versions have used, then the
 * terminator's host (looked up in `terminatorHosts`, terminator id -> identity id).
 */
export function normalizeCircuit(
  c: FabricCircuit,
  terminatorHosts: Map<string, string> = new Map(),
  serviceNames: Map<string, string> = new Map(),
): MapCircuit {
  const serviceId = c.service?.id || c.serviceId || '';
  const terminatorId = c.terminator?.id || c.terminatorId || null;
  const termIdentity = c.terminator?.identity;
  const hostId =
    tagString(c.tags, 'hostId') ||
    c.host?.id ||
    c.hostId ||
    c.terminator?.hostId ||
    c.terminator?.identityId ||
    (typeof termIdentity === 'string' ? termIdentity : termIdentity?.id) ||
    (terminatorId ? terminatorHosts.get(terminatorId) : undefined) ||
    null;
  const clientId =
    tagString(c.tags, 'clientId') || c.client?.id || c.initiator?.id || c.sourceId || c.clientId || null;
  return {
    id: c.id,
    serviceId,
    serviceName: c.service?.name || serviceNames.get(serviceId) || serviceId || 'unknown service',
    clientId,
    hostId,
    routerIds: (c.path?.nodes || []).map(idOf).filter((x): x is string => !!x),
    linkIds: (c.path?.links || []).map(idOf).filter((x): x is string => !!x),
    createdAt: c.createdAt || null,
  };
}

export type LatencyLevel = 'good' | 'warn' | 'bad' | 'unknown';

export interface MapLink {
  id: string;
  a: string;
  b: string;
  up: boolean;
  /** The slower direction's latency in milliseconds, or null when not reported. */
  latencyMs: number | null;
  level: LatencyLevel;
  cost: number | null;
  protocol: string | null;
}

/** Same thresholds as the upstream console: under 50 ms good, up to 100 ms elevated, above that poor. */
export function latencyLevel(ms: number | null): LatencyLevel {
  if (ms === null || !Number.isFinite(ms)) return 'unknown';
  if (ms < 50) return 'good';
  if (ms <= 100) return 'warn';
  return 'bad';
}

export function normalizeLink(l: FabricLink): MapLink | null {
  const a = l.sourceRouter?.id || l.sourceRouterId || l.src?.id;
  const b = l.destRouter?.id || l.destRouterId || l.dst?.id;
  if (!a || !b) return null;
  const lat = [l.sourceLatency, l.destLatency].filter((n): n is number => typeof n === 'number' && n >= 0);
  const latencyMs = lat.length ? Math.round(Math.max(...lat) / 1e5) / 10 : null;
  const up = !l.down && (l.state ? l.state.toLowerCase() === 'connected' : true);
  return {
    id: l.id,
    a,
    b,
    up,
    latencyMs,
    level: up ? latencyLevel(latencyMs) : 'bad',
    cost: typeof l.cost === 'number' ? l.cost : typeof l.staticCost === 'number' ? l.staticCost : null,
    protocol: l.protocol || null,
  };
}

// ------------------------------------------------------------------ map assembly

export type MapNodeKind = 'edge-router' | 'transit-router' | 'identity';

export interface MapNode {
  id: string;
  name: string;
  kind: MapNodeKind;
  /** Online/connected now; null when unknown. */
  online: boolean | null;
  point: GeoPoint | null;
  tags: Record<string, unknown>;
}

export interface CircuitPath {
  circuitId: string;
  /** Located points in travel order: client, routers…, host. Unlocated hops are skipped. */
  points: GeoPoint[];
  /** Hops that could not be drawn because they have no location. */
  missing: { id: string; name: string }[];
}

export function circuitPath(c: MapCircuit, nodes: Map<string, MapNode>): CircuitPath {
  const hops = [c.clientId, ...c.routerIds, c.hostId].filter((x): x is string => !!x);
  const points: GeoPoint[] = [];
  const missing: { id: string; name: string }[] = [];
  for (const id of hops) {
    const n = nodes.get(id);
    if (n?.point) points.push(n.point);
    else missing.push({ id, name: n?.name || id });
  }
  return { circuitId: c.id, points, missing };
}

/** Circuit counts per node (as client, router hop or host), for marker badges. */
export function circuitLoad(circuits: MapCircuit[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const c of circuits) {
    for (const id of new Set([c.clientId, ...c.routerIds, c.hostId])) {
      if (id) load.set(id, (load.get(id) || 0) + 1);
    }
  }
  return load;
}
