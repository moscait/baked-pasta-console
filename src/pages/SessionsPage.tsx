import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Filter,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Unplug,
} from 'lucide-react';
import type { ApiSession, Identity, Service, Session } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { ModalDialog } from '../components/ModalDialog';
import { useResettableState, useServiceLoad } from '../components/state-hooks';
import {
  ConcurrencyFilterMode,
  ConcurrencyFinding,
  ConcurrencyPolicy,
  DEFAULT_TRAFFIC_FILTER,
  EnrichedApiSession,
  RemediationAction,
  ServiceFlowRow,
  TrafficFilter,
  buildRemediationPlan,
  evaluateSessionMonitor,
  filterApiSessions,
  filterServiceFlows,
  validateIpFilter,
} from '../features/sessions/session-monitor.logic';

function formatAge(ageSeconds: number | null, fallbackIso: string | null): string {
  if (ageSeconds === null) return fallbackIso || '—';
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ${ageSeconds % 60}s ago`;
  const h = Math.floor(ageSeconds / 3600);
  const m = Math.floor((ageSeconds % 3600) / 60);
  return `${h}h ${m}m ago`;
}

const VALID_CONC_MODES = new Set<ConcurrencyFilterMode>([
  'all',
  'concurrent-any',
  'concurrent-multi-ip',
  'concurrent-same-ip',
]);

function filterFromParams(params: URLSearchParams): TrafficFilter {
  const base = DEFAULT_TRAFFIC_FILTER();
  const q = params.get('q');
  const ip = params.get('ip');
  const conc = params.get('concurrency') as ConcurrencyFilterMode | null;
  if (q) base.search = q;
  if (ip) base.ipFilter = ip;
  if (conc && VALID_CONC_MODES.has(conc)) base.concurrency = conc;
  return base;
}

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

export const SessionsPage: React.FC<{
  initialTab?: 'sessions' | 'api-sessions';
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ initialTab = 'sessions', onToast }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useResettableState<'sessions' | 'api-sessions'>(initialTab);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [apiSessions, setApiSessions] = useState<ApiSession[]>([]);
  const [policy, setPolicy] = useState<ConcurrencyPolicy>(() => zitiService.getConcurrencyPolicy());
  const [filter, setFilter] = useState<TrafficFilter>(() => filterFromParams(searchParams));

  // Keep the filter synced if the user navigates to `/sessions?q=...` or `?ip=...` while already
  // mounted (adjusted during render, so the table never shows a frame with the old filter).
  const [seenParams, setSeenParams] = useState(searchParams);
  if (seenParams !== searchParams) {
    setSeenParams(searchParams);
    if (searchParams.size > 0) setFilter((prev) => ({ ...prev, ...filterFromParams(searchParams) }));
  }

  // Policy modal state
  const [policyOpen, setPolicyOpen] = useState(false);
  const [draftActiveSec, setDraftActiveSec] = useState(String(policy.activeWithinSeconds));
  const [draftSkewSec, setDraftSkewSec] = useState(
    policy.maxActivitySkewSeconds !== null ? String(policy.maxActivitySkewSeconds) : '',
  );
  const [draftMinConc, setDraftMinConc] = useState(String(policy.minConcurrentSessions));
  const [draftRequireDistinctIps, setDraftRequireDistinctIps] = useState(policy.requireDistinctIps);
  const [draftExemptAdmin, setDraftExemptAdmin] = useState(policy.exemptAdminIdentities);
  const [draftExemptExt, setDraftExemptExt] = useState(policy.exemptExternalIdentities);
  const [draftExemptAttrs, setDraftExemptAttrs] = useState(policy.exemptRoleAttributes.join(', '));

  // Destructive action confirmation modal state
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const load = useServiceLoad(
    () =>
      Promise.all([
        zitiService.list('identities'),
        zitiService.list('services'),
        zitiService.list('sessions'),
        zitiService.list('api-sessions'),
      ]),
    ([ids, svcs, sess, apiSess]) => {
      setIdentities(ids);
      setServices(svcs);
      setSessions(sess);
      setApiSessions(apiSess);
    },
    (err) => onToast('error', 'Load failed', zitiService.errorText(err)),
  );

  useEffect(() => zitiService.subscribePolicy(() => setPolicy(zitiService.getConcurrencyPolicy())), []);

  const closeConfirm = useCallback(() => {
    setPendingConfirm(null);
    setConfirmError('');
  }, []);

  const executeConfirmed = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    setConfirmError('');
    try {
      await pendingConfirm.run();
      setPendingConfirm(null);
    } catch (err) {
      setConfirmError(zitiService.errorText(err));
    } finally {
      setConfirmBusy(false);
    }
  };

  const openPolicyModal = () => {
    const cur = zitiService.getConcurrencyPolicy();
    setDraftActiveSec(String(cur.activeWithinSeconds));
    setDraftSkewSec(cur.maxActivitySkewSeconds !== null ? String(cur.maxActivitySkewSeconds) : '');
    setDraftMinConc(String(cur.minConcurrentSessions));
    setDraftRequireDistinctIps(cur.requireDistinctIps);
    setDraftExemptAdmin(cur.exemptAdminIdentities);
    setDraftExemptExt(cur.exemptExternalIdentities);
    setDraftExemptAttrs(cur.exemptRoleAttributes.join(', '));
    setPolicyOpen(true);
  };

  const currentToken = zitiService.currentSessionToken();
  const report = useMemo(
    () =>
      evaluateSessionMonitor({
        identities,
        apiSessions,
        sessions,
        policy,
        currentSessionToken: currentToken,
      }),
    [identities, apiSessions, sessions, policy, currentToken],
  );

  const ipValidation = useMemo(() => validateIpFilter(filter.ipFilter), [filter.ipFilter]);
  const filteredFlows = useMemo(() => filterServiceFlows(report.serviceFlows, filter), [report.serviceFlows, filter]);
  const filteredApiSessions = useMemo(
    () => filterApiSessions(report.apiSessions, filter),
    [report.apiSessions, filter],
  );

  const allRoleAttrs = useMemo(() => {
    const set = new Set<string>();
    for (const i of identities) for (const a of i.roleAttributes || []) set.add(a);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [identities]);

  const filtersActive =
    !!filter.search.trim() ||
    !!filter.ipFilter.trim() ||
    filter.serviceId !== 'all' ||
    !!filter.roleAttribute ||
    filter.sessionType !== 'all' ||
    filter.concurrency !== 'all';

  const updateSearch = useCallback(
    (nextSearch: string) => {
      setFilter((prev) => ({ ...prev, search: nextSearch }));
      if (searchParams.has('q') && !nextSearch) {
        const next = new URLSearchParams(searchParams);
        next.delete('q');
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const clearTrafficFilters = () => {
    setFilter(DEFAULT_TRAFFIC_FILTER());
    if (searchParams.size > 0) setSearchParams({}, { replace: true });
  };

  const confirmRemediation = (finding: ConcurrencyFinding, action: RemediationAction) => {
    const isRevoke = action === 'revoke-authenticators';
    const title = isRevoke
      ? `Revoke credentials for ${finding.identityName}?`
      : action === 'terminate-newer-sessions'
        ? `Drop newer session(s) for ${finding.identityName}?`
        : `Drop all sessions for ${finding.identityName}?`;
    const description = isRevoke
      ? `Deletes the authenticator(s) for ${finding.identityName} so shared certificates or passwords can no longer reconnect, then terminates its active API sessions.`
      : action === 'terminate-newer-sessions'
        ? `Keeps the earliest-established session on ${finding.identityName} and terminates newer concurrent API session(s). Note: a device with a cloned certificate can reconnect unless its credential is revoked.`
        : `Immediately terminates all ${finding.totalSessionCount} API session(s) for ${finding.identityName} (${finding.distinctIps.join(', ') || 'active sessions'}).`;

    setPendingConfirm({
      title,
      description,
      confirmLabel: isRevoke ? 'Revoke & Terminate' : 'Terminate Sessions',
      run: async () => {
        const ident = identities.find((i) => i.id === finding.identityId);
        // Fetch authenticators for this identity on demand when revoking so missing summary IDs never cause silent skips.
        const fetchedAuths = isRevoke ? await zitiService.listIdentityAuthenticators(finding.identityId) : undefined;
        const allForIdent = report.apiSessions
          .filter((s) => s.identityId === finding.identityId)
          .map((s) => ({
            id: s.id,
            ipAddress: s.ipAddress,
            createdAt: s.createdAt,
            authenticatorId: s.authenticatorId,
            isCurrentSession: s.isCurrentSession,
          }));
        const plan = buildRemediationPlan({
          action,
          identity: ident,
          identityName: finding.identityName,
          allApiSessions: allForIdent,
          concurrentSessions: finding.concurrentSessions,
          authenticators: fetchedAuths,
        });
        if (plan.error) throw new Error(plan.error);
        if (!plan.steps.length) {
          throw new Error('No eligible sessions to terminate (the active console session is protected).');
        }
        const { executed, failures } = await zitiService.executeRemediationSteps(plan.steps);
        await load();
        if (failures.length) {
          throw new Error(failures.join('; '));
        }
        onToast(
          'success',
          isRevoke ? 'Credentials revoked & sessions dropped' : 'Sessions terminated',
          `${finding.identityName}: completed ${executed} operation${executed === 1 ? '' : 's'}.`,
        );
      },
    });
  };

  const confirmDropSingleApiSession = (apiSessionId: string, identityName: string, ip: string | null) => {
    setPendingConfirm({
      title: `Revoke API session for ${identityName}?`,
      description: `Immediately disconnects API session ${apiSessionId}${ip ? ` (${ip})` : ''} and closes any service sessions using it.`,
      confirmLabel: 'Revoke API Session',
      run: async () => {
        await zitiService.remove('api-sessions', apiSessionId);
        onToast('info', 'API session revoked', `${identityName}${ip ? ` (${ip})` : ''}`);
        await load();
      },
    });
  };

  const concurrencyBadge = (state: EnrichedApiSession['concurrencyState']) => {
    if (state === 'concurrent-multi-ip') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--ac-bad-soft)] text-[var(--ac-bad)] text-[11px] font-semibold">
          <AlertTriangle className="w-3 h-3" />
          <span>Multi-IP</span>
        </span>
      );
    }
    if (state === 'concurrent-same-ip') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--ac-pending-soft)] text-[var(--ac-pending)] text-[11px] font-semibold">
          <AlertTriangle className="w-3 h-3" />
          <span>Concurrent</span>
        </span>
      );
    }
    if (state === 'exempt-multi') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-[var(--ac-dial-soft)] text-[var(--ac-dial)] text-[11px] font-medium">
          Exempt
        </span>
      );
    }
    if (state === 'stale') {
      return (
        <span className="px-2 py-0.5 rounded-full bg-[var(--ac-surface-2)] text-[var(--ac-muted)] text-[11px]">
          Idle
        </span>
      );
    }
    return null;
  };

  const flowCols: ColumnDef<ServiceFlowRow>[] = [
    {
      key: 'identityName',
      header: 'Identity',
      getValue: (r) => r.identityName,
      render: (r) => (
        <div className="space-y-1">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="font-semibold font-mono text-xs">{r.identityName}</span>
            {concurrencyBadge(r.concurrencyState)}
          </div>
          {r.roleAttributes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.roleAttributes.map((a) => (
                <span
                  key={a}
                  className="px-1.5 py-0.5 rounded bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-[10.5px] text-[var(--ac-muted)]"
                >
                  #{a}
                </span>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'ipAddress',
      header: 'Client IP',
      getValue: (r) => r.ipAddress || '',
      render: (r) =>
        r.ipAddress ? (
          <button
            type="button"
            onClick={() => setFilter((prev) => ({ ...prev, ipFilter: r.ipAddress! }))}
            title="Click to filter traffic by this IP"
            className="px-2 py-0.5 rounded-md bg-[var(--ac-surface-2)] border border-[var(--ac-line)] hover:border-[var(--ac-dial)] font-mono text-xs cursor-pointer"
          >
            {r.ipAddress}
          </button>
        ) : (
          <span className="text-xs text-[var(--ac-muted)]">
            — {zitiService.oidcEnabled ? '(OIDC)' : ''}
          </span>
        ),
    },
    {
      key: 'serviceName',
      header: 'Service',
      getValue: (r) => r.serviceName,
      render: (r) => <span className="font-semibold font-mono text-xs">{r.serviceName}</span>,
    },
    {
      key: 'type',
      header: 'Direction',
      getValue: (r) => r.type,
      render: (r) => (
        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
            r.type === 'Bind'
              ? 'bg-[var(--ac-bind-soft)] text-[var(--ac-bind)]'
              : 'bg-[var(--ac-dial-soft)] text-[var(--ac-dial)]'
          }`}
        >
          {r.type}
        </span>
      ),
    },
    {
      key: 'routers',
      header: 'Edge Routers',
      getValue: (r) => r.routers.join(', '),
      render: (r) =>
        r.routers.length > 0 ? (
          <span className="font-mono text-xs text-[var(--ac-router)]">{r.routers.join(', ')}</span>
        ) : (
          <span className="text-xs text-[var(--ac-muted)]">—</span>
        ),
    },
    {
      key: 'ageSeconds',
      header: 'Last Activity',
      type: 'number',
      getValue: (r) => r.ageSeconds ?? Number.MAX_SAFE_INTEGER,
      render: (r) => (
        <span className="text-xs text-[var(--ac-muted)]" title={r.activityAt || undefined}>
          {formatAge(r.ageSeconds, r.activityAt)}
        </span>
      ),
    },
  ];

  const apiSessCols: ColumnDef<EnrichedApiSession>[] = [
    {
      key: 'identityName',
      header: 'Identity',
      getValue: (r) => r.identityName,
      render: (r) => (
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="font-semibold font-mono text-xs">{r.identityName}</span>
          <span className="px-1.5 py-0.5 rounded bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-[10px] uppercase text-[var(--ac-muted)]">
            {r.authMethod}
          </span>
          {r.isCurrentSession && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--ac-ok-soft)] text-[var(--ac-ok)] text-[10.5px] font-semibold">
              This console
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'ipAddress',
      header: 'Client IP & Status',
      getValue: (r) => r.ipAddress || '',
      render: (r) => (
        <div className="flex items-center flex-wrap gap-1.5">
          {r.ipAddress ? (
            <button
              type="button"
              onClick={() => setFilter((prev) => ({ ...prev, ipFilter: r.ipAddress! }))}
              title="Click to filter by this IP"
              className="px-2 py-0.5 rounded-md bg-[var(--ac-surface-2)] border border-[var(--ac-line)] hover:border-[var(--ac-dial)] font-mono text-xs cursor-pointer"
            >
              {r.ipAddress}
            </button>
          ) : (
            <code className="text-xs text-[var(--ac-muted)]">—</code>
          )}
          {concurrencyBadge(r.concurrencyState)}
        </div>
      ),
    },
    {
      key: 'services',
      header: 'Active Service Sessions',
      getValue: (r) => r.services.map((s) => s.serviceName).join(', '),
      render: (r) =>
        r.services.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {r.services.map((s) => (
              <span
                key={s.sessionId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-xs"
              >
                <span className={s.type === 'Bind' ? 'text-[var(--ac-bind)] font-semibold' : 'text-[var(--ac-dial)] font-semibold'}>
                  {s.type}
                </span>
                <span>{s.serviceName}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-[var(--ac-muted)]">Idle (authenticated only)</span>
        ),
    },
    {
      key: 'ageSeconds',
      header: 'Last Activity',
      type: 'number',
      getValue: (r) => r.ageSeconds ?? Number.MAX_SAFE_INTEGER,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ac-muted)]" title={r.activityAt || undefined}>
          <span
            className={`w-2 h-2 rounded-full ${
              r.isActiveInWindow ? 'bg-[var(--ac-ok)]' : 'bg-[var(--ac-muted)]/40'
            }`}
          />
          <span>{formatAge(r.ageSeconds, r.activityAt)}</span>
        </span>
      ),
    },
    {
      key: 'id',
      header: 'API Session ID',
      render: (r) => <span className="font-mono text-xs text-[var(--ac-muted)]">{r.id}</span>,
    },
  ];

  const headerTabs = (
    <div className="inline-flex rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] p-1 text-xs">
      <button
        type="button"
        onClick={() => setTab('sessions')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'sessions' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        Service Traffic ({filteredFlows.length}
        {filteredFlows.length !== report.serviceFlows.length ? ` / ${report.serviceFlows.length}` : ''})
      </button>
      <button
        type="button"
        onClick={() => setTab('api-sessions')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'api-sessions' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        API Sessions ({filteredApiSessions.length}
        {filteredApiSessions.length !== report.apiSessions.length ? ` / ${report.apiSessions.length}` : ''})
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-xl font-bold tracking-tight m-0">Traffic &amp; Active Sessions</h1>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Correlated service sessions, client source IPs/CIDRs, and configurable concurrent-identity detection.
            {zitiService.oidcEnabled &&
              ' Stateless OIDC JWT clients do not populate client IPs in legacy api-sessions.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openPolicyModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] hover:border-[var(--ac-dial)] text-xs font-medium cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--ac-dial)]" />
            <span>
              Concurrency Policy ({policy.activeWithinSeconds}s window
              {policy.maxActivitySkewSeconds ? ` · ${policy.maxActivitySkewSeconds}s skew` : ''})
            </span>
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] hover:border-[var(--ac-muted)] text-xs font-medium cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Concurrent Identity Alert Panel */}
      {report.findings.length > 0 && (
        <section
          aria-label="Concurrent identity warnings"
          className="p-4 rounded-2xl border border-[var(--ac-bad)]/45 bg-[var(--ac-bad-soft)] space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ac-bad)]">
              <ShieldAlert className="w-4 h-4 flex-none" />
              <span>
                {report.findings.length === 1
                  ? '1 identity has concurrent active sessions'
                  : `${report.findings.length} identities have concurrent active sessions`}
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                setFilter((prev) => ({
                  ...prev,
                  concurrency: prev.concurrency === 'concurrent-any' ? 'all' : 'concurrent-any',
                }))
              }
              className="text-xs font-semibold text-[var(--ac-bad)] underline cursor-pointer"
            >
              {filter.concurrency === 'concurrent-any' ? 'Show all sessions' : 'Filter table to concurrent only'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {report.findings.map((f) => {
              const dialed = [...new Set(f.concurrentSessions.flatMap((s) => s.services))];
              return (
                <div
                  key={f.identityId}
                  className="p-3.5 rounded-xl bg-[var(--ac-surface)] border border-[var(--ac-line)] flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase ${
                          f.severity === 'critical'
                            ? 'bg-[var(--ac-bad-soft)] text-[var(--ac-bad)]'
                            : 'bg-[var(--ac-pending-soft)] text-[var(--ac-pending)]'
                        }`}
                      >
                        {f.severity === 'critical' ? 'Critical · Multi-IP' : 'Warning · Same IP'}
                      </span>
                      <span className="font-bold font-mono text-sm">{f.identityName}</span>
                      <span className="px-1.5 py-0.5 rounded bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-[10px] uppercase text-[var(--ac-muted)]">
                        {f.authMethod}
                      </span>
                      {f.activitySkewMs !== null && (
                        <span className="text-[11px] text-[var(--ac-muted)]">
                          ({Math.round(f.activitySkewMs / 1000)}s skew)
                        </span>
                      )}
                    </div>
                    <div className="text-[var(--ac-ink)]">
                      {f.summary}
                      {dialed.length > 0 && (
                        <span className="text-[var(--ac-muted)]">
                          {' '}
                          · Services: <code className="text-[var(--ac-ink)]">{dialed.join(', ')}</code>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {f.concurrentSessions.map((cs) => (
                        <button
                          key={cs.apiSessionId}
                          type="button"
                          disabled={cs.isCurrentSession}
                          onClick={() => confirmDropSingleApiSession(cs.apiSessionId, f.identityName, cs.ipAddress)}
                          title={
                            cs.isCurrentSession
                              ? 'Protected: active browser console session'
                              : `Disconnect session ${cs.apiSessionId}`
                          }
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[var(--ac-line)] bg-[var(--ac-surface-2)] hover:border-[var(--ac-bad)] font-mono text-[11px] cursor-pointer disabled:opacity-50"
                        >
                          <Unplug className="w-3 h-3 text-[var(--ac-bad)]" />
                          <span>Drop {cs.ipAddress || cs.apiSessionId}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => confirmRemediation(f, 'terminate-all-sessions')}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--ac-bad)]/50 bg-[var(--ac-bad-soft)] text-[var(--ac-bad)] font-semibold cursor-pointer"
                    >
                      Drop all ({f.totalSessionCount})…
                    </button>
                    {f.authMethod !== 'ext-jwt' && (
                      <button
                        type="button"
                        onClick={() => confirmRemediation(f, 'revoke-authenticators')}
                        className="px-2.5 py-1.5 rounded-lg bg-[var(--ac-bad)] text-white font-semibold cursor-pointer"
                      >
                        Revoke credential…
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Traffic Filtering Panel */}
      <section
        aria-label="Traffic filtering controls"
        className="p-4 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] shadow-sm space-y-3 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 font-semibold">
            <Filter className="w-3.5 h-3.5 text-[var(--ac-dial)]" />
            <span>Traffic &amp; Client IP Filter</span>
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={clearTrafficFilters}
              className="text-xs text-[var(--ac-dial)] underline cursor-pointer"
            >
              Clear all filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <label className="space-y-1 lg:col-span-2">
            <span className="block text-[11px] font-medium text-[var(--ac-muted)]">
              Client IP / CIDR (supports lists &amp; <code>!cidr</code> exclusion)
            </span>
            <input
              type="text"
              value={filter.ipFilter}
              onChange={(e) => setFilter((prev) => ({ ...prev, ipFilter: e.target.value }))}
              placeholder="e.g. 198.51.100.0/24, 203.0.113.194, or !10.0.0.0/8"
              aria-invalid={!ipValidation.valid}
              className={`w-full px-3 py-1.5 rounded-lg border bg-[var(--ac-surface-2)] font-mono text-xs ${
                ipValidation.valid ? 'border-[var(--ac-line)]' : 'border-[var(--ac-pending)]'
              }`}
            />
            {!ipValidation.valid && (
              <span className="block text-[11px] text-[var(--ac-pending)]">
                {ipValidation.error} (showing unfiltered rows until complete)
              </span>
            )}
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--ac-muted)]">Service</span>
            <select
              value={filter.serviceId}
              onChange={(e) => setFilter((prev) => ({ ...prev, serviceId: e.target.value }))}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-xs"
            >
              <option value="all">All services</option>
              <option value="__idle__">Idle (no active service)</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--ac-muted)]">Role Attribute &amp; Direction</span>
            <div className="flex gap-1.5">
              <select
                aria-label="Filter by role attribute"
                value={filter.roleAttribute}
                onChange={(e) => setFilter((prev) => ({ ...prev, roleAttribute: e.target.value }))}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-xs font-mono"
              >
                <option value="">All #roles</option>
                {allRoleAttrs.map((a) => (
                  <option key={a} value={a}>
                    #{a}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by Dial or Bind"
                value={filter.sessionType}
                onChange={(e) =>
                  setFilter((prev) => ({ ...prev, sessionType: e.target.value as 'all' | 'Dial' | 'Bind' }))
                }
                className="w-20 px-2 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-xs"
              >
                <option value="all">All</option>
                <option value="Dial">Dial</option>
                <option value="Bind">Bind</option>
              </select>
            </div>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--ac-muted)]">Identity Concurrency</span>
            <select
              value={filter.concurrency}
              onChange={(e) =>
                setFilter((prev) => ({ ...prev, concurrency: e.target.value as ConcurrencyFilterMode }))
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-xs"
            >
              <option value="all">All sessions</option>
              <option value="concurrent-any">Concurrent (2+ sessions)</option>
              <option value="concurrent-multi-ip">Multi-IP (2+ distinct IPs)</option>
              <option value="concurrent-same-ip">Same-IP concurrent</option>
            </select>
          </label>
        </div>
      </section>

      {tab === 'sessions' ? (
        <DataTable
          caption="Correlated Service Traffic"
          data={filteredFlows}
          columns={flowCols}
          headerTabs={headerTabs}
          searchPlaceholder="Search identity, service, router, or IP…"
          searchValue={filter.search}
          onSearchChange={updateSearch}
          extraActions={(row) =>
            row.apiSessionId && !row.isCurrentSession ? (
              <button
                type="button"
                title={`Revoke underlying API session (${row.ipAddress || row.apiSessionId})`}
                onClick={() => confirmDropSingleApiSession(row.apiSessionId!, row.identityName, row.ipAddress)}
                className="p-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] hover:text-[var(--ac-bad)] cursor-pointer"
              >
                <Unplug className="w-3.5 h-3.5" />
              </button>
            ) : null
          }
          onDelete={async (row) => {
            await zitiService.remove('sessions', row.sessionId);
            onToast('info', 'Service session terminated', `${row.identityName} → ${row.serviceName}`);
            await load();
          }}
        />
      ) : (
        <DataTable
          caption="API Sessions"
          data={filteredApiSessions}
          columns={apiSessCols}
          headerTabs={headerTabs}
          searchPlaceholder="Search identity, IP, auth method, or service…"
          searchValue={filter.search}
          onSearchChange={updateSearch}
          onDelete={async (row) => {
            if (row.isCurrentSession) {
              throw new Error('Cannot revoke the API session currently used by this browser console. Use Log out instead.');
            }
            await zitiService.remove('api-sessions', row.id);
            onToast('info', 'API Session revoked', `${row.identityName} (${row.ipAddress || row.id})`);
            await load();
          }}
        />
      )}

      {/* Concurrency Policy Modal */}
      <ModalDialog open={policyOpen} onClose={() => setPolicyOpen(false)} wide title="Concurrency Detection Policy">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const skewTrim = draftSkewSec.trim();
            const saved = zitiService.saveConcurrencyPolicy({
              activeWithinSeconds: Number(draftActiveSec),
              maxActivitySkewSeconds: skewTrim ? Number(skewTrim) : null,
              minConcurrentSessions: Number(draftMinConc),
              requireDistinctIps: draftRequireDistinctIps,
              exemptAdminIdentities: draftExemptAdmin,
              exemptExternalIdentities: draftExemptExt,
              exemptRoleAttributes: draftExemptAttrs
                .split(/[,\s]+/)
                .map((s) => s.trim().replace(/^#/, ''))
                .filter(Boolean),
            });
            setPolicy(saved);
            setPolicyOpen(false);
            onToast('success', 'Concurrency policy updated', 'Applied in memory without reloading controller state.');
          }}
          className="space-y-4 text-xs"
        >
          <p className="text-[var(--ac-muted)] m-0">
            Configure when multiple API sessions for the <strong>same OpenZiti identity</strong> count as concurrent
            (shared firewall IPs across <em>different</em> identities are normal and never flagged).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="font-semibold block">Active Window (seconds)</span>
              <input
                type="number"
                min={0}
                required
                value={draftActiveSec}
                onChange={(e) => setDraftActiveSec(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono"
              />
              <span className="block text-[11px] text-[var(--ac-muted)]">
                Sessions idle longer than this are treated as stale (`0` = never expire).
              </span>
            </label>

            <label className="space-y-1">
              <span className="font-semibold block">Max Activity Skew (seconds)</span>
              <input
                type="number"
                min={0}
                placeholder="Disabled"
                value={draftSkewSec}
                onChange={(e) => setDraftSkewSec(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono"
              />
              <span className="block text-[11px] text-[var(--ac-muted)]">
                Max gap from the newest session to join the concurrent cluster. Blank disables.
              </span>
            </label>

            <label className="space-y-1">
              <span className="font-semibold block">Min Concurrent Sessions</span>
              <input
                type="number"
                min={2}
                required
                value={draftMinConc}
                onChange={(e) => setDraftMinConc(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono"
              />
              <span className="block text-[11px] text-[var(--ac-muted)]">
                Clustered live sessions required before raising a warning (`2` or higher).
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draftExemptAdmin}
                onChange={(e) => setDraftExemptAdmin(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold block">Exempt Admin identities</span>
                <span className="text-[11px] text-[var(--ac-muted)]">
                  Recommended so using both this console and the CLI never flags your admin account.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draftExemptExt}
                onChange={(e) => setDraftExemptExt(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold block">Exempt External JWT / OIDC SSO</span>
                <span className="text-[11px] text-[var(--ac-muted)]">
                  Identities with an <code>externalId</code> are expected to connect across devices.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draftRequireDistinctIps}
                onChange={(e) => setDraftRequireDistinctIps(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold block">Require 2+ distinct client IPs</span>
                <span className="text-[11px] text-[var(--ac-muted)]">
                  Ignore concurrent sessions on one identity when they share the same IP.
                </span>
              </span>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="font-semibold block">Exempt Role Attributes (comma or space separated)</span>
            <input
              type="text"
              value={draftExemptAttrs}
              onChange={(e) => setDraftExemptAttrs(e.target.value)}
              placeholder="e.g. multi-device, ha-hosts"
              className="w-full px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono"
            />
          </label>

          <div className="flex items-center justify-between pt-3 border-t border-[var(--ac-line)]">
            <button
              type="button"
              onClick={() => {
                const def = zitiService.resetConcurrencyPolicy();
                setPolicy(def);
                setPolicyOpen(false);
                onToast('info', 'Reset to defaults', 'Restored default concurrency detection policy.');
              }}
              className="text-xs text-[var(--ac-muted)] hover:text-[var(--ac-ink)] underline cursor-pointer"
            >
              Reset to defaults
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPolicyOpen(false)}
                className="px-4 py-2 rounded-lg border border-[var(--ac-line)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
              >
                Save Policy
              </button>
            </div>
          </div>
        </form>
      </ModalDialog>

      {/* Unified Destructive Action Confirmation Modal */}
      <ModalDialog open={!!pendingConfirm} onClose={closeConfirm} title={pendingConfirm?.title || 'Confirm action'}>
        <div className="space-y-4 text-xs">
          <p className="m-0">{pendingConfirm?.description}</p>
          {confirmError && (
            <p role="alert" className="m-0 p-3 rounded-lg border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)]">
              {confirmError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--ac-line)]">
            <button
              type="button"
              onClick={closeConfirm}
              disabled={confirmBusy}
              className="px-3.5 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeConfirmed}
              disabled={confirmBusy}
              autoFocus
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--ac-bad)] text-white font-semibold cursor-pointer disabled:opacity-60"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{confirmBusy ? 'Working…' : pendingConfirm?.confirmLabel || 'Confirm'}</span>
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
};
