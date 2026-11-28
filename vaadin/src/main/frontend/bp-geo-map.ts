import * as L from 'leaflet';

/** Server-driven feature set: polylines first (drawn underneath), then markers. */
interface GeoLine {
  id: string;
  pts: [number, number][];
  color: string;
  width: number;
  dash?: string | null;
  cls?: string | null;
  interactive?: boolean;
  tip?: string[];
}
interface GeoMarker {
  id: string;
  lat: number;
  lng: number;
  icon: string;
  ax: number;
  ay: number;
  size: number;
  draggable: boolean;
  tip?: string[];
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Tooltip HTML from plain-text lines; the first line is bold when `title` is set. */
const tipHtml = (lines: string[], title: boolean) =>
  lines.map((l, i) => (i === 0 && title ? `<strong>${escapeHtml(l)}</strong>` : escapeHtml(l))).join('<br>');
interface GeoData {
  lines: GeoLine[];
  markers: GeoMarker[];
}

/**
 * A Leaflet map in light DOM. The server sets `data` (JSON) and `tiles`, and calls
 * setView / fitTo. Emits bp-map-click {lat,lng}, bp-feature-click {id},
 * bp-marker-drop {id,dLat,dLng} and bp-map-view {zoom}.
 */
class BpGeoMap extends HTMLElement {
  private map?: L.Map;
  private layer = L.featureGroup();
  private tileLayer?: L.TileLayer;
  private resize?: ResizeObserver;
  private pending: (() => void)[] = [];
  /** The last server-requested view; replayed on resize until the user pans or zooms. */
  private lastView: (() => void) | null = null;
  private programmatic = false;
  private _data = '';
  private _tiles = '';
  private _attribution = '';

  set data(json: string) {
    if (json === this._data) return;
    this._data = json;
    if (this.map) this.draw();
  }
  get data() {
    return this._data;
  }

  set tiles(url: string) {
    this._tiles = url;
    if (this.map) this.applyTiles();
  }
  get tiles() {
    return this._tiles;
  }

  set attribution(text: string) {
    this._attribution = text;
    if (this.map) this.applyTiles();
  }
  get attribution() {
    return this._attribution;
  }

  connectedCallback() {
    if (this.map) {
      requestAnimationFrame(() => this.map?.invalidateSize());
      return;
    }
    const map = L.map(this, { center: [30, 0], zoom: 2, minZoom: 2, worldCopyJump: true, zoomControl: true });
    this.map = map;
    this.layer.addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => this.emit('bp-map-click', { lat: e.latlng.lat, lng: e.latlng.lng }));
    map.on('zoomend', () => this.emit('bp-map-view', { zoom: map.getZoom() }));
    this.applyTiles();
    this.draw();
    const userMoved = () => {
      if (!this.programmatic) this.lastView = null;
    };
    map.on('dragstart', userMoved);
    map.on('zoomstart', userMoved);
    this.resize = new ResizeObserver(() => {
      if (this.clientWidth === 0 || this.clientHeight === 0) return;
      map.invalidateSize();
      this.lastView?.();
    });
    this.resize.observe(this);
    const queued = this.pending;
    this.pending = [];
    queued.forEach((fn) => fn());
  }

  disconnectedCallback() {
    // Keep the map: Vaadin may detach and re-attach the same element.
  }

  /** Centers on a point; zoom < 0 keeps the current zoom. */
  setView(lat: number, lng: number, zoom: number) {
    this.run(() => this.map!.setView([lat, lng], zoom < 0 ? this.map!.getZoom() : zoom, { animate: false }));
  }

  /** Fits the map to the given [lat,lng] points. */
  fitTo(pointsJson: string, padding: number, duration: number) {
    this.run(() => {
      const pts = JSON.parse(pointsJson) as [number, number][];
      if (pts.length === 0) return;
      const bounds = L.latLngBounds(pts);
      const opts: L.FitBoundsOptions = { padding: [padding, padding], maxZoom: 9 };
      if (duration > 0) this.map!.flyToBounds(bounds, { ...opts, duration: duration / 1000 });
      else this.map!.fitBounds(bounds, { ...opts, animate: false });
    });
  }

  private run(fn: () => void) {
    const apply = () => {
      this.programmatic = true;
      try {
        fn();
      } finally {
        this.programmatic = false;
      }
    };
    // Layout may not be final on first attach: the resize observer replays this view.
    this.lastView = apply;
    if (this.map) {
      this.map.invalidateSize();
      apply();
    } else this.pending.push(apply);
  }

  private applyTiles() {
    if (!this.map || !this._tiles) return;
    this.tileLayer?.remove();
    this.tileLayer = L.tileLayer(this._tiles, { attribution: this._attribution, crossOrigin: 'anonymous' }).addTo(
      this.map,
    );
  }

  private draw() {
    this.layer.clearLayers();
    if (!this._data) return;
    const data = JSON.parse(this._data) as GeoData;
    for (const l of data.lines) {
      const interactive = l.interactive !== false;
      const line = L.polyline(l.pts, {
        color: l.color,
        weight: l.width,
        opacity: 1,
        interactive,
        dashArray: l.dash ?? undefined,
        className: l.cls ?? undefined,
      });
      if (interactive) {
        line.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          this.emit('bp-feature-click', { id: l.id });
        });
        if (l.tip?.length) line.bindTooltip(tipHtml(l.tip, false), { sticky: true });
      }
      line.addTo(this.layer);
    }
    for (const m of data.markers) {
      const icon = L.icon({ iconUrl: m.icon, iconSize: [m.size, m.size], iconAnchor: [m.ax, m.ay] });
      const marker = L.marker([m.lat, m.lng], { icon, draggable: m.draggable, keyboard: false, autoPan: true });
      if (m.tip?.length) marker.bindTooltip(tipHtml(m.tip, true), { direction: 'top', offset: [0, -12] });
      let start: L.LatLng | null = null;
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        this.emit('bp-feature-click', { id: m.id });
      });
      marker.on('dragstart', () => (start = marker.getLatLng()));
      marker.on('dragend', () => {
        const end = marker.getLatLng();
        if (start) this.emit('bp-marker-drop', { id: m.id, dLat: end.lat - start.lat, dLng: end.lng - start.lng });
        start = null;
      });
      marker.addTo(this.layer);
    }
  }

  private emit(type: string, detail: object) {
    this.dispatchEvent(new CustomEvent(type, { detail: { json: JSON.stringify(detail) } }));
  }
}

customElements.define('bp-geo-map', BpGeoMap);
