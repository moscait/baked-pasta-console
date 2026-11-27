import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchPlaces } from './geocode';

afterEach(() => vi.unstubAllGlobals());

describe('place search', () => {
  it('queries Nominatim with the encoded text and maps results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { display_name: 'Ashburn, Virginia, United States', lat: '39.0437', lon: '-77.4875' },
        { display_name: 'broken', lat: 'x', lon: '1' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await searchPlaces(' Ashburn, VA ');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=Ashburn%2C%20VA',
    );
    expect(out).toEqual([{ name: 'Ashburn, Virginia, United States', lat: 39.0437, lng: -77.4875 }]);
  });

  it('reports HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(searchPlaces('x')).rejects.toThrow('HTTP 429');
  });
});
