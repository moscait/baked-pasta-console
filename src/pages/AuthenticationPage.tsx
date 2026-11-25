import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, KeySquare } from 'lucide-react';
import type { AuthPolicy, CertificateAuthority, Collection, ExternalJwtSigner } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { CaFormDialog, CaJwtDialog, CaVerifyDialog } from '../features/authentication/CaDialogs';
import { AuthPolicyFormDialog, JwtSignerFormDialog } from '../features/authentication/PolicySignerDialogs';

type AuthTab = 'cas' | 'auth-policies' | 'external-jwt-signers';

/** Which dialog is open; `editing: null` means create. */
type Dialog =
  | { kind: 'ca'; editing: CertificateAuthority | null }
  | { kind: 'ca-verify' | 'ca-jwt'; ca: CertificateAuthority }
  | { kind: 'auth-policy'; editing: AuthPolicy | null }
  | { kind: 'jwt-signer'; editing: ExternalJwtSigner | null };

const actionBtn =
  'p-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer';

export const AuthenticationPage: React.FC<{
  initialTab?: AuthTab;
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ initialTab = 'cas', onToast }) => {
  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [cas, setCas] = useState<CertificateAuthority[]>([]);
  const [authPolicies, setAuthPolicies] = useState<AuthPolicy[]>([]);
  const [signers, setSigners] = useState<ExternalJwtSigner[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const saved = useCallback((title: string, name: string) => onToast('success', title, name), [onToast]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const load = useCallback(async () => {
    try {
      const [c, ap, s] = await Promise.all([
        zitiService.list('cas'),
        zitiService.list('auth-policies'),
        zitiService.list('external-jwt-signers'),
      ]);
      setCas(c);
      setAuthPolicies(ap);
      setSigners(s);
    } catch (err) {
      onToast('error', 'Load failed', zitiService.errorText(err));
    }
  }, [onToast]);

  useEffect(() => {
    load();
    return zitiService.subscribe(load);
  }, [load]);

  // Errors propagate so the table's delete confirmation (and bulk delete) report them per row.
  const remove =
    <T extends { id: string; name: string }>(collection: Collection, label: string) =>
    async (row: T) => {
      await zitiService.remove(collection, row.id);
      onToast('info', `${label} deleted`, row.name);
      await load();
    };

  const caCols: ColumnDef<CertificateAuthority>[] = [
    { key: 'name', header: 'Certificate Authority', render: (r) => <span className="font-semibold">{r.name}</span> },
    {
      key: 'isVerified',
      header: 'Verified',
      render: (r) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            r.isVerified ? 'bg-[var(--ac-ok-soft)] text-[var(--ac-ok)]' : 'bg-[var(--ac-pending-soft)] text-[var(--ac-pending)]'
          }`}
        >
          {r.isVerified ? 'Verified' : 'Unverified'}
        </span>
      ),
    },
    {
      key: 'isAutoCaEnrollmentEnabled',
      header: 'Auto-Enrollment',
      render: (r) => <span className="text-xs">{r.isAutoCaEnrollmentEnabled ? 'Enabled' : 'Disabled'}</span>,
    },
  ];

  const apCols: ColumnDef<AuthPolicy>[] = [
    { key: 'name', header: 'Auth Policy Name', render: (r) => <span className="font-semibold">{r.name}</span> },
    {
      key: 'cert',
      header: 'Client Cert',
      render: (r) => <span className="text-xs">{r.primary?.cert?.allowed ? 'Allowed' : 'Disabled'}</span>,
    },
    {
      key: 'updb',
      header: 'Password (UPDB)',
      render: (r) => <span className="text-xs">{r.primary?.updb?.allowed ? 'Allowed' : 'Disabled'}</span>,
    },
    {
      key: 'extJwt',
      header: 'External JWT / OIDC',
      render: (r) => <span className="text-xs">{r.primary?.extJwt?.allowed ? 'Allowed' : 'Disabled'}</span>,
    },
  ];

  const signerCols: ColumnDef<ExternalJwtSigner>[] = [
    { key: 'name', header: 'JWT Signer Name', render: (r) => <span className="font-semibold">{r.name}</span> },
    { key: 'issuer', header: 'OIDC Issuer', render: (r) => <code className="text-xs">{r.issuer}</code> },
    { key: 'audience', header: 'Audience', render: (r) => <code className="text-xs">{r.audience}</code> },
    {
      key: 'enabled',
      header: 'Status',
      render: (r) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            r.enabled !== false ? 'bg-[var(--ac-ok-soft)] text-[var(--ac-ok)]' : 'bg-[var(--ac-surface-2)] text-[var(--ac-muted)]'
          }`}
        >
          {r.enabled !== false ? 'Enabled' : 'Disabled'}
        </span>
      ),
    },
  ];

  const headerTabs = (
    <div className="inline-flex rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] p-1 text-xs">
      <button
        type="button"
        onClick={() => setTab('cas')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'cas' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        Certificate Authorities ({cas.length})
      </button>
      <button
        type="button"
        onClick={() => setTab('auth-policies')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'auth-policies' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        Auth Policies ({authPolicies.length})
      </button>
      <button
        type="button"
        onClick={() => setTab('external-jwt-signers')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'external-jwt-signers' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        External JWT Signers ({signers.length})
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight m-0">Authentication & PKI</h1>
        <p className="text-xs text-[var(--ac-muted)] m-0">
          Third-party Certificate Authorities, Authentication Policies, and External OIDC / JWT Signers.
        </p>
      </div>

      {tab === 'cas' && (
        <DataTable
          caption="Certificate Authorities"
          data={cas}
          columns={caCols}
          headerTabs={headerTabs}
          createLabel="New CA"
          onCreate={() => setDialog({ kind: 'ca', editing: null })}
          onEdit={(row) => setDialog({ kind: 'ca', editing: row })}
          onDelete={remove('cas', 'Certificate authority')}
          extraActions={(row) => (
            <>
              {!row.isVerified && (
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'ca-verify', ca: row })}
                  title="Verify: prove possession of the CA's private key"
                  aria-label={`Verify ${row.name}`}
                  className={actionBtn}
                >
                  <BadgeCheck className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setDialog({ kind: 'ca-jwt', ca: row })}
                title="Enrollment JWT for devices with certificates from this CA"
                aria-label={`Enrollment JWT for ${row.name}`}
                className={actionBtn}
              >
                <KeySquare className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        />
      )}
      {tab === 'auth-policies' && (
        <DataTable
          caption="Authentication Policies"
          data={authPolicies}
          columns={apCols}
          headerTabs={headerTabs}
          createLabel="New Auth Policy"
          onCreate={() => setDialog({ kind: 'auth-policy', editing: null })}
          onEdit={(row) => setDialog({ kind: 'auth-policy', editing: row })}
          onDelete={remove('auth-policies', 'Auth policy')}
        />
      )}
      {tab === 'external-jwt-signers' && (
        <DataTable
          caption="External JWT Signers"
          data={signers}
          columns={signerCols}
          headerTabs={headerTabs}
          createLabel="New JWT Signer"
          onCreate={() => setDialog({ kind: 'jwt-signer', editing: null })}
          onEdit={(row) => setDialog({ kind: 'jwt-signer', editing: row })}
          onDelete={remove('external-jwt-signers', 'JWT signer')}
        />
      )}

      {dialog?.kind === 'ca' && <CaFormDialog editing={dialog.editing} onClose={closeDialog} onSaved={saved} />}
      {dialog?.kind === 'ca-verify' && <CaVerifyDialog ca={dialog.ca} onClose={closeDialog} onVerified={saved} />}
      {dialog?.kind === 'ca-jwt' && <CaJwtDialog ca={dialog.ca} onClose={closeDialog} />}
      {dialog?.kind === 'auth-policy' && (
        <AuthPolicyFormDialog editing={dialog.editing} signers={signers} onClose={closeDialog} onSaved={saved} />
      )}
      {dialog?.kind === 'jwt-signer' && (
        <JwtSignerFormDialog editing={dialog.editing} authPolicies={authPolicies} onClose={closeDialog} onSaved={saved} />
      )}
    </div>
  );
};
