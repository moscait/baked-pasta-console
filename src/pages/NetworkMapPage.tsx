import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle, Crosshair, MapPin, Pause, Play, RefreshCw, Save, Undo2, X } from 'lucide-react';
import type { EdgeRouter, Identity, TransitRouter } from '../services/api-types';
import { useServiceLoad } from '../components/state-hooks';
import { zitiService } from '../services/ziti-service';
import {
  FabricCircuit,
  FabricLink,
  FabricRouter,
  GeoPoint,
  MapCircuit,
  MapLink,
  MapNode,
  MapNodeKind,
  circuitLoad,
  circuitPath,
  formatGeolocation,
  normalizeCircuit,
  normalizeLink,
  parseGeolocation,
} from '../features/network-map/network-map.logic';

type ToastFn = (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;

const LIVE_REFRESH_MS = 15000;

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

/**
 * Network Map: routers and identities placed by their `geolocation` tag, fabric links coloured
 * by latency, and live circuits drawn client -> routers -> host. Locations can be placed or
 * dragged and saved back to the controller as tags.
 */
export const NetworkMapPage: React.FC<{ onToast: ToastFn }> = ({ onToast }) => {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [edgeRouters, setEdgeRouters] = useState<EdgeRouter[]>([]);
  const [transitRouters, setTransitRouters] = useState<TransitRouter[]>([]);
  const [fabric, setFabric] = useState<{ routers: FabricRouter[]; links: FabricLink[]; circuits: FabricCircuit[] } | null>(
    null,
  );
  const [fabricError, setFabricError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [live, setLive] = useState(true);

  const [tab, setTab] = useState<'circuits' | 'locations'>('circuits');
  const [selectedCircuit, setSelectedCircuit] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(true);
  const [showAllIdentities, setShowAllIdentities] = useState(false);
  const [query, setQuery] = useState('');
  const [unplacedOnly, setUnplacedOnly] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [placing, setPlacing] = useState<MapNode | null>(null);
  /** Unsaved location edits: id -> new point, or null to clear the location. */
  const [pending, setPending] = useState<Map<string, GeoPoint | null>>(() => new Map());
  const [saving, setSaving] = useState(false);

  const loadEntities = useServiceLoad(
    () =>
      Promise.all([
        zitiService.list('identities'),
        zitiService.list('edge-routers'),
        zitiService.list('transit-routers').catch(() => [] as TransitRouter[]),
      ]),
    ([ids, ers, trs]) => {
      setIdentities(ids);
      setEdgeRouters(ers);
      setTransitRouters(trs);
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
    const t = setInterval(loadFabric, LIVE_REFRESH_MS);
    return () => clearInterval(t);
  }, [live, loadFabric]);

  // ---------------------------------------------------------------- derived model

  const nodes = useMemo(() => {
    const map = new Map<string, MapNode>();
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
        tags: r.tags || {},
      });
    }
    for (const i of identities) {
      if (map.has(i.id)) continue; // a router's own identity shares its id
      map.set(i.id, {
        id: i.id,
        name: i.name,
        kind: 'identity',
        online: i.hasEdgeRouterConnection ?? null,
        point: pointOf(i.id, i.tags),
        tags: i.tags || {},
      });
    }
    return map;
  }, [identities, edgeRouters, transitRouters, fabric, pending]);

  const circuits: MapCircuit[] = useMemo(
    () => (fabric?.circuits || []).map((c) => normalizeCircuit(c)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [fabric],
  );
  const links: MapLink[] = useMemo(
    () => (fabric?.links || []).map(normalizeLink).filter((l): l is MapLink => !!l),
    [fabric],
  );
  const load = useMemo(() => circuitLoad(circuits), [circuits]);
  const nameOf = useCallback((id: string | null) => (id ? nodes.get(id)?.name || id : '—'), [nodes]);

  const routerNodes = [...nodes.values()].filter((n) => n.kind !== 'identity');
  const routersOnline = routerNodes.filter((n) => n.online).length;
  const linksUp = links.filter((l) => l.up).length;
  const selected = circuits.find((c) => c.id === selectedCircuit) || null;
  const selectedPath = selected ? circuitPath(selected, nodes) : null;

  // ---------------------------------------------------------------- Leaflet map

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{ links: L.LayerGroup; circuits: L.LayerGroup; markers: L.LayerGroup } | null>(null);
  const fittedRef = useRef(false);
  const placingRef = useRef<MapNode | null>(null);
  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, { worldCopyJump: true, minZoom: 2, zoomControl: true }).setView([30, 0], 2);
    // Same tile source as the upstream console's Geolocate map.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
      maxZoom: 19,
    }).addTo(map);
    layersRef.current = {
      links: L.layerGroup().addTo(map),
      circuits: L.layerGroup().addTo(map),
      markers: L.layerGroup().addTo(map),
    };
    map.on('click', (e: L.LeafletMouseEvent) => {
      const target = placingRef.current;
      if (!target) return;
      setPending((prev) => new Map(prev).set(target.id, e.latlng));
      setPlacing(null);
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
  }, []);

  useEffect(() => {
    mapDiv.current?.classList.toggle('bpc-map-placing', !!placing);
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
    else circuits.forEach((c) => drawCircuit(c, false));

    const inSelected = new Set(selected ? [selected.clientId, ...selected.routerIds, selected.hostId] : []);
    for (const n of nodes.values()) {
      if (!n.point) continue;
      // Identities are many; by default show only those taking part in a circuit (or edited).
      if (n.kind === 'identity' && !showAllIdentities && !load.has(n.id) && !pending.has(n.id)) continue;
      const count = load.get(n.id) || 0;
      const cls = [
        'bpc-pin',
        n.kind,
        n.online === true ? 'on' : n.online === false ? 'off' : '',
        inSelected.has(n.id) ? 'hl' : '',
        pending.has(n.id) ? 'edited' : '',
      ].join(' ');
      const marker = L.marker(n.point, {
        draggable: editMode,
        title: n.name,
        icon: L.divIcon({
          className: 'bpc-map-marker',
          html: `<span class="${cls}">${KIND_LETTER[n.kind]}</span>${count ? `<b class="bpc-pin-count">${count}</b>` : ''}`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      })
        .bindTooltip(
          `<strong>${escapeHtml(n.name)}</strong><br>${n.kind.replace('-', ' ')} · ${
            n.online === true ? 'online' : n.online === false ? 'offline' : 'status unknown'
          }${count ? `<br>${count} circuit${count === 1 ? '' : 's'}` : ''}`,
        )
        .addTo(layers.markers);
      if (editMode) {
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
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
  }, [nodes, links, circuits, selected, showLinks, showAllIdentities, editMode, load, pending, nameOf]);

  useEffect(() => {
    if (selectedPath && selectedPath.points.length && mapRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(selectedPath.points), { padding: [60, 60], maxZoom: 6 });
    }
    // Only re-fit when the selection changes, not on every live refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCircuit]);

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
    if (failures.length) onToast('error', `Saved ${saved}, ${failures.length} failed`, failures.join('; '));
    else onToast('success', 'Locations saved', `${saved} location${saved === 1 ? '' : 's'} written to the controller as tags.`);
  };

  // ---------------------------------------------------------------- render

  const q = query.trim().toLowerCase();
  const circuitRows = circuits.filter(
    (c) =>
      !q ||
      [c.serviceName, nameOf(c.clientId), nameOf(c.hostId), ...c.routerIds.map(nameOf)].join(' ').toLowerCase().includes(q),
  );
  const locationRows = [...nodes.values()]
    .filter((n) => (!unplacedOnly || !n.point) && (!q || n.name.toLowerCase().includes(q)))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'identity' ? 1 : -1));
  const LOCATION_CAP = 300;

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight m-0">Network Map</h1>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Routers and identities placed by their <code>geolocation</code> tag, fabric links by latency, and live
            circuits from client to host.
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
          <div className="absolute left-14 top-3 z-[500] flex flex-wrap gap-1.5 text-[11px]">
            <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow cursor-pointer">
              <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
              Links
            </label>
            <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow cursor-pointer">
              <input type="checkbox" checked={showAllIdentities} onChange={(e) => setShowAllIdentities(e.target.checked)} />
              All identities
            </label>
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow">
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small edge-router on">E</span>edge</span>
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small transit-router on">T</span>transit</span>
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small identity on">I</span>identity</span>
              <span className="inline-flex items-center gap-1"><span className="bpc-pin small edge-router off">E</span>offline</span>
            </span>
            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow">
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line bpc-legend-circuit" />circuit</span>
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line" style={{ background: LEVEL_VAR.good }} />&lt;50 ms</span>
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line" style={{ background: LEVEL_VAR.warn }} />≤100 ms</span>
              <span className="inline-flex items-center gap-1"><i className="bpc-legend-line" style={{ background: LEVEL_VAR.bad }} />slow / down</span>
            </span>
          </div>
          {placing && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-[500] flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--ac-ink)] text-[var(--ac-surface)] text-xs shadow-xl">
              <Crosshair className="w-3.5 h-3.5" />
              <span>
                Click the map to place <strong>{placing.name}</strong>
              </span>
              <button type="button" onClick={() => setPlacing(null)} aria-label="Cancel placing" className="cursor-pointer">
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
                {t === 'circuits' ? `Circuits (${circuits.length})` : `Locations${pending.size ? ` · ${pending.size} unsaved` : ''}`}
              </button>
            ))}
          </div>

          <div className="p-3 border-b border-[var(--ac-line)] space-y-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'circuits' ? 'Filter by service, identity or router…' : 'Filter by name…'}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)]"
            />
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
                      if (!e.target.checked) setPlacing(null);
                    }}
                  />
                  Drag markers to move
                </label>
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
                  onClick={() => setPending(new Map())}
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
              circuitRows.length ? (
                <ul className="m-0 p-0 list-none divide-y divide-[var(--ac-line)]">
                  {circuitRows.map((c) => {
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
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold font-mono">{c.serviceName}</span>
                            <span className="text-[var(--ac-muted)]">{age(c.createdAt)}</span>
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
                  })}
                </ul>
              ) : (
                <p className="m-0 p-4 text-[var(--ac-muted)]">
                  {fabric ? (q ? 'No circuits match.' : 'No active circuits right now.') : 'Circuits need the fabric API.'}
                </p>
              )
            ) : (
              <ul className="m-0 p-0 list-none divide-y divide-[var(--ac-line)]">
                {locationRows.slice(0, LOCATION_CAP).map((n) => (
                  <li key={n.id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`bpc-pin small ${n.kind} ${n.online ? 'on' : n.online === false ? 'off' : ''}`}>
                          {KIND_LETTER[n.kind]}
                        </span>
                        <span className="font-mono font-semibold truncate">{n.name}</span>
                        {pending.has(n.id) && <span className="text-[10px] text-[var(--ac-pending)] font-semibold">unsaved</span>}
                      </div>
                      <div className="text-[11px] text-[var(--ac-muted)] font-mono">
                        {n.point ? formatGeolocation(n.point) : 'Not placed'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-none">
                      <button
                        type="button"
                        onClick={() => {
                          setPlacing(n);
                          setEditMode(true);
                        }}
                        title="Click the map to set this location"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>{n.point ? 'Move' : 'Place'}</span>
                      </button>
                      {n.point && (
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
