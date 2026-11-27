import React, { useEffect, useState } from 'react';
import type { CaClaimLocation, CaClaimMatcher, CaClaimParser, CertificateAuthority } from '../../services/api-types';
import { zitiService } from '../../services/ziti-service';
import { ModalDialog } from '../../components/ModalDialog';
import { JwtPanel } from '../../components/JwtPanel';
import { CheckField, ErrorList, Field, FormActions, FormSection, inputCls, useDraft, useFormSubmit } from '../../components/form';
import {
  CA_CLAIM_LOCATIONS,
  CA_CLAIM_MATCHERS,
  CA_CLAIM_PARSERS,
  caBody,
  caDraft,
  caVerifyInstructions,
} from './auth-forms.logic';

type Saved = (title: string, name: string) => void;

export const CaFormDialog: React.FC<{ editing: CertificateAuthority | null; onClose: () => void; onSaved: Saved }> = ({
  editing,
  onClose,
  onSaved,
}) => {
  const [draft, set] = useDraft(() => caDraft(editing || undefined));
  const { errors, busy, submit } = useFormSubmit(
    () => caBody(draft, !editing),
    async (body) => {
      if (editing) await zitiService.patch('cas', editing.id, body);
      else await zitiService.create('cas', body);
      onSaved(editing ? 'Certificate authority updated' : 'Certificate authority created', body.name);
    },
    onClose,
  );

  return (
    <ModalDialog open wide onClose={onClose} title={editing ? `Edit CA: ${editing.name}` : 'Create Certificate Authority'}>
      <form onSubmit={submit} className="space-y-4 text-xs" noValidate>
        <Field label="Name">
          <input autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        {editing ? (
          <p className="m-0 text-[var(--ac-muted)]">
            The certificate can't be changed. Delete and recreate the CA to use a different one.
          </p>
        ) : (
          <Field label="CA certificate (PEM)" hint="After creating it, verify the CA to prove you hold its private key.">
            <textarea
              rows={6}
              spellCheck={false}
              value={draft.certPem}
              onChange={(e) => set('certPem', e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----"
              className={`${inputCls} text-[11px]`}
            />
          </Field>
        )}
        <FormSection title="Identities from this CA">
          <CheckField
            label="Authentication enabled"
            checked={draft.isAuthEnabled}
            onChange={(v) => set('isAuthEnabled', v)}
            hint="Certificates signed by this CA may authenticate."
          />
          <CheckField
            label="Auto CA enrollment"
            checked={draft.isAutoCaEnrollmentEnabled}
            onChange={(v) => set('isAutoCaEnrollmentEnabled', v)}
            hint="A device with a certificate from this CA creates its own identity on first contact."
          />
          <CheckField
            label="One-time token CA enrollment"
            checked={draft.isOttCaEnrollmentEnabled}
            onChange={(v) => set('isOttCaEnrollmentEnabled', v)}
            hint="Pre-created identities may enroll with a one-time token plus a certificate from this CA."
          />
          <Field label="Identity roles" hint="Role attributes given to identities that auto-enroll.">
            <input value={draft.identityRoles} onChange={(e) => set('identityRoles', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Identity name format" hint="Placeholders: [caName], [caId], [commonName], [identityId], [requestedName].">
            <input
              value={draft.identityNameFormat}
              onChange={(e) => set('identityNameFormat', e.target.value)}
              className={inputCls}
            />
          </Field>
        </FormSection>
        <FormSection title="External ID claim">
          <CheckField
            label="Read an external ID from the certificate"
            checked={draft.useExternalIdClaim}
            onChange={(v) => set('useExternalIdClaim', v)}
            hint="Matches the identity whose external ID equals the extracted value."
          />
          {draft.useExternalIdClaim && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Location">
                <select
                  value={draft.claimLocation}
                  onChange={(e) => set('claimLocation', e.target.value as CaClaimLocation)}
                  className={inputCls}
                >
                  {CA_CLAIM_LOCATIONS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Matcher">
                <select
                  value={draft.claimMatcher}
                  onChange={(e) => set('claimMatcher', e.target.value as CaClaimMatcher)}
                  className={inputCls}
                >
                  {CA_CLAIM_MATCHERS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Match criteria">
                <input
                  disabled={draft.claimMatcher === 'ALL'}
                  value={draft.claimMatcherCriteria}
                  onChange={(e) => set('claimMatcherCriteria', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Parser">
                <select
                  value={draft.claimParser}
                  onChange={(e) => set('claimParser', e.target.value as CaClaimParser)}
                  className={inputCls}
                >
                  {CA_CLAIM_PARSERS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Separator">
                <input
                  disabled={draft.claimParser !== 'SPLIT'}
                  value={draft.claimParserCriteria}
                  onChange={(e) => set('claimParserCriteria', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Index">
                <input inputMode="numeric" value={draft.claimIndex} onChange={(e) => set('claimIndex', e.target.value)} className={inputCls} />
              </Field>
            </div>
          )}
        </FormSection>
        <ErrorList errors={errors} />
        <FormActions onCancel={onClose} submitLabel={editing ? 'Save changes' : 'Create CA'} busy={busy} />
      </form>
    </ModalDialog>
  );
};

/** Upload the proof-of-possession certificate that marks a CA verified. */
export const CaVerifyDialog: React.FC<{ ca: CertificateAuthority; onClose: () => void; onVerified: Saved }> = ({
  ca,
  onClose,
  onVerified,
}) => {
  const [pem, setPem] = useState('');
  const { errors, busy, submit } = useFormSubmit<string>(
    () => ({ ok: true, body: pem }),
    async (body) => {
      await zitiService.verifyCa(ca, body);
      onVerified('Certificate authority verified', ca.name);
    },
    onClose,
  );

  const readFile = async (file: File | undefined) => {
    if (file) setPem(await file.text());
  };

  return (
    <ModalDialog open onClose={onClose} title={`Verify CA: ${ca.name}`}>
      <form onSubmit={submit} className="space-y-4 text-xs" noValidate>
        <p className="m-0 text-[var(--ac-muted)]">
          Sign a certificate with this CA's private key, using the verification token{' '}
          <code className="font-mono">{ca.verificationToken || '(not reported)'}</code> as its common name, and paste it here.
        </p>
        <pre className="m-0 p-3 rounded-xl bg-[var(--ac-surface-2)] border border-[var(--ac-line)] overflow-x-auto font-mono text-[11px]">
          {caVerifyInstructions(ca)}
        </pre>
        <Field label="Verification certificate (PEM)">
          <textarea
            autoFocus
            rows={6}
            spellCheck={false}
            value={pem}
            onChange={(e) => setPem(e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----"
            className={`${inputCls} text-[11px]`}
          />
        </Field>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <span className="font-medium">or load a file</span>
          <input type="file" accept=".pem,.crt,.cer,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
        <ErrorList errors={errors} />
        <FormActions onCancel={onClose} submitLabel="Verify" busy={busy} />
      </form>
    </ModalDialog>
  );
};

/** The JWT that identities enrolling against this CA present (`GET cas/{id}/jwt`). */
export const CaJwtDialog: React.FC<{ ca: CertificateAuthority; onClose: () => void }> = ({ ca, onClose }) => {
  const [jwt, setJwt] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    zitiService
      .caEnrollmentJwt(ca)
      .then((t) => live && setJwt(t))
      .catch((err) => live && setError(zitiService.errorText(err)));
    return () => {
      live = false;
    };
  }, [ca]);

  return (
    <ModalDialog open onClose={onClose} title={`CA enrollment JWT: ${ca.name}`}>
      <div className="space-y-4 text-xs">
        <p className="m-0 text-[var(--ac-muted)]">
          Devices holding a certificate from this CA enroll with this token.
        </p>
        {error ? <ErrorList errors={[error]} /> : jwt === null ? <p className="m-0">Loading…</p> : <JwtPanel jwt={jwt} fileName={ca.name} />}
      </div>
    </ModalDialog>
  );
};
