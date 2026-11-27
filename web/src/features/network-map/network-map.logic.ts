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
  /** Where the node is drawn: its own location, or (when `approxVia` is set) its router's. */
  point: GeoPoint | null;
  /**
   * Set for an identity with no location of its own that is drawn at the router it reaches the
   * fabric through (see `circuitRouters`). Display only: nothing is written to the controller.
   */
  approxVia: string | null;
  attributes: string[];
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

/**
 * The router each identity reaches the fabric through, from its circuits: the first hop for a
 * dialing client, the last for a hosting identity. Circuits are taken in the order given (newest
 * first), and the first circuit seen for an identity wins.
 */
export function circuitRouters(circuits: MapCircuit[]): Map<string, string> {
  const via = new Map<string, string>();
  for (const c of circuits) {
    if (!c.routerIds.length) continue;
    if (c.clientId && !via.has(c.clientId)) via.set(c.clientId, c.routerIds[0]);
    if (c.hostId && !via.has(c.hostId)) via.set(c.hostId, c.routerIds[c.routerIds.length - 1]);
  }
  return via;
}

/** Spacing between markers spread around a shared point, in screen pixels. */
export const SPREAD_PX = 26;

/**
 * Screen-pixel offsets that fan out markers drawn at the same point (identities placed together,
 * or drawn approximately at their router) so each stays visible and clickable. In a group, the
 * first `center` item stays on the point and the rest ring around it; lone markers get [0, 0].
 */
export function spreadOffsets(items: { id: string; point: GeoPoint; center?: boolean }[]): Map<string, [number, number]> {
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const key = `${it.point.lat.toFixed(5)},${it.point.lng.toFixed(5)}`;
    const g = groups.get(key);
    if (g) g.push(it);
    else groups.set(key, [it]);
  }
  const out = new Map<string, [number, number]>();
  for (const g of groups.values()) {
    const hub = g.find((it) => it.center);
    if (hub) out.set(hub.id, [0, 0]);
    const ring = g.filter((it) => it !== hub);
    if (!hub && ring.length === 1) {
      out.set(ring[0].id, [0, 0]);
      continue;
    }
    // Large groups get a wider ring so neighbours stay SPREAD_PX apart.
    const radius = Math.max(SPREAD_PX, (ring.length * SPREAD_PX) / (2 * Math.PI));
    ring.forEach((it, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length; // from 12 o'clock, clockwise
      out.set(it.id, [Math.round(radius * Math.cos(angle)), Math.round(radius * Math.sin(angle))]);
    });
  }
  return out;
}

/** Location-list filter: `#text` matches role attributes, anything else the name. */
export function matchesLocationQuery(n: Pick<MapNode, 'name' | 'attributes'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (q.startsWith('#')) {
    const attr = q.slice(1);
    return n.attributes.some((a) => a.toLowerCase().includes(attr));
  }
  return n.name.toLowerCase().includes(q);
}

/**
 * Parses coordinates typed by a person: "39.04, -77.48", "39.04 -77.48", or with hemisphere
 * letters and degree signs ("39.04°N 77.48°W"). Returns null when the text is not a coordinate
 * pair, so it can be treated as a place name instead.
 */
export function parseCoordinates(text: string): GeoPoint | null {
  const m = text
    .trim()
    .toUpperCase()
    .match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/);
  if (!m) return null;
  let lat = Number(m[1]);
  let lng = Number(m[3]);
  if (m[2] === 'S') lat = -Math.abs(lat);
  if (m[4] === 'W') lng = -Math.abs(lng);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** How long an ended circuit stays on the map as "recent". */
export const RECENT_CIRCUIT_MS = 10 * 60 * 1000;

export interface SeenCircuit {
  circuit: MapCircuit;
  /** When a refresh last saw it active (ms since epoch). */
  lastSeen: number;
  /** Set once a refresh no longer lists it; it ended between lastSeen and this time. */
  endedBy: number | null;
}

/**
 * Folds one fabric refresh into the circuit history: active circuits are (re)marked live,
 * circuits that disappeared are marked ended, and ended ones older than `windowMs` are dropped.
 * Circuits are short-lived (one per connection), so without this most traffic is never seen.
 */
export function mergeCircuitHistory(
  prev: Map<string, SeenCircuit>,
  active: MapCircuit[],
  now: number,
  windowMs = RECENT_CIRCUIT_MS,
): Map<string, SeenCircuit> {
  const next = new Map<string, SeenCircuit>();
  for (const c of active) next.set(c.id, { circuit: c, lastSeen: now, endedBy: null });
  for (const [id, seen] of prev) {
    if (next.has(id)) continue;
    const ended = seen.endedBy ?? now;
    if (now - ended <= windowMs) next.set(id, { ...seen, endedBy: ended });
  }
  return next;
}
