import { describe, expect, it } from 'vitest';
import {
  MapNode,
  SPREAD_PX,
  circuitLoad,
  circuitRouters,
  circuitPath,
  formatGeolocation,
  latencyLevel,
  matchesLocationQuery,
  normalizeCircuit,
  normalizeLink,
  parseGeolocation,
  spreadOffsets,
} from './network-map.logic';

describe('geolocation tags', () => {
  it('parses valid "lat,lng" values', () => {
    expect(parseGeolocation('39.04,-77.49')).toEqual({ lat: 39.04, lng: -77.49 });
    expect(parseGeolocation(' 51.5 , -0.12 ')).toEqual({ lat: 51.5, lng: -0.12 });
  });

  it('rejects malformed or out-of-range values', () => {
    for (const bad of [undefined, 42, '', '39.04', '1,2,3', 'abc,def', '91,0', '0,181', '1e3,2', '0x10,0']) {
      expect(parseGeolocation(bad)).toBeNull();
    }
  });

  it('formats to five decimals and wraps longitude', () => {
    expect(formatGeolocation({ lat: 39.043756, lng: -77.487442 })).toBe('39.04376,-77.48744');
    expect(formatGeolocation({ lat: 10, lng: 190 })).toBe('10.00000,-170.00000');
    expect(formatGeolocation({ lat: 95, lng: -540 })).toBe('90.00000,-180.00000');
  });

  it('round-trips', () => {
    const p = { lat: -33.86882, lng: 151.20929 };
    expect(parseGeolocation(formatGeolocation(p))).toEqual(p);
  });
});

describe('circuits', () => {
  it('prefers the edge circuit tags for client and host', () => {
    const c = normalizeCircuit({
      id: 'c1',
      clientId: 'conn-123',
      service: { id: 's1', name: 'crm' },
      tags: { clientId: 'id-alice', hostId: 'id-crm-host' },
      path: { nodes: [{ id: 'r1' }, 'r2'], links: ['l1'] },
    });
    expect(c).toMatchObject({
      clientId: 'id-alice',
      hostId: 'id-crm-host',
      serviceName: 'crm',
      routerIds: ['r1', 'r2'],
      linkIds: ['l1'],
    });
  });

  it('falls back to the terminator host and service name lookup', () => {
    const c = normalizeCircuit(
      { id: 'c2', serviceId: 's2', terminatorId: 't1' },
      new Map([['t1', 'id-host']]),
      new Map([['s2', 'devbox-ssh']]),
    );
    expect(c.hostId).toBe('id-host');
    expect(c.serviceName).toBe('devbox-ssh');
    expect(c.clientId).toBeNull();
    expect(c.routerIds).toEqual([]);
  });
});

describe('links', () => {
  it('converts nanosecond latency to ms using the slower direction', () => {
    const l = normalizeLink({
      id: 'l1',
      sourceRouter: { id: 'a' },
      destRouter: { id: 'b' },
      state: 'Connected',
      sourceLatency: 12_340_000,
      destLatency: 61_000_000,
    })!;
    expect(l.latencyMs).toBe(61);
    expect(l.level).toBe('warn');
    expect(l.up).toBe(true);
  });

  it('marks down links as bad and drops links without both ends', () => {
    expect(normalizeLink({ id: 'l2', sourceRouterId: 'a', destRouterId: 'b', down: true })!.level).toBe('bad');
    expect(normalizeLink({ id: 'l3', sourceRouterId: 'a' })).toBeNull();
  });

  it('uses the upstream latency thresholds', () => {
    expect(latencyLevel(null)).toBe('unknown');
    expect(latencyLevel(49.9)).toBe('good');
    expect(latencyLevel(100)).toBe('warn');
    expect(latencyLevel(100.1)).toBe('bad');
  });
});

describe('circuit paths', () => {
  const node = (id: string, point: MapNode['point']): MapNode => ({
    id,
    name: id.toUpperCase(),
    kind: 'edge-router',
    online: true,
    point,
    approxVia: null,
    attributes: [],
    tags: {},
  });
  const nodes = new Map<string, MapNode>([
    ['alice', node('alice', { lat: 1, lng: 1 })],
    ['r1', node('r1', { lat: 2, lng: 2 })],
    ['r2', node('r2', null)],
    ['host', node('host', { lat: 3, lng: 3 })],
  ]);
  const circuit = normalizeCircuit({
    id: 'c',
    tags: { clientId: 'alice', hostId: 'host' },
    path: { nodes: ['r1', 'r2'] },
  });

  it('draws located hops in order and reports the rest', () => {
    const p = circuitPath(circuit, nodes);
    expect(p.points).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);
    expect(p.missing).toEqual([{ id: 'r2', name: 'R2' }]);
  });

  it('counts circuits per node once each', () => {
    const load = circuitLoad([circuit, { ...circuit, id: 'c2', routerIds: ['r1', 'r1'] }]);
    expect(load.get('r1')).toBe(2);
    expect(load.get('alice')).toBe(2);
    expect(load.get('r2')).toBe(1);
  });
});

describe('approximate identity locations', () => {
  const c = (id: string, clientId: string | null, hostId: string | null, routerIds: string[]) =>
    ({ id, serviceId: 's', serviceName: 's', clientId, hostId, routerIds, linkIds: [], createdAt: null });

  it('uses the first hop for clients and the last hop for hosts', () => {
    const via = circuitRouters([c('c1', 'alice', 'host', ['r-in', 'r-core', 'r-out'])]);
    expect(via.get('alice')).toBe('r-in');
    expect(via.get('host')).toBe('r-out');
  });

  it('keeps the first (newest) circuit per identity and skips circuits without routers', () => {
    const via = circuitRouters([c('new', 'alice', null, ['r-new']), c('old', 'alice', null, ['r-old']), c('none', 'bob', null, [])]);
    expect(via.get('alice')).toBe('r-new');
    expect(via.has('bob')).toBe(false);
  });
});

describe('spreading co-located markers', () => {
  const at = { lat: 10, lng: 20 };

  it('leaves a lone marker on its point', () => {
    expect(spreadOffsets([{ id: 'a', point: at }]).get('a')).toEqual([0, 0]);
  });

  it('keeps the hub centred and rings the rest at SPREAD_PX', () => {
    const off = spreadOffsets([
      { id: 'i1', point: at },
      { id: 'router', point: { lat: 10.000001, lng: 20 }, center: true },
      { id: 'i2', point: at },
    ]);
    expect(off.get('router')).toEqual([0, 0]);
    expect(off.get('i1')).toEqual([0, -SPREAD_PX]); // 12 o'clock first
    expect(off.get('i2')).toEqual([0, SPREAD_PX]);
  });

  it('rings a group with no hub and leaves other points alone', () => {
    const off = spreadOffsets([
      { id: 'a', point: at },
      { id: 'b', point: at },
      { id: 'far', point: { lat: -10, lng: 20 } },
    ]);
    expect(off.get('a')).not.toEqual(off.get('b'));
    expect(off.get('far')).toEqual([0, 0]);
  });

  it('widens the ring for large groups so neighbours do not overlap', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, point: at }));
    const [x0, y0] = spreadOffsets(items).get('n0')!;
    const [x1, y1] = spreadOffsets(items).get('n1')!;
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeGreaterThanOrEqual(SPREAD_PX - 1);
  });
});

describe('location filter', () => {
  const n = { name: 'Alice-MacBook', attributes: ['nyc-office', 'sales'] };

  it('matches names case-insensitively', () => {
    expect(matchesLocationQuery(n, 'macbook')).toBe(true);
    expect(matchesLocationQuery(n, 'bob')).toBe(false);
    expect(matchesLocationQuery(n, '  ')).toBe(true);
  });

  it('matches #attributes against role attributes only', () => {
    expect(matchesLocationQuery(n, '#nyc')).toBe(true);
    expect(matchesLocationQuery(n, '#alice')).toBe(false);
  });
});
