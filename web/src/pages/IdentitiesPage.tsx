import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import type { ApiSession, Identity } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { ModalDialog } from '../components/ModalDialog';
import { useCreateIntent } from '../components/useCreateIntent';
import { useServiceLoad } from '../components/state-hooks';
import { downloadText } from '../components/csv';
import { ConfigOverridesDialog, IdentityFormDialog } from '../features/identities/IdentityDialogs';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  KeyRound,
  QrCode,
  RotateCcw,
  Shield,
  ShieldOff,
  SlidersHorizontal,
  Terminal,
  UserCheck,
} from 'lucide-react';
import { ConcurrencyPolicy, evaluateSessionMonitor } from '../features/sessions/session-monitor.logic';

/** `yyyy-MM-ddTHH:mm` in local time, the value format of `<input type="datetime-local">`. */
const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A `datetime-local` value `ms` from now. */
const localInputFromNow = (ms: number) => toLocalInput(new Date(Date.now() + ms));

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Token expiries must leave the device at least a minute to enroll. */
const isUsableExpiry = (d: Date) => !Number.isNaN(d.getTime()) && d.getTime() > Date.now() + MINUTE;

export const IdentitiesPage: React.FC<{
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ onToast }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Identity[]>([]);
  const [apiSessions, setApiSessions] = useState<ApiSession[]>([]);
  const [policy, setPolicy] = useState<ConcurrencyPolicy>(() => zitiService.getConcurrencyPolicy());
  // undefined = closed, null = create, an identity = edit
  const [formFor, setFormFor] = useState<Identity | null | undefined>(undefined);
  const [overridesFor, setOverridesFor] = useState<Identity | null>(null);

  // The token dialog follows the identity by id so it always shows its current token.
  const [tokenForId, setTokenForId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [credTarget, setCredTarget] = useState<Identity | null>(null);
  const [credExpiry, setCredExpiry] = useState('');
  const [credMinExpiry, setCredMinExpiry] = useState('');
  const [credBusy, setCredBusy] = useState(false);
  const [credError, setCredError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useServiceLoad(
    () => Promise.all([zitiService.list('identities'), zitiService.list('api-sessions').catch(() => [])]),
    ([list, apiSess]) => {
      setRows(list);
      setApiSessions(apiSess);
    },
    (err) => onToast('error', 'Failed to load identities', zitiService.errorText(err)),
  );

  useEffect(() => zitiService.subscribePolicy(() => setPolicy(zitiService.getConcurrencyPolicy())), []);

  const tokenModal = tokenForId ? rows.find((r) => r.id === tokenForId) || null : null;

  const sessionReport = useMemo(
    () =>
      evaluateSessionMonitor({
        identities: rows,
        apiSessions,
        sessions: [],
        policy,
        currentSessionToken: zitiService.currentSessionToken(),
      }),
    [rows, apiSessions, policy],
  );

  const openCredentials = (row: Identity) => {
    setCredTarget(row);
    setCredExpiry(localInputFromNow(2 * DAY));
    setCredMinExpiry(localInputFromNow(MINUTE));
    setCredError('');
    setConfirmReset(false);
  };

  /** Runs a credential action, then shows the identity's new enrollment token when it has one. */
  const runCredentialAction = async (kind: 'reset' | 'reissue' | 'mfa') => {
    if (!credTarget) return;
    const expiresAt = new Date(credExpiry);
    if (kind !== 'mfa' && !isUsableExpiry(expiresAt)) {
      setCredError('Pick an expiry at least a minute in the future.');
      return;
    }
    setCredBusy(true);
    setCredError('');
    try {
      if (kind === 'reset') await zitiService.resetEnrollment(credTarget, expiresAt);
      else if (kind === 'reissue') await zitiService.reissueEnrollment(credTarget, expiresAt);
      else await zitiService.resetMfa(credTarget);
      const target = credTarget;
      setCredTarget(null);
      if (kind === 'mfa') {
        onToast('success', 'MFA reset', `${target.name} must set up MFA again at next sign-in.`);
        await load();
        return;
      }
      onToast(
        'success',
        kind === 'reset' ? 'Enrollment reset' : 'Enrollment token reissued',
        `${target.name}: new token expires ${expiresAt.toLocaleString()}.`,
      );
      await load();
      setTokenForId(target.id);
    } catch (err) {
      setCredError(zitiService.errorText(err));
    } finally {
      setCredBusy(false);
    }
  };

  const openCreate = () => setFormFor(null);

  useCreateIntent({ identity: openCreate });

  const toastSuccess = useCallback(
    (title: string, detail: string) => onToast('success', title, detail),
    [onToast],
  );

  // Errors propagate so the table's confirm dialog (and bulk delete) can report them per row.
  const handleDelete = async (row: Identity) => {
    await zitiService.remove('identities', row.id);
    onToast('info', 'Identity deleted', row.name);
    await load();
  };

  const getJwt = (row: Identity): string | null =>
    row?.enrollment?.ott?.jwt || row?.enrollment?.updb?.jwt || row?.enrollment?.ca?.jwt || null;

  const isEnrolled = (row: Identity): boolean => {
    const auths = row?.authenticators && Object.keys(row.authenticators).length > 0;
    const enr = row?.enrollment && Object.keys(row.enrollment).length > 0;
    return auths || !enr;
  };

  const downloadJwt = (row: Identity) => {
    const jwt = getJwt(row);
    if (!jwt) return;
    downloadText(`${row.name}.jwt`, jwt, 'application/jwt');
  };

  const columns: ColumnDef<Identity>[] = [
    {
      key: 'name',
      header: 'Identity Name',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold font-mono">{row.name}</span>
          {row.isAdmin && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--ac-dial-soft)] text-[var(--ac-dial)] text-[10px] font-bold uppercase">
              <Shield className="w-3 h-3" />
              Admin
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'roleAttributes',
      header: 'Role Attributes',
      getValue: (row) => (row.roleAttributes || []).join(', '),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {(row.roleAttributes || []).length > 0 ? (
            (row.roleAttributes || []).map((a: string) => (
              <span
                key={a}
                className="px-2 py-0.5 rounded-md bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-xs"
              >
                #{a}
              </span>
            ))
          ) : (
            <span className="text-xs text-[var(--ac-muted)]">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'enrolled',
      header: 'Enrollment Status',
      getValue: (row) => (isEnrolled(row) ? 'Enrolled' : 'Pending JWT'),
      render: (row) =>
        isEnrolled(row) ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--ac-ok-soft)] text-[var(--ac-ok)] text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ac-ok)]" />
            Enrolled
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setTokenForId(row.id)}
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--ac-pending-soft)] text-[var(--ac-pending)] border border-[var(--ac-pending)]/40 text-xs font-medium cursor-pointer hover:opacity-90"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Pending Token (Enroll)</span>
          </button>
        ),
    },
    {
      key: 'online',
      header: 'Connection & Client IPs',
      getValue: (row) => {
        const s = sessionReport.byIdentity.get(row.id);
        if (s?.finding) return `Concurrent (${s.distinctLiveIps.join(', ')})`;
        return row.hasEdgeRouterConnection ? `Online ${s?.distinctLiveIps.join(', ') || ''}` : 'Offline';
      },
      render: (row) => {
        const s = sessionReport.byIdentity.get(row.id);
        const ips = s?.distinctLiveIps || [];
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${
                row.hasEdgeRouterConnection ? 'text-[var(--ac-ok)] font-medium' : 'text-[var(--ac-muted)]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  row.hasEdgeRouterConnection ? 'bg-[var(--ac-ok)]' : 'bg-[var(--ac-muted)]/40'
                }`}
              />
              {row.hasEdgeRouterConnection ? 'Connected' : 'Offline'}
            </span>
            {s?.finding ? (
              <button
                type="button"
                onClick={() => navigate(`/sessions?q=${encodeURIComponent(row.name)}`)}
                title={`${s.finding.summary} — click to inspect in Traffic & Sessions`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--ac-bad-soft)] text-[var(--ac-bad)] border border-[var(--ac-bad)]/40 text-[11px] font-semibold cursor-pointer"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>{ips.length >= 2 ? `${ips.length} IPs` : `${s.liveSessionCount} sessions`}</span>
              </button>
            ) : ips.length > 0 ? (
              <button
                type="button"
                onClick={() => navigate(`/sessions?ip=${encodeURIComponent(ips[0])}`)}
                title="Click to filter Traffic & Sessions by this IP"
                className="px-1.5 py-0.5 rounded bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-[11px] text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer"
              >
                {ips.join(', ')}
              </button>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'sdkInfo',
      header: 'Tunneler / SDK',
      getValue: (row) => row.sdkInfo?.appId || row.sdkInfo?.type || '',
      render: (row) => (
        <span className="text-xs text-[var(--ac-muted)] font-mono">
          {row.sdkInfo?.appId || row.sdkInfo?.type
            ? `${row.sdkInfo.appId || row.sdkInfo.type} ${row.sdkInfo.version || ''}`
            : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight m-0">Identities</h1>
        <p className="text-xs text-[var(--ac-muted)] m-0">
          Devices, users, servers, and workloads with cryptographic certificates on the OpenZiti overlay.
        </p>
      </div>

      <DataTable
        caption="Identities"
        data={rows}
        columns={columns}
        createLabel="New Identity"
        onCreate={openCreate}
        onEdit={setFormFor}
        onDelete={handleDelete}
        extraActions={(row) => (
          <>
            {getJwt(row) && (
              <button
                type="button"
                onClick={() => setTokenForId(row.id)}
                title="Enrollment JWT & QR Code"
                className="p-1.5 rounded-lg border border-[var(--ac-dial)]/40 bg-[var(--ac-dial-soft)] text-[var(--ac-dial)] cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOverridesFor(row)}
              title="Service config overrides for this identity"
              aria-label={`Config overrides for ${row.name}`}
              className="p-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
            {!row.isDefaultAdmin && (
              <button
                type="button"
                onClick={() => openCredentials(row)}
                title="Credentials: reset enrollment, reissue token, reset MFA"
                aria-label={`Credentials for ${row.name}`}
                className="p-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      />

      {/* Credentials: reset enrollment / reissue token / reset MFA */}
      {credTarget && (
        <ModalDialog open={!!credTarget} onClose={() => setCredTarget(null)} title={`Credentials: ${credTarget.name}`}>
          <div className="space-y-4 text-xs">
            {(() => {
              const hasAuth = !!(credTarget.authenticators?.cert?.id || credTarget.authenticators?.updb?.id);
              const pending = !!getJwt(credTarget) || !!credTarget.enrollment?.ottca?.id;
              return (
                <>
                  {(hasAuth || pending) && (
                    <label className="block space-y-1">
                      <span className="font-semibold">New token expires</span>
                      <input
                        type="datetime-local"
                        value={credExpiry}
                        min={credMinExpiry}
                        onChange={(e) => setCredExpiry(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono"
                      />
                    </label>
                  )}

                  {pending && (
                    <section className="p-3 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] space-y-2">
                      <div className="font-semibold">Reissue enrollment token</div>
                      <p className="m-0 text-[var(--ac-muted)]">
                        Replaces the pending one-time token. The current JWT and QR code stop working.
                      </p>
                      <button
                        type="button"
                        disabled={credBusy}
                        onClick={() => runCredentialAction('reissue')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer disabled:opacity-60"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reissue token</span>
                      </button>
                    </section>
                  )}

                  {hasAuth && (
                    <section className="p-3 rounded-xl border border-[var(--ac-bad)]/40 bg-[var(--ac-bad-soft)] space-y-2">
                      <div className="font-semibold text-[var(--ac-bad)]">Reset enrollment</div>
                      <p className="m-0">
                        Revokes the {credTarget.authenticators?.cert ? 'certificate' : 'password'} this identity uses now and
                        issues a new one-time token. The device disconnects and cannot reconnect until it enrolls again.
                      </p>
                      {confirmReset ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={credBusy}
                            onClick={() => runCredentialAction('reset')}
                            autoFocus
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ac-bad)] text-white font-semibold cursor-pointer disabled:opacity-60"
                          >
                            {credBusy ? 'Resetting…' : `Yes, reset ${credTarget.name}`}
                          </button>
                          <button
                            type="button"
                            disabled={credBusy}
                            onClick={() => setConfirmReset(false)}
                            className="px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmReset(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-bad)] text-[var(--ac-bad)] bg-[var(--ac-surface)] font-semibold cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reset enrollment…</span>
                        </button>
                      )}
                    </section>
                  )}

                  <section className="p-3 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] space-y-2">
                    <div className="font-semibold">Reset MFA</div>
                    <p className="m-0 text-[var(--ac-muted)]">
                      {credTarget.isMfaEnabled === false
                        ? 'MFA is not set up for this identity.'
                        : 'Removes the identity’s TOTP enrollment so the user can set up MFA again (e.g. after losing a phone).'}
                    </p>
                    <button
                      type="button"
                      disabled={credBusy || credTarget.isMfaEnabled === false}
                      onClick={() => runCredentialAction('mfa')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      <ShieldOff className="w-3.5 h-3.5" />
                      <span>Reset MFA</span>
                    </button>
                  </section>

                  {credError && (
                    <p role="alert" className="m-0 p-3 rounded-lg border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)]">
                      {credError}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </ModalDialog>
      )}

      {formFor !== undefined && (
        <IdentityFormDialog editing={formFor} onClose={() => setFormFor(undefined)} onSaved={toastSuccess} />
      )}
      {overridesFor && (
        <ConfigOverridesDialog key={overridesFor.id} identity={overridesFor} onClose={() => setOverridesFor(null)} onChanged={toastSuccess} />
      )}

      {/* Enrollment Token & QR Code Modal */}
      {tokenModal && (
        <ModalDialog
          open={!!tokenModal}
          onClose={() => setTokenForId(null)}
          title={`Enroll Identity: ${tokenModal.name}`}
        >
          <div className="space-y-5 text-xs">
            <p className="text-[var(--ac-muted)] m-0">
              Scan this QR code with Ziti Mobile Edge (iOS / Android), download the <code>.jwt</code> file for Ziti Desktop Edge, or run the Linux tunneler command below.
            </p>

            {getJwt(tokenModal) && (
              <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-xl bg-[var(--ac-surface-2)] border border-[var(--ac-line)]">
                <div className="p-3 bg-white rounded-xl shadow-sm flex-none">
                  <QRCodeSVG value={getJwt(tokenModal)!} size={148} />
                </div>
                <div className="space-y-2.5 flex-1 min-w-0">
                  <div className="font-semibold text-sm">{tokenModal.name}.jwt</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => downloadJwt(tokenModal)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download .jwt</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(getJwt(tokenModal)!);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1800);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-[var(--ac-ok)]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied JWT' : 'Copy JWT'}</span>
                    </button>
                  </div>
                  {zitiService.isDemoMode() && (
                    <button
                      type="button"
                      onClick={async () => {
                        await zitiService.simulateEnrollDemoIdentity(tokenModal.id);
                        onToast('success', 'Enrolled!', `${tokenModal.name} is now enrolled and online.`);
                        setTokenForId(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ac-ok-soft)] text-[var(--ac-ok)] border border-[var(--ac-ok)]/40 font-semibold cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Simulate Tunneler Enrollment Now</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[var(--ac-dial)]" />
                <span>Linux Server / CLI Enrollment Command</span>
              </div>
              <pre className="p-3 rounded-xl bg-[var(--ac-surface-2)] border border-[var(--ac-line)] overflow-x-auto font-mono text-[11px]">
                {`sudo ziti-edge-tunnel enroll --jwt ${tokenModal.name}.jwt --identity /opt/openziti/etc/identities/${tokenModal.name}.json`}
              </pre>
            </div>
          </div>
        </ModalDialog>
      )}
    </div>
  );
};
