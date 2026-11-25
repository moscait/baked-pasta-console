import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONCURRENCY_POLICY,
  DEFAULT_TRAFFIC_FILTER,
  buildRemediationPlan,
  evaluateSessionMonitor,
  filterApiSessions,
  filterServiceFlows,
  matchesIpFilter,
  normalizeIp,
  validateIpFilter,
} from './session-monitor.logic';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

describe('session-monitor.logic', () => {
  describe('IP normalization and CIDR filtering', () => {
    it('normalizes ports and IPv4-mapped IPv6 addresses', () => {
      expect(normalizeIp('198.51.100.42:54321')).toBe('198.51.100.42');
      expect(normalizeIp('[2001:db8::1]:8443')).toBe('2001:db8::1');
      expect(normalizeIp('::ffff:192.0.2.15')).toBe('192.0.2.15');
      expect(normalizeIp('')).toBeNull();
    });

    it('matches IPv4/IPv6 CIDRs, anchored prefixes, lists, and !negations', () => {
      expect(matchesIpFilter('198.51.100.42', '198.51.100.0/24')).toBe(true);
      expect(matchesIpFilter('198.51.101.42', '198.51.100.0/24')).toBe(false);
      expect(matchesIpFilter('2001:db8:abcd::99', '2001:db8::/32')).toBe(true);
      expect(matchesIpFilter('2001:db9::1', '2001:db8::/32')).toBe(false);

      // Partial prefix is anchored to the start: `!10.` excludes `10.x` but NEVER `110.x` or `192.168.10.1`.
      expect(matchesIpFilter('10.24.1.9', '!10.')).toBe(false);
      expect(matchesIpFilter('110.24.1.9', '!10.')).toBe(true);
      expect(matchesIpFilter('192.168.10.5', '!10.')).toBe(true);

      expect(matchesIpFilter('203.0.113.50', '!10.0.0.0/8, !192.168.0.0/16')).toBe(true);
      expect(matchesIpFilter(null, '!10.0.0.0/8')).toBe(false);
    });

    it('validates CIDR syntax and treats incomplete mid-entry filters as a non-blanking no-op', () => {
      expect(validateIpFilter('10.0.0.0/8, !192.168.1.0/24')).toEqual({ valid: true });
      expect(validateIpFilter('10.0.0.0/').valid).toBe(false);
      expect(validateIpFilter('10.0.0.0/33').valid).toBe(false);
      expect(validateIpFilter('not-an-ip/24').valid).toBe(false);

      // Typing `10.0.0.0/` or `!` does not blank rows while invalid
      expect(matchesIpFilter('198.51.100.42', '10.0.0.0/')).toBe(true);
      expect(matchesIpFilter('198.51.100.42', '!')).toBe(true);
    });
  });

  describe('concurrent identity detection & safety defaults', () => {
    it('defaults both sameIpAction and multiIpAction to non-destructive warn and exempts admins', () => {
      expect(DEFAULT_CONCURRENCY_POLICY.sameIpAction).toBe('warn');
      expect(DEFAULT_CONCURRENCY_POLICY.multiIpAction).toBe('warn');
      expect(DEFAULT_CONCURRENCY_POLICY.exemptAdminIdentities).toBe(true);

      const report = evaluateSessionMonitor({
        now: NOW,
        identities: [
          { id: 'id-admin', name: 'Default Admin', isAdmin: true, authenticators: { updb: { id: 'a-admin' } } },
        ],
        apiSessions: [
          { id: 'as-console', identityId: 'id-admin', ipAddress: '198.51.100.10', lastActivityAt: ago(2), token: 'tok-1' },
          { id: 'as-cli', identityId: 'id-admin', ipAddress: '203.0.113.77', lastActivityAt: ago(5), token: 'tok-2' },
        ],
        sessions: [],
        currentSessionToken: 'tok-1',
      });

      expect(report.findings).toHaveLength(0);
      expect(report.byIdentity.get('id-admin')?.concurrencyState).toBe('exempt-multi');
      expect(report.apiSessions.find((s) => s.id === 'as-console')?.isCurrentSession).toBe(true);
    });

    it('does NOT flag different identities sharing the same firewall/NAT IP', () => {
      const report = evaluateSessionMonitor({
        now: NOW,
        identities: [
          { id: 'id-alice', name: 'alice-laptop', roleAttributes: ['sales'], authenticators: { cert: { id: 'a1' } } },
          { id: 'id-bob', name: 'bob-laptop', roleAttributes: ['sales'], authenticators: { cert: { id: 'a2' } } },
        ],
        apiSessions: [
          { id: 'as-1', identityId: 'id-alice', ipAddress: '198.51.100.10', lastActivityAt: ago(5) },
          { id: 'as-2', identityId: 'id-bob', ipAddress: '198.51.100.10', lastActivityAt: ago(8) },
        ],
        sessions: [],
      });

      expect(report.findings).toHaveLength(0);
    });

    it('treats sessions without timestamps as stale unless activeWithinSeconds is 0', () => {
      const report = evaluateSessionMonitor({
        now: NOW,
        identities: [{ id: 'id-1', name: 'mystery-client', authenticators: { cert: { id: 'c1' } } }],
        apiSessions: [
          { id: 'as-1', identityId: 'id-1', ipAddress: '198.51.100.1' },
          { id: 'as-2', identityId: 'id-1', ipAddress: '203.0.113.2' },
        ],
        sessions: [],
      });
      expect(report.findings).toHaveLength(0);
      expect(report.byIdentity.get('id-1')?.concurrencyState).toBe('stale');

      const timelessAllowed = evaluateSessionMonitor({
        now: NOW,
        identities: [{ id: 'id-1', name: 'mystery-client', authenticators: { cert: { id: 'c1' } } }],
        apiSessions: [
          { id: 'as-1', identityId: 'id-1', ipAddress: '198.51.100.1' },
          { id: 'as-2', identityId: 'id-1', ipAddress: '203.0.113.2' },
        ],
        sessions: [],
        policy: { activeWithinSeconds: 0, maxActivitySkewSeconds: null },
      });
      expect(timelessAllowed.findings).toHaveLength(1);
    });

    it('clusters sessions within maxActivitySkewSeconds across 3+ sessions and excludes stale roaming leftovers', () => {
      const identities = [{ id: 'id-bob', name: 'bob-thinkpad', authenticators: { cert: { id: 'cert-bob' } } }];
      const apiSessions = [
        // Leftover Wi-Fi session from 220s ago (within 300s active window, outside 120s skew cluster)
        { id: 'as-wifi-stale', identityId: 'id-bob', ipAddress: '10.0.0.5', createdAt: ago(900), lastActivityAt: ago(220) },
        // Legitimate cellular session created earlier, active 20s ago
        { id: 'as-legit', identityId: 'id-bob', ipAddress: '198.51.100.77', createdAt: ago(600), lastActivityAt: ago(20) },
        // Cloned identity session created recently, active 5s ago
        { id: 'as-clone', identityId: 'id-bob', ipAddress: '203.0.113.194', createdAt: ago(30), lastActivityAt: ago(5) },
      ];

      // With minConcurrentSessions: 3, only 2 sessions are in the 120s skew cluster -> NOT flagged.
      const minThree = evaluateSessionMonitor({
        now: NOW,
        identities,
        apiSessions,
        sessions: [],
        policy: { minConcurrentSessions: 3 },
      });
      expect(minThree.findings).toHaveLength(0);

      // With default minConcurrentSessions: 2, only the 2 clustered sessions (and their 2 IPs) appear in the finding,
      // and `terminate-newer-sessions` keeps `as-legit` (created 600s ago) and drops `as-clone` (created 30s ago).
      const minTwo = evaluateSessionMonitor({
        now: NOW,
        identities,
        apiSessions,
        sessions: [],
        policy: { multiIpAction: 'terminate-newer-sessions' },
      });
      expect(minTwo.findings).toHaveLength(1);
      const f = minTwo.findings[0];
      expect(f.concurrentSessionCount).toBe(2);
      expect(f.distinctIps).toEqual(['203.0.113.194', '198.51.100.77']);
      expect(f.remediationSteps).toEqual([
        expect.objectContaining({ collection: 'api-sessions', targetId: 'as-clone' }),
      ]);
    });

    it('fails explicitly on revoke-authenticators if no authenticator IDs exist and protects currentSessionToken', () => {
      const noAuthPlan = buildRemediationPlan({
        action: 'revoke-authenticators',
        identity: { id: 'id-1', name: 'no-auth-id', authenticators: { cert: { fingerprint: 'aa:bb:cc' } } },
        identityName: 'no-auth-id',
        allApiSessions: [{ id: 'as-1', ipAddress: '198.51.100.1' }],
        concurrentSessions: [{ apiSessionId: 'as-1', ipAddress: '198.51.100.1' }],
      });
      expect(noAuthPlan.error).toMatch(/no revocable authenticator ID/i);
      expect(noAuthPlan.steps).toEqual([]);

      // Resolves authenticatorId from apiSessionDetail when identity summary lacks id, and skips currentSessionToken
      const fromApiSess = buildRemediationPlan({
        action: 'revoke-authenticators',
        identity: { id: 'id-1', name: 'bob', authenticators: { cert: { fingerprint: 'aa:bb' } } },
        identityName: 'bob',
        allApiSessions: [
          { id: 'as-self', ipAddress: '198.51.100.1', authenticatorId: 'auth-from-sess', isCurrentSession: true },
          { id: 'as-other', ipAddress: '203.0.113.9', authenticatorId: 'auth-from-sess', isCurrentSession: false },
        ],
        concurrentSessions: [],
      });
      expect(fromApiSess.error).toBeUndefined();
      expect(fromApiSess.steps.map((s) => `${s.collection}/${s.targetId}`)).toEqual([
        'authenticators/auth-from-sess',
        'api-sessions/as-other',
      ]);
    });

    it('correlates service flows using sessionDetail fields (apiSessionId + identityId, without Session.identity)', () => {
      const report = evaluateSessionMonitor({
        now: NOW,
        identities: [
          { id: 'id-alice', name: 'alice', roleAttributes: ['sales'], authenticators: { cert: { id: 'c-a' } } },
          { id: 'id-bob', name: 'bob', roleAttributes: ['devs'], authenticators: { cert: { id: 'c-b' } } },
        ],
        apiSessions: [
          { id: 'as-a', identityId: 'id-alice', ipAddress: '10.10.1.5', cachedLastActivityAt: ago(5) },
          { id: 'as-b1', identityId: 'id-bob', ipAddress: '10.10.1.9', lastActivityAt: ago(5) },
          { id: 'as-b2', identityId: 'id-bob', ipAddress: '203.0.113.44', lastActivityAt: ago(12) },
        ],
        sessions: [
          { id: 'ss-1', apiSessionId: 'as-a', identityId: 'id-alice', serviceId: 'svc-crm', service: { name: 'crm' }, type: 'Dial' },
          { id: 'ss-2', apiSessionId: 'as-b1', identityId: 'id-bob', serviceId: 'svc-ssh', service: { name: 'ssh' }, type: 'Dial' },
          { id: 'ss-3', apiSessionId: 'as-b2', identityId: 'id-bob', serviceId: 'svc-ssh', service: { name: 'ssh' }, type: 'Dial' },
        ],
      });

      const externalOnly = filterServiceFlows(report.serviceFlows, {
        ...DEFAULT_TRAFFIC_FILTER(),
        ipFilter: '!10.0.0.0/8',
      });
      expect(externalOnly.map((f) => [f.identityName, f.ipAddress])).toEqual([['bob', '203.0.113.44']]);

      const multiIpApi = filterApiSessions(report.apiSessions, {
        ...DEFAULT_TRAFFIC_FILTER(),
        concurrency: 'concurrent-multi-ip',
      });
      expect(multiIpApi).toHaveLength(2);
    });
  });
});
