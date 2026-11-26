/**
 * Place-name search for the Network Map, via OpenStreetMap's Nominatim. Only the typed text is
 * sent, and only when the person submits a search: Nominatim's usage policy allows no
 * search-as-you-type and about one request per second. Results need OSM attribution.
 */
import type { GeoPoint } from './network-map.logic';

export const GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';

export interface PlaceResult extends GeoPoint {
  name: string;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const url = `${GEOCODER_URL}?format=jsonv2&limit=5&q=${encodeURIComponent(query.trim())}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status})`);
  const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ name: r.display_name || '', lat: Number(r.lat), lng: Number(r.lon) }))
    .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng));
}
