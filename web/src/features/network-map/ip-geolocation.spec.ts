import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupPrefix, truncateIp } from './ip-geolocation';

afterEach(() => vi.unstubAllGlobals());

describe('truncateIp', () => {
  it('keeps three IPv4 octets, dropping ports and IPv4-mapped prefixes', () => {
    expect(truncateIp('81.2.69.142')).toEqual({ prefix: '81.2.69.0' });
    expect(truncateIp('81.2.69.142:51234')).toEqual({ prefix: '81.2.69.0' });
    expect(truncateIp('::ffff:81.2.69.142')).toEqual({ prefix: '81.2.69.0' });
  });

  it('keeps 48 bits of IPv6', () => {
    expect(truncateIp('2a00:1450:4009:81f::200e')).toEqual({ prefix: '2a00:1450:4009::' });
    expect(truncateIp('[2a00:1450:4009:81f::200e]:443')).toEqual({ prefix: '2a00:1450:4009::' });
  });

  it('never sends private, loopback, CGNAT, link-local or documentation addresses', () => {
    for (const ip of ['10.1.2.3', '172.20.0.1', '192.168.1.9', '127.0.0.1', '100.72.0.5', '169.254.1.1', '0.0.0.0',
      '198.51.100.42', '203.0.113.9', '192.0.2.1', '::1', 'fd12:3456::1', 'fe80::1', '2001:db8::1']) {
      expect(truncateIp(ip)).toEqual({ skip: 'non-public' });
    }
  });

  it('lets the demo use documentation ranges only', () => {
    expect(truncateIp('198.51.100.42', true)).toEqual({ prefix: '198.51.100.0' });
    expect(truncateIp('10.1.2.3', true)).toEqual({ skip: 'non-public' });
  });

  it('rejects garbage', () => {
    for (const ip of ['', 'localhost', '1.2.3', '256.1.1.1', '1:2:3', '1::2::3']) {
      expect(truncateIp(ip)).toEqual({ skip: 'invalid' });
    }
  });
});

describe('lookupPrefix', () => {
  it('sends the key and prefix and reads location fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ location: { latitude: '51.50720', longitude: '-0.12760', city: 'London', country_name: 'United Kingdom' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupPrefix('81.2.69.0', 'k&y')).resolves.toEqual({ lat: 51.5072, lng: -0.1276, label: 'London, United Kingdom' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ipgeolocation.io/v3/ipgeo?apiKey=k%26y&ip=81.2.69.0&fields=location');
  });

  it("surfaces the service's error message", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Provided API key is not valid.' }) }));
    await expect(lookupPrefix('81.2.69.0', 'bad')).rejects.toMatchObject({ message: 'Provided API key is not valid.', fatal: true });
  });

  it('treats a missing or 0,0 location as no result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ location: { latitude: '0', longitude: '0' } }) }));
    await expect(lookupPrefix('81.2.69.0', 'k')).rejects.toMatchObject({ fatal: false });
  });
});
