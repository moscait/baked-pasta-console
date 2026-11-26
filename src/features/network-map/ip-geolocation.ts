/**
 * Opt-in "suggest a location from IP" for the Network Map, via ipgeolocation.io.
 *
 * Privacy: only a truncated address leaves the browser (IPv4 /24, IPv6 /48), which geolocates
 * to the same city in practice but no longer identifies one machine. Private, loopback,
 * link-local, CGNAT and documentation addresses are never sent. The API key is the viewer's own,
 * kept in this browser's localStorage only (never on the controller).
 */
import type { GeoPoint } from './network-map.logic';

export const IPGEO_URL = 'https://api.ipgeolocation.io/v3/ipgeo';
const KEY_STORAGE = 'bpc.ipgeolocation.key';

export function getIpGeoKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setIpGeoKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // storage unavailable (private window, blocked site data): the feature stays off
  }
}

const v4 = (ip: string): number[] | null => {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  return n.every((x) => x <= 255) ? n : null;
};

/** Addresses that are not on the public internet, or are reserved for documentation. */
function isNonPublicV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast and reserved
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

/** Expands an IPv6 address to its eight 16-bit groups, or null if it is not one. */
function v6Groups(ip: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || ip.split('::').length > 2) return null;
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, null];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const missing = 8 - h.length - t.length;
  if ((tail === null && missing !== 0) || missing < 0) return null;
  const groups = [...h, ...Array(tail === null ? 0 : missing).fill('0'), ...t];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

export type TruncateResult = { prefix: string } | { skip: 'non-public' | 'invalid' };

/**
 * Reduces a client address to the prefix that is sent for lookup: IPv4 keeps three octets
 * (a.b.c.0), IPv6 keeps 48 bits (x:y:z::). Ports, brackets and IPv4-mapped IPv6 are handled.
 * `allowDocumentation` lets the demo sandbox use its documentation-range addresses.
 */
export function truncateIp(raw: string, allowDocumentation = false): TruncateResult {
  let ip = raw.trim();
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];
  else if (/^[\d.]+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  ip = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

  const four = v4(ip);
  if (four) {
    const doc = /^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(ip);
    if (isNonPublicV4(four) && !(allowDocumentation && doc)) return { skip: 'non-public' };
    return { prefix: `${four[0]}.${four[1]}.${four[2]}.0` };
  }
  const six = v6Groups(ip);
  if (six) {
    const first = six[0];
    const nonPublic =
      six.every((g, i) => (i < 7 ? g === 0 : g <= 1)) || // :: and ::1
      (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
      (first & 0xffc0) === 0xfe80 || // link-local
      (first & 0xff00) === 0xff00 || // multicast
      (first === 0x2001 && six[1] === 0x0db8); // documentation
    if (nonPublic) return { skip: 'non-public' };
    return { prefix: `${six.slice(0, 3).map((g) => g.toString(16)).join(':')}::` };
  }
  return { skip: 'invalid' };
}

export interface IpPlace extends GeoPoint {
  label: string;
}

/** `fatal`: the service refused the request (bad key, quota, plan), so further lookups would too. */
export class IpLookupError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
  ) {
    super(message);
  }
}

/** Looks up a truncated prefix. Errors carry the service's own message (bad key, quota, …). */
export async function lookupPrefix(prefix: string, apiKey: string, signal?: AbortSignal): Promise<IpPlace> {
  const url = `${IPGEO_URL}?apiKey=${encodeURIComponent(apiKey)}&ip=${encodeURIComponent(prefix)}&fields=location`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as {
    message?: string;
    location?: { latitude?: string; longitude?: string; city?: string; country_name?: string };
  } | null;
  if (!res.ok) throw new IpLookupError(body?.message || `IP lookup failed (HTTP ${res.status})`, true);
  const lat = Number(body?.location?.latitude);
  const lng = Number(body?.location?.longitude);
  if (!body?.location || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    throw new IpLookupError(body?.message || `No location for ${prefix}`, false);
  }
  const label = [body.location.city, body.location.country_name].filter(Boolean).join(', ') || prefix;
  return { lat, lng, label };
}

/** Demo sandbox stand-in: documentation ranges resolve to fixed cities, with no network call. */
const DEMO_PLACES: Record<string, IpPlace> = {
  '198.51.100.0': { lat: 40.6782, lng: -73.9442, label: 'Brooklyn, United States' },
  '203.0.113.0': { lat: 51.5072, lng: -0.1276, label: 'London, United Kingdom' },
  '192.0.2.0': { lat: 41.8781, lng: -87.6298, label: 'Chicago, United States' },
};

export async function demoLookupPrefix(prefix: string): Promise<IpPlace> {
  const p = DEMO_PLACES[prefix];
  if (!p) throw new IpLookupError(`No location for ${prefix}`, false);
  return p;
}
