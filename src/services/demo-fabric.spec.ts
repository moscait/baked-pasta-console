import { describe, expect, it } from 'vitest';
import { createInitialDemoStore, demoFabric } from './demo-store';
import { normalizeCircuit, normalizeLink } from '../features/network-map/network-map.logic';

describe('demo fabric', () => {
  const store = createInitialDemoStore();
  const fabric = demoFabric(store);

  it('lists every edge and transit router with its online state', () => {
    expect(fabric.routers.map((r) => r.id).sort()).toEqual(['er-eu-west', 'er-lab', 'er-us-east', 'tr-core-01']);
    expect(fabric.routers.find((r) => r.id === 'er-lab')?.connected).toBe(false);
  });

  it('routes each Dial session from the client-side router to the host terminator', () => {
    const circuits = fabric.circuits.map((c) => normalizeCircuit(c));
    const alice = circuits.find((c) => c.clientId === 'id-alice')!;
    expect(alice).toMatchObject({ hostId: 'id-crm-host', routerIds: ['er-us-east'], linkIds: [] });
    // bob is in London, so he enters in Europe and crosses the core to the US-hosted devbox.
    const bob = circuits.find((c) => c.clientId === 'id-bob')!;
    expect(bob.routerIds).toEqual(['er-eu-west', 'tr-core-01', 'er-us-east']);
    expect(bob.linkIds).toHaveLength(2);
  });

  it('includes a down link to the offline router', () => {
    const down = fabric.links.map(normalizeLink).find((l) => l?.a === 'er-lab' || l?.b === 'er-lab');
    expect(down?.up).toBe(false);
  });
});
