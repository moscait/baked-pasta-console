import React, { useCallback, useEffect, useState } from 'react';
import type { AuthPolicy, CertificateAuthority, ExternalJwtSigner } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';

type AuthTab = 'cas' | 'auth-policies' | 'external-jwt-signers';

export const AuthenticationPage: React.FC<{
  initialTab?: AuthTab;
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ initialTab = 'cas', onToast }) => {
  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [cas, setCas] = useState<CertificateAuthority[]>([]);
  const [authPolicies, setAuthPolicies] = useState<AuthPolicy[]>([]);
  const [signers, setSigners] = useState<ExternalJwtSigner[]>([]);

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
        <span className="px-2 py-0.5 rounded-full bg-[var(--ac-ok-soft)] text-[var(--ac-ok)] text-xs font-medium">
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
        <DataTable caption="Certificate Authorities" data={cas} columns={caCols} headerTabs={headerTabs} />
      )}
      {tab === 'auth-policies' && (
        <DataTable caption="Authentication Policies" data={authPolicies} columns={apCols} headerTabs={headerTabs} />
      )}
      {tab === 'external-jwt-signers' && (
        <DataTable caption="External JWT Signers" data={signers} columns={signerCols} headerTabs={headerTabs} />
      )}
    </div>
  );
};
