import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle, Crosshair, Download, MapPin, Pause, Play, RefreshCw, Save, Search, Undo2, X } from 'lucide-react';
import { csvFileName, downloadText, toCsv } from '../components/csv';
import { Link } from 'react-router-dom';
import type { ApiSession, EdgeRouter, Identity, TransitRouter } from '../services/api-types';
import { useServiceLoad } from '../components/state-hooks';
import { zitiService } from '../services/ziti-service';
import { MAP_TILE_URL } from '../features/network-map/map-tiles';
import { PlaceResult, searchPlaces } from '../features/network-map/geocode';
import {
  IpLookupError,
  IpPlace,
  demoLookupPrefix,
  getIpGeoKey,
  lookupPrefix,
  truncateIp,
} from '../features/network-map/ip-geolocation';
import {
  FabricCircuit,
  FabricLink,
  FabricRouter,
  GeoPoint,
  MapCircuit,
  MapLink,
  MapNode,
  MapNodeKind,
  RECENT_CIRCUIT_MS,
  SeenCircuit,
  circuitLoad,
  circuitPath,
  circuitRouters,
  formatGeolocation,
  matchesLocationQuery,
  mergeCircuitHistory,
  normalizeCircuit,
  normalizeLink,
  parseCoordinates,
  parseGeolocation,
  spreadOffsets,
} from '../features/network-map/network-map.logic';

type ToastFn = (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;

/** Circuits last as long as one connection, so poll often while the page is visible. */
const LIVE_REFRESH_MS = 5000;

/**
 * Circuit history outlives the page component (switching to another page and back keeps it),
 * but belongs to one controller session: it resets on sign-in/out, demo toggle or new controller.
 */
let historyCache: { key: string; seen: Map<string, SeenCircuit> } = { key: '', seen: new Map() };
const historyKey = () => `${zitiService.isAuthenticated()}|${zitiService.isDemoMode()}|${zitiService.getSettings().selectedEdgeController}`;
const cachedHistory = () => (historyCache.key === historyKey() ? historyCache.seen : new Map<string, SeenCircuit>());

const KIND_COLLECTION: Record<MapNodeKind, 'identities' | 'edge-routers' | 'transit-routers'> = {
  identity: 'identities',
  'edge-router': 'edge-routers',
  'transit-router': 'transit-routers',
};

const KIND_LETTER: Record<MapNodeKind, string> = { identity: 'I', 'edge-router': 'E', 'transit-router': 'T' };

/** Legend swatches (HTML, where var() works). Map lines use the `.bpc-link` CSS classes. */
const LEVEL_VAR: Record<MapLink['level'], string> = {
  good: 'var(--ac-ok)',
  warn: 'var(--ac-pending)',
  bad: 'var(--ac-bad)',
  unknown: 'var(--ac-muted)',
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function age(iso: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

/** Age of a millisecond timestamp, in the same style as `age`. */
const ago = (ms: number) => age(new Date(ms).toISOString()) || '0s';

/**
 * Network Map: routers and identities placed by their `geolocation` tag, fabric links coloured
 * by latency, and live circuits drawn client -> routers -> host. Locations can be placed or
 * dragged and saved back to the controller as tags.
 */
export const NetworkMapPage: React.FC<{ onToast: ToastFn }> = ({ onToast }) => {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [edgeRouters, setEdgeRouters] = useState<EdgeRouter[]>([]);
  const [transitRouters, setTransitRouters] = useState<TransitRouter[]>([]);
  const [apiSessions, setApiSessions] = useState<ApiSession[]>([]);
  const [fabric, setFabric] = useState<{ routers: FabricRouter[]; links: FabricLink[]; circuits: FabricCircuit[] } | null>(
    null,
  );
  const [fabricError, setFabricError] = useState('');
  const [history, setHistory] = useState<Map<string, SeenCircuit>>(cachedHistory);
  const [showRecent, setShowRecent] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [live, setLive] = useState(true);

  const [tab, setTab] = useState<'circuits' | 'locations'>('circuits');
  const [selectedCircuit, setSelectedCircuit] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(true);
  /** Show placed identities that are not in a circuit right now. Off declutters large networks. */
  const [showIdleIdentities, setShowIdleIdentities] = useState(true);
  const [query, setQuery] = useState('');
  const [unplacedOnly, setUnplacedOnly] = useState(false);

  const [editMode, setEditMode] = useState(false);
  /** Nodes the next map click will place (one from its row, or a bulk selection). */
  const [placing, setPlacing] = useState<MapNode[]>([]);
  /** Location rows ticked for bulk placement. */
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  /** Unsaved location edits: id -> new point, or null to clear the location. */
  const [pending, setPending] = useState<Map<string, GeoPoint | null>>(() => new Map());
  const [saving, setSaving] = useState(false);

  /** IP suggestions applied this session: identity id -> the prefix sent and the place found. */
  const [ipSuggested, setIpSuggested] = useState<Map<string, { prefix: string; place: IpPlace }>>(() => new Map());
  const [ipBusy, setIpBusy] = useState<{ done: number; total: number } | null>(null);
  const ipAbort = useRef<AbortController | null>(null);

  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[] | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const placeAbort = useRef<AbortController | null>(null);

  const loadEntities = useServiceLoad(
    () =>
      Promise.all([
        zitiService.list('identities'),
        zitiService.list('edge-routers'),
        zitiService.list('transit-routers').catch(() => [] as TransitRouter[]),
        // Only for showing client IPs and IP-based suggestions; the map works without them.
        zitiService.list('api-sessions').catch(() => [] as ApiSession[]),
      ]),
    ([ids, ers, trs, sess]) => {
      setIdentities(ids);
      setEdgeRouters(ers);
      setTransitRouters(trs);
      setApiSessions(sess);
    },
    (err) => onToast('error', 'Failed to load the network', zitiService.errorText(err)),
  );

  // Fabric state (links, circuits) changes without service events: loaded on mount, on demand,
  // and on the live-refresh timer.
  const loadFabric = useServiceLoad(
    () =>
      Promise.all([
        zitiService.listFabric('routers'),
        zitiService.listFabric('links'),
        zitiService.listFabric('circuits'),
      ]),
    ([routers, links, circuits]) => {
      setFabric({ routers, links, circuits });
      setHistory((prev) => {
        const seen = mergeCircuitHistory(prev, circuits.map((c) => normalizeCircuit(c)), Date.now());
        historyCache = { key: historyKey(), seen };
        return seen;
      });
      setFabricError('');
      setLoadedAt(new Date());
    },
    (err) => {
      setFabric(null);
      setFabricError(zitiService.errorText(err));
      setLoadedAt(new Date());
    },
    { onChange: false },
  );

  const loadAll = useCallback(() => Promise.all([loadEntities(), loadFabric()]), [loadEntities, loadFabric]);

  useEffect(() => {
    if (!live) return;
    // Skip polls while the tab is hidden; circuits that end meanwhile are caught on return.
    const t = setInterval(() => {
      if (!document.hidden) loadFabric();
    }, LIVE_REFRESH_MS);
    return () => clearInterval(t);
  }, [live, loadFabric]);

  // ---------------------------------------------------------------- derived model

  const circuits: MapCircuit[] = useMemo(
    () => (fabric?.circuits || []).map((c) => normalizeCircuit(c)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [fabric],
  );

  const nodes = useMemo(() => {
    const map = new Map<string, MapNode>();
    const via = circuitRouters(circuits);
    const fabricRouter = new Map((fabric?.routers || []).map((r) => [r.id, r]));
    const pointOf = (id: string, tags?: Record<string, unknown>) =>
      pending.has(id) ? pending.get(id)! : parseGeolocation(tags?.geolocation);
    for (const r of transitRouters) {
      const f = fabricRouter.get(r.id);
      map.set(r.id, {
        id: r.id,
        name: r.name,
        kind: 'transit-router',
        online: f ? !!f.connected : r.isOnline ?? null,
        point: pointOf(r.id, r.tags),
        approxVia: null,
        attributes: [], // transit routers have no role attributes
        tags: r.tags || {},
      });
    }
    for (const r of edgeRouters) {
      const f = fabricRouter.get(r.id);
      map.set(r.id, {
        id: r.id,
        name: r.name,
        kind: 'edge-router',
        online: f ? !!f.connected : r.isOnline ?? null,
        point: pointOf(r.id, r.tags),
        approxVia: null,
        attributes: r.roleAttributes || [],
        tags: r.tags || {},
      });
    }
    for (const i of identities) {
      if (map.has(i.id)) continue; // a router's own identity shares its id
      const own = pointOf(i.id, i.tags);
      // No location of its own: draw it at the router its circuits enter through, if that is placed.
      const viaId = !own && !pending.has(i.id) ? via.get(i.id) : undefined;
      const viaPoint = viaId ? map.get(viaId)?.point || null : null;
      map.set(i.id, {
        id: i.id,
        name: i.name,
        kind: 'identity',
        online: i.hasEdgeRouterConnection ?? null,
        point: own || viaPoint,
        approxVia: viaPoint ? viaId! : null,
        attributes: i.roleAttributes || [],
        tags: i.tags || {},
      });
    }
    return map;
  }, [identities, edgeRouters, transitRouters, fabric, circuits, pending]);

  const links: MapLink[] = useMemo(
    () => (fabric?.links || []).map(normalizeLink).filter((l): l is MapLink => !!l),
    [fabric],
  );
  const load = useMemo(() => circuitLoad(circuits), [circuits]);
  /** Circuits seen earlier that have since ended, most recently seen first. */
  const recent = useMemo(
    () => [...history.values()].filter((h) => h.endedBy !== null).sort((a, b) => b.lastSeen - a.lastSeen),
    [history],
  );
  const recentById = useMemo(() => new Map(recent.map((h) => [h.circuit.id, h])), [recent]);
  /** Each identity's client IP, from its most recently active API session. */
  const ipOf = useMemo(() => {
    const latest = new Map<string, { ip: string; at: string }>();
    for (const s of apiSessions) {
      const id = s.identityId || s.identity?.id;
      if (!id || !s.ipAddress) continue;
      const at = s.lastActivityAt || s.updatedAt || s.createdAt || '';
      const prev = latest.get(id);
      if (!prev || at > prev.at) latest.set(id, { ip: s.ipAddress, at });
    }
    return new Map([...latest].map(([id, v]) => [id, v.ip]));
  }, [apiSessions]);
  const nameOf = useCallback((id: string | null) => (id ? nodes.get(id)?.name || id : '—'), [nodes]);

  const routerNodes = [...nodes.values()].filter((n) => n.kind !== 'identity');
  const routersOnline = routerNodes.filter((n) => n.online).length;
  const linksUp = links.filter((l) => l.up).length;
  const selected = circuits.find((c) => c.id === selectedCircuit) || recentById.get(selectedCircuit || '')?.circuit || null;
  const selectedPath = selected ? circuitPath(selected, nodes) : null;

  // ---------------------------------------------------------------- Leaflet map

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{ links: L.LayerGroup; circuits: L.LayerGroup; markers: L.LayerGroup } | null>(null);
  const fittedRef = useRef(false);
  const placingRef = useRef<MapNode[]>([]);
  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

  /** Gives every node waiting to be placed this location. False when nothing is being placed. */
  const placeAt = useCallback((point: GeoPoint) => {
    const targets = placingRef.current;
    if (!targets.length) return false;
    setPending((prev) => {
      const next = new Map(prev);
      for (const t of targets) next.set(t.id, point);
      return next;
    });
    setPlacing([]);
    setChecked(new Set());
    return true;
  }, []);

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, { worldCopyJump: true, minZoom: 2, zoomControl: true }).setView([30, 0], 2);
    // MAP_TILE_ORIGIN is allowed by the production CSP (vite.config.ts).
    L.tileLayer(MAP_TILE_URL, {
      attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
      maxZoom: 19,
    }).addTo(map);
    layersRef.current = {
      links: L.layerGroup().addTo(map),
      circuits: L.layerGroup().addTo(map),
      markers: L.layerGroup().addTo(map),
    };
    map.on('click', (e: L.LeafletMouseEvent) => {
      placeAt({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    // The container is sized by flex layout; let Leaflet measure it after first paint.
    const frame = requestAnimationFrame(() => map.invalidateSize());
    return () => {
      cancelAnimationFrame(frame); // the map may be removed before the frame runs
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, [placeAt]);

  useEffect(() => {
    mapDiv.current?.classList.toggle('bpc-map-placing', placing.length > 0);
  }, [placing]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.links.clearLayers();
    layers.circuits.clearLayers();
    layers.markers.clearLayers();

    if (showLinks) {
      for (const l of links) {
        const a = nodes.get(l.a);
        const b = nodes.get(l.b);
        if (!a?.point || !b?.point) continue;
        // Colour comes from CSS (`.bpc-link.<level>`): SVG stroke attributes cannot use var().
        L.polyline([a.point, b.point], {
          className: `bpc-link ${l.level}`,
          weight: 3,
          opacity: selected ? 0.35 : 0.85,
          dashArray: l.up ? undefined : '4 6',
        })
          .bindTooltip(
            `${escapeHtml(a.name)} ↔ ${escapeHtml(b.name)}<br>${
              l.up ? (l.latencyMs !== null ? `${l.latencyMs} ms` : 'latency not reported') : 'link down'
            }`,
            { sticky: true },
          )
          .addTo(layers.links);
      }
    }

    const drawCircuit = (c: MapCircuit, emphasis: boolean) => {
      const p = circuitPath(c, nodes);
      if (p.points.length < 2) return;
      const ended = recentById.get(c.id);
      if (ended) {
        // Ended: a faint, still line under the live ones.
        L.polyline(p.points, {
          className: 'bpc-circuit ended',
          weight: emphasis ? 4 : 2.5,
          opacity: emphasis ? 0.9 : 0.55,
          dashArray: '2 6',
        })
          .on('click', () => setSelectedCircuit(c.id))
          .bindTooltip(
            `${escapeHtml(c.serviceName)}: ${escapeHtml(nameOf(c.clientId))} → ${escapeHtml(nameOf(c.hostId))}<br>ended, last seen ${ago(ended.lastSeen)} ago`,
            { sticky: true },
          )
          .addTo(layers.circuits);
        return;
      }
      // A light casing under the line keeps circuits distinct from (green) healthy links.
      L.polyline(p.points, { className: 'bpc-circuit-halo', weight: emphasis ? 10 : 6, opacity: 0.9, interactive: false }).addTo(
        layers.circuits,
      );
      // The dash pattern moves from client toward host, so the direction of the circuit is visible.
      L.polyline(p.points, {
        className: 'bpc-circuit flow',
        weight: emphasis ? 5 : 3,
        opacity: emphasis ? 1 : 0.8,
        dashArray: emphasis ? '10 6' : '6 8',
      })
        .on('click', () => setSelectedCircuit(c.id))
        .bindTooltip(`${escapeHtml(c.serviceName)}: ${escapeHtml(nameOf(c.clientId))} → ${escapeHtml(nameOf(c.hostId))}`, {
          sticky: true,
        })
        .addTo(layers.circuits);
    };
    if (selected) drawCircuit(selected, true);
    else {
      if (showRecent) recent.forEach((h) => drawCircuit(h.circuit, false));
      circuits.forEach((c) => drawCircuit(c, false));
    }

    const inSelected = new Set(selected ? [selected.clientId, ...selected.routerIds, selected.hostId] : []);
    // Identities in a circuit or with unsaved edits always show; idle ones can be hidden to declutter.
    const visible = [...nodes.values()].filter(
      (n): n is MapNode & { point: GeoPoint } =>
        !!n.point && (n.kind !== 'identity' || showIdleIdentities || load.has(n.id) || pending.has(n.id)),
    );
    // Markers sharing a point (a router and the identities drawn at it, or a bulk placement) fan out.
    const offsets = spreadOffsets(visible.map((n) => ({ id: n.id, point: n.point, center: n.kind !== 'identity' })));
    for (const n of visible) {
      const [dx, dy] = offsets.get(n.id) || [0, 0];
      const count = load.get(n.id) || 0;
      const cls = [
        'bpc-pin',
        n.kind,
        n.online === true ? 'on' : n.online === false ? 'off' : '',
        inSelected.has(n.id) ? 'hl' : '',
        pending.has(n.id) ? 'edited' : '',
        n.approxVia ? 'approx' : '',
      ].join(' ');
      const marker = L.marker(n.point, {
        draggable: editMode,
        title: n.name,
        icon: L.divIcon({
          className: 'bpc-map-marker',
          html: `<span class="${cls}">${KIND_LETTER[n.kind]}</span>${count ? `<b class="bpc-pin-count">${count}</b>` : ''}`,
          iconSize: [24, 24],
          iconAnchor: [12 - dx, 12 - dy],
          tooltipAnchor: [dx, dy],
        }),
      })
        .bindTooltip(
          `<strong>${escapeHtml(n.name)}</strong><br>${n.kind.replace('-', ' ')} · ${
            n.online === true ? 'online' : n.online === false ? 'offline' : 'status unknown'
          }${ipOf.has(n.id) ? `<br>IP ${escapeHtml(ipOf.get(n.id)!)}` : ''}${count ? `<br>${count} circuit${count === 1 ? '' : 's'}` : ''}${
            n.approxVia ? `<br><em>Approximate: no location set, shown at ${escapeHtml(nameOf(n.approxVia))}</em>` : ''
          }`,
        )
        .addTo(layers.markers);
      if (editMode) {
        marker.on('dragend', () => {
          // The marker's latlng is its anchor; the pin the user dropped sits (dx, dy) pixels from it.
          const ll = map.layerPointToLatLng(map.latLngToLayerPoint(marker.getLatLng()).add([dx, dy]));
          setPending((prev) => new Map(prev).set(n.id, { lat: ll.lat, lng: ll.lng }));
        });
      }
    }

    if (!fittedRef.current) {
      const pts = [...nodes.values()].filter((n) => n.point && n.kind !== 'identity').map((n) => n.point!);
      if (pts.length) {
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 5 });
        fittedRef.current = true;
      }
    }
  }, [nodes, links, circuits, recent, recentById, showRecent, selected, showLinks, showIdleIdentities, editMode, load, pending, nameOf, ipOf]);

  useEffect(() => {
    if (selectedPath && selectedPath.points.length && mapRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(selectedPath.points), { padding: [60, 60], maxZoom: 6 });
    }
    // Only re-fit when the selection changes, not on every live refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCircuit]);

  // ---------------------------------------------------------------- typed locations

  /** Places the waiting nodes at a typed location, or just shows it when nothing is waiting. */
  const goTo = (point: GeoPoint) => {
    placeAt(point);
    setPlaceResults(null);
    mapRef.current?.setView(point, Math.max(mapRef.current.getZoom(), 9));
  };

  const searchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = placeQuery.trim();
    if (!text) return;
    setPlaceError('');
    const coords = parseCoordinates(text);
    if (coords) {
      goTo(coords);
      return;
    }
    placeAbort.current?.abort();
    const ctrl = new AbortController();
    placeAbort.current = ctrl;
    setPlaceBusy(true);
    try {
      const found = await searchPlaces(text, ctrl.signal);
      setPlaceResults(found);
      if (!found.length) setPlaceError(`No places found for "${text}".`);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setPlaceResults(null);
      setPlaceError(err instanceof Error ? err.message : String(err));
    } finally {
      if (placeAbort.current === ctrl) setPlaceBusy(false);
    }
  };

  useEffect(() => () => placeAbort.current?.abort(), []);

  // ---------------------------------------------------------------- IP suggestions

  const demo = zitiService.isDemoMode();
  const ipKey = getIpGeoKey();
  /** Identities without a location of their own that have a client IP, with what would be sent. */
  const ipCandidates = useMemo(() => {
    const out: { node: MapNode; ip: string; prefix: string | null }[] = [];
    for (const n of nodes.values()) {
      if (n.kind !== 'identity' || (n.point && !n.approxVia) || pending.has(n.id)) continue;
      const ip = ipOf.get(n.id);
      if (!ip) continue;
      const t = truncateIp(ip, demo);
      out.push({ node: n, ip, prefix: 'prefix' in t ? t.prefix : null });
    }
    return out;
  }, [nodes, pending, ipOf, demo]);
  const lookupable = ipCandidates.filter((c) => c.prefix);
  const prefixCount = new Set(lookupable.map((c) => c.prefix)).size;

  const suggestFromIp = async () => {
    const ctrl = new AbortController();
    ipAbort.current = ctrl;
    const prefixes = [...new Set(lookupable.map((c) => c.prefix!))];
    const found = new Map<string, IpPlace>();
    const problems: string[] = [];
    setIpBusy({ done: 0, total: prefixes.length });
    // One lookup per prefix, one at a time: identities on the same network share a result.
    for (const [i, prefix] of prefixes.entries()) {
      if (ctrl.signal.aborted) break;
      try {
        found.set(prefix, demo ? await demoLookupPrefix(prefix) : await lookupPrefix(prefix, ipKey, ctrl.signal));
      } catch (err) {
        if (ctrl.signal.aborted) break;
        problems.push(`${prefix}: ${err instanceof Error ? err.message : String(err)}`);
        if (err instanceof IpLookupError && err.fatal) break; // bad key or quota: stop spending requests
      }
      setIpBusy({ done: i + 1, total: prefixes.length });
    }
    setIpBusy(null);
    const applied = lookupable.filter((c) => found.has(c.prefix!));
    setPending((prev) => {
      const next = new Map(prev);
      for (const c of applied) {
        const p = found.get(c.prefix!)!;
        next.set(c.node.id, { lat: p.lat, lng: p.lng });
      }
      return next;
    });
    setIpSuggested((prev) => {
      const next = new Map(prev);
      for (const c of applied) next.set(c.node.id, { prefix: c.prefix!, place: found.get(c.prefix!)! });
      return next;
    });
    const skipped = ipCandidates.length - lookupable.length;
    const detail = [
      applied.length ? `${applied.length} unsaved location${applied.length === 1 ? '' : 's'} to review.` : '',
      skipped ? `${skipped} skipped (private or non-public IP, never sent).` : '',
      problems.length ? `Not found: ${problems.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    onToast(
      applied.length ? (problems.length ? 'warning' : 'success') : 'error',
      applied.length ? 'Suggested from IP' : 'No IP suggestions',
      detail,
    );
  };

  useEffect(() => () => ipAbort.current?.abort(), []);

  // ---------------------------------------------------------------- saving locations

  const saveLocations = async () => {
    setSaving(true);
    const failures: string[] = [];
    const done = new Set<string>();
    for (const [id, point] of pending) {
      const n = nodes.get(id);
      if (!n) {
        done.add(id);
        continue;
      }
      try {
        await zitiService.saveGeolocation(KIND_COLLECTION[n.kind], n, point ? formatGeolocation(point) : null);
        done.add(id);
      } catch (err) {
        failures.push(`${n.name}: ${zitiService.errorText(err)}`);
      }
    }
    const saved = done.size;
    setSaving(false);
    await loadEntities();
    // Keep only the edits that failed, so they can be retried.
    setPending((prev) => new Map([...prev].filter(([id]) => !done.has(id))));
    setIpSuggested((prev) => new Map([...prev].filter(([id]) => !done.has(id))));
    if (failures.length) onToast('error', `Saved ${saved}, ${failures.length} failed`, failures.join('; '));
    else onToast('success', 'Locations saved', `${saved} location${saved === 1 ? '' : 's'} written to the controller as tags.`);
  };

  // ---------------------------------------------------------------- render

  const q = query.trim().toLowerCase();
  const matchesCircuit = (c: MapCircuit) =>
    !q || [c.serviceName, nameOf(c.clientId), nameOf(c.hostId), ...c.routerIds.map(nameOf)].join(' ').toLowerCase().includes(q);
  const circuitRows = circuits.filter(matchesCircuit);
  const recentRows = showRecent ? recent.filter((h) => matchesCircuit(h.circuit)) : [];

  const exportCircuits = () => {
    const iso = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString());
    const row = (c: MapCircuit, status: string, lastSeen: number | null, endedBy: number | null) => [
      status,
      c.serviceName,
      nameOf(c.clientId),
      nameOf(c.hostId),
      c.routerIds.map(nameOf).join(' > '),
      c.createdAt || '',
      iso(lastSeen),
      iso(endedBy),
      c.id,
    ];
    const now = Date.now();
    const rows = [
      ...circuits.map((c) => row(c, 'active', history.get(c.id)?.lastSeen ?? now, null)),
      ...recent.map((h) => row(h.circuit, 'ended', h.lastSeen, h.endedBy)),
    ];
    downloadText(
      csvFileName('circuits'),
      toCsv(['Status', 'Service', 'Client', 'Host', 'Path', 'Started', 'Last seen', 'Ended by', 'Circuit ID'], rows),
    );
  };
  const locationRows = [...nodes.values()]
    .filter((n) => (!unplacedOnly || !n.point || n.approxVia) && matchesLocationQuery(n, q))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'identity' ? 1 : -1));
  const LOCATION_CAP = 300;
  const shownRows = locationRows.slice(0, LOCATION_CAP);
  const allShownChecked = shownRows.length > 0 && shownRows.every((n) => checked.has(n.id));
  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startPlacing = (targets: MapNode[]) => {
    setPlacing(targets);
    setEditMode(true);
  };

  const renderCircuit = (c: MapCircuit, ended: SeenCircuit | null) => {
    const isSel = c.id === selectedCircuit;
    const path = isSel ? selectedPath : null;
    return (
      <li key={c.id}>
        <button
          type="button"
          onClick={() => setSelectedCircuit(isSel ? null : c.id)}
          aria-pressed={isSel}
          className={`w-full text-left px-3 py-2.5 space-y-1 cursor-pointer ${
            isSel ? 'bg-[var(--ac-dial-soft)]' : 'hover:bg-[var(--ac-surface-2)]'
          } ${ended && !isSel ? 'opacity-70' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold font-mono">{c.serviceName}</span>
            <span className="text-[var(--ac-muted)]">
              {ended ? `ended · seen ${ago(ended.lastSeen)} ago` : age(c.createdAt)}
            </span>
          </div>
          <div>
            <span className="font-mono">{nameOf(c.clientId)}</span>
            <span className="text-[var(--ac-muted)]"> → </span>
            <span className="font-mono">{nameOf(c.hostId)}</span>
          </div>
          <div className="text-[var(--ac-muted)] font-mono text-[11px]">
            via {c.routerIds.length ? c.routerIds.map(nameOf).join(' › ') : 'unknown routers'}
          </div>
          {path && path.missing.length > 0 && (
            <div className="text-[11px] text-[var(--ac-pending)]">
              Not on the map: {path.missing.map((m) => m.name).join(', ')}. Place them under Locations.
            </div>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight m-0">Network Map</h1>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Routers and identities placed by their <code>geolocation</code> tag, fabric links by latency, and live and
            recent circuits from client to host.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)]">
            Routers <strong>{routersOnline}</strong>/{routerNodes.length} online
          </span>
          {fabric && (
            <>
              <span className="px-2.5 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)]">
                Links <strong>{linksUp}</strong>/{links.length} up
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)]">
                Circuits <strong>{circuits.length}</strong>
                {recent.length > 0 && <span className="text-[var(--ac-muted)]"> · {recent.length} recent</span>}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            title={live ? `Refreshing circuits every ${LIVE_REFRESH_MS / 1000}s` : 'Live refresh paused'}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] cursor-pointer"
          >
            {live ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{live ? 'Live' : 'Paused'}</span>
          </button>
          <button
            type="button"
            onClick={() => loadAll()}
            title={loadedAt ? `Last loaded ${loadedAt.toLocaleTimeString()}` : undefined}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {fabricError && (
        <div role="status" className="flex items-start gap-2 p-3 rounded-xl border border-[var(--ac-pending)] bg-[var(--ac-pending-soft)] text-xs">
          <AlertTriangle className="w-4 h-4 flex-none text-[var(--ac-pending)]" />
          <span>
            Live circuits and links are unavailable (the controller&apos;s <code>/fabric/v1</code> API did not answer:{' '}
            {fabricError}). Router and identity locations can still be viewed and edited.
          </span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-[520px]">
        <div className="relative flex-1 min-h-[420px] rounded-2xl overflow-hidden border border-[var(--ac-line)]">
          <div ref={mapDiv} className="absolute inset-0 bpc-map" aria-label="Network map" />
          <div className="absolute left-14 top-12 right-3 sm:top-3 sm:right-[19.5rem] z-[500] flex flex-wrap gap-1.5 text-[11px] pointer-events-none [&>*]:pointer-events-auto">
            <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow cursor-pointer">
              <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
              Links
            </label>
            <label
              title="Placed identities that are not in an active circuit"
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow cursor-pointer"
            >
              <input type="checkbox" checked={showIdleIdentities} onChange={(e) => setShowIdleIdentities(e.target.checked)} />
              Idle identities
            </label>
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow">
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small edge-router on">E</span>edge</span>
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small transit-router on">T</span>transit</span>
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small identity on">I</span>identity</span>
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small identity on approx">I</span>approx.</span>
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small edge-router off">E</span>offline</span>
            </span>
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow">
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line bpc-legend-circuit" />circuit</span>
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line" style={{ background: 'var(--ac-muted)', opacity: 0.6 }} />ended</span>
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line" style={{ background: LEVEL_VAR.good }} />&lt;50 ms</span>
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line" style={{ background: LEVEL_VAR.warn }} />≤100 ms</span>
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line" style={{ background: LEVEL_VAR.bad }} />slow / down</span>
            </span>
          </div>
          <div className="absolute right-3 top-3 z-[600] w-72 max-w-[calc(100%-4.5rem)] text-[11.5px]">
            <form
              onSubmit={searchPlace}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow"
            >
              <Search className="w-3.5 h-3.5 flex-none text-[var(--ac-muted)]" />
              <input
                type="search"
                value={placeQuery}
                onChange={(e) => {
                  setPlaceQuery(e.target.value);
                  setPlaceError('');
                  if (!e.target.value) setPlaceResults(null);
                }}
                placeholder={placing.length ? 'Place at: city, address or lat,lng' : 'Go to: city, address or lat,lng'}
                aria-label="Find a place or coordinates"
                className="flex-1 min-w-0 bg-transparent py-0.5 outline-none"
              />
              {placeBusy && <span className="text-[var(--ac-muted)]">…</span>}
            </form>
            {(placeResults?.length || placeError) && (
              <div className="mt-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-lg overflow-hidden">
                {placeError && <p className="m-0 px-2.5 py-2 text-[var(--ac-muted)]">{placeError}</p>}
                {placeResults && placeResults.length > 0 && (
                  <>
                    <ul className="m-0 p-0 list-none divide-y divide-[var(--ac-line)]">
                      {placeResults.map((r) => (
                        <li key={`${r.lat},${r.lng},${r.name}`}>
                          <button
                            type="button"
                            onClick={() => goTo(r)}
                            className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--ac-surface-2)] cursor-pointer"
                          >
                            {r.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="m-0 px-2.5 py-1 text-[10px] text-[var(--ac-muted)] border-t border-[var(--ac-line)]">
                      Search © OpenStreetMap contributors
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
          {placing.length > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[500] flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--ac-ink)] text-[var(--ac-surface)] text-xs shadow-xl">
              <Crosshair className="w-3.5 h-3.5" />
              <span>
                Click the map or search above to place{' '}
                <strong>{placing.length === 1 ? placing[0].name : `${placing.length} selected`}</strong>
              </span>
              <button type="button" onClick={() => setPlacing([])} aria-label="Cancel placing" className="cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        <aside className="lg:w-96 flex-none flex flex-col min-h-0 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] text-xs">
          <div className="flex border-b border-[var(--ac-line)]">
            {(['circuits', 'locations'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2.5 font-semibold cursor-pointer ${
                  tab === t ? 'text-[var(--ac-dial)] border-b-2 border-[var(--ac-dial)]' : 'text-[var(--ac-muted)]'
                }`}
              >
                {t === 'circuits' ? `Circuits (${circuits.length}${recent.length ? ` + ${recent.length} recent` : ''})` : `Locations${pending.size ? ` · ${pending.size} unsaved` : ''}`}
              </button>
            ))}
          </div>

          <div className="p-3 border-b border-[var(--ac-line)] space-y-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'circuits' ? 'Filter by service, identity or router…' : 'Filter by name or #attribute…'}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)]"
            />
            {tab === 'circuits' && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  className="inline-flex items-center gap-1.5 cursor-pointer"
                  title={`Circuits that ended in the last ${RECENT_CIRCUIT_MS / 60000} minutes while this console was open`}
                >
                  <input type="checkbox" checked={showRecent} onChange={(e) => setShowRecent(e.target.checked)} />
                  Recent ({RECENT_CIRCUIT_MS / 60000} min)
                </label>
                <button
                  type="button"
                  disabled={!circuits.length && !recent.length}
                  onClick={exportCircuits}
                  title="Active and recent circuits as CSV"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3 h-3" />
                  <span>Export CSV</span>
                </button>
              </div>
            )}
            {tab === 'locations' && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={unplacedOnly} onChange={(e) => setUnplacedOnly(e.target.checked)} />
                  Unplaced only
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editMode}
                    onChange={(e) => {
                      setEditMode(e.target.checked);
                      if (!e.target.checked) setPlacing([]);
                    }}
                  />
                  Drag markers to move
                </label>
              </div>
            )}
            {tab === 'locations' && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allShownChecked}
                    disabled={!shownRows.length}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        for (const n of shownRows) {
                          if (allShownChecked) next.delete(n.id);
                          else next.add(n.id);
                        }
                        return next;
                      })
                    }
                  />
                  Select all shown ({shownRows.length})
                </label>
                {checked.size > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => startPlacing([...checked].map((id) => nodes.get(id)).filter((n): n is MapNode => !!n))}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
                    >
                      <MapPin className="w-3 h-3" />
                      <span>Place {checked.size} selected</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChecked(new Set())}
                      className="px-2 py-1 rounded-md border border-[var(--ac-line)] cursor-pointer"
                    >
                      Clear
                    </button>
                  </span>
                )}
              </div>
            )}
            {tab === 'locations' && ipCandidates.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-[var(--ac-surface-2)] border border-[var(--ac-line)]">
                {ipKey || demo ? (
                  <>
                    <span className="text-[var(--ac-muted)]">
                      {ipBusy
                        ? `Looking up ${ipBusy.done}/${ipBusy.total}…`
                        : prefixCount
                          ? `${ipCandidates.length} unplaced with an IP · ${prefixCount} lookup${prefixCount === 1 ? '' : 's'}${demo ? ' (simulated)' : ''}`
                          : `${ipCandidates.length} unplaced, private IP only (can't be looked up)`}
                    </span>
                    {!prefixCount ? null : ipBusy ? (
                      <button
                        type="button"
                        onClick={() => ipAbort.current?.abort()}
                        className="px-2 py-1 rounded-md border border-[var(--ac-line)] cursor-pointer"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={suggestFromIp}
                        title="Sends only the first three octets (IPv4) or 48 bits (IPv6) of each address to ipgeolocation.io"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--ac-dial)] text-white font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>Suggest from IP</span>
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-[var(--ac-muted)]">
                    {ipCandidates.length} unplaced with an IP. Add an ipgeolocation.io key in{' '}
                    <Link to="/settings" className="text-[var(--ac-dial)]">
                      Settings
                    </Link>{' '}
                    to suggest locations from IP.
                  </span>
                )}
              </div>
            )}
            {pending.size > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveLocations}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving…' : `Save ${pending.size} location${pending.size === 1 ? '' : 's'}`}</span>
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setPending(new Map());
                    setIpSuggested(new Map());
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Discard</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto max-h-[60vh] lg:max-h-none">
            {tab === 'circuits' ? (
              circuitRows.length || recentRows.length ? (
                <ul className="m-0 p-0 list-none divide-y divide-[var(--ac-line)]">
                  {circuitRows.map((c) => renderCircuit(c, null))}
                  {recentRows.length > 0 && (
                    <li className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--ac-muted)] bg-[var(--ac-surface-2)]">
                      Recent · ended in the last {RECENT_CIRCUIT_MS / 60000} min
                    </li>
                  )}
                  {recentRows.map((h) => renderCircuit(h.circuit, h))}
                </ul>
              ) : (
                <p className="m-0 p-4 text-[var(--ac-muted)]">
                  {!fabric
                    ? 'Circuits need the fabric API.'
                    : q
                      ? 'No circuits match.'
                      : `No active circuits. A circuit exists only while a connection is open (one per connection), so traffic shows up here as it happens and stays listed for ${RECENT_CIRCUIT_MS / 60000} minutes after it ends, while this console is open.`}
                </p>
              )
            ) : (
              <ul className="m-0 p-0 list-none divide-y divide-[var(--ac-line)]">
                {shownRows.map((n) => (
                  <li key={n.id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked.has(n.id)}
                        onChange={() => toggleChecked(n.id)}
                        aria-label={`Select ${n.name}`}
                        className="mt-0.5 flex-none"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`bpc-pin small ${n.kind} ${n.online ? 'on' : n.online === false ? 'off' : ''} ${
                              n.approxVia ? 'approx' : ''
                            }`}
                          >
                            {KIND_LETTER[n.kind]}
                          </span>
                          <span className="font-mono font-semibold truncate">{n.name}</span>
                          {pending.has(n.id) && <span className="text-[10px] text-[var(--ac-pending)] font-semibold">unsaved</span>}
                        </div>
                        <div className="text-[11px] text-[var(--ac-muted)] font-mono">
                          {n.approxVia ? (
                            <em>≈ at {nameOf(n.approxVia)} (not saved)</em>
                          ) : n.point ? (
                            formatGeolocation(n.point)
                          ) : (
                            'Not placed'
                          )}
                        </div>
                        {ipOf.has(n.id) && (
                          <div className="text-[11px] text-[var(--ac-muted)] font-mono">
                            IP {ipOf.get(n.id)}
                            {ipSuggested.has(n.id) && (
                              <span className="text-[var(--ac-pending)]">
                                {' '}
                                · sent {ipSuggested.get(n.id)!.prefix} → {ipSuggested.get(n.id)!.place.label}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-none">
                      <button
                        type="button"
                        onClick={() => startPlacing([n])}
                        title="Click the map to set this location"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>{n.point && !n.approxVia ? 'Move' : 'Place'}</span>
                      </button>
                      {n.point && !n.approxVia && (
                        <button
                          type="button"
                          onClick={() => setPending((prev) => new Map(prev).set(n.id, null))}
                          title="Remove this location"
                          aria-label={`Remove location of ${n.name}`}
                          className="p-1 rounded-md border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] hover:text-[var(--ac-bad)] cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                {locationRows.length > LOCATION_CAP && (
                  <li className="px-3 py-2 text-[var(--ac-muted)]">
                    Showing {LOCATION_CAP} of {locationRows.length}. Filter by name to find others.
                  </li>
                )}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
