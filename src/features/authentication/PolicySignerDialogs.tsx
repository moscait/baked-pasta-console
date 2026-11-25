import React from 'react';
import type { AuthPolicy, ExternalJwtSigner, JwtTargetToken } from '../../services/api-types';
import { zitiService } from '../../services/ziti-service';
import { ModalDialog } from '../../components/ModalDialog';
import { CheckField, ErrorList, Field, FormActions, FormSection, inputCls, useDraft, useFormSubmit } from '../../components/form';
import { authPolicyBody, authPolicyDraft, jwtSignerBody, jwtSignerDraft } from './auth-forms.logic';

type Saved = (title: string, name: string) => void;

export const AuthPolicyFormDialog: React.FC<{
  editing: AuthPolicy | null;
  signers: ExternalJwtSigner[];
  onClose: () => void;
  onSaved: Saved;
}> = ({ editing, signers, onClose, onSaved }) => {
  const [draft, set] = useDraft(() => authPolicyDraft(editing || undefined));
  const { errors, busy, submit } = useFormSubmit(
    () => authPolicyBody(draft),
    async (body) => {
      if (editing) await zitiService.patch('auth-policies', editing.id, body);
      else await zitiService.create('auth-policies', body);
      onSaved(editing ? 'Auth policy updated' : 'Auth policy created', body.name);
    },
    onClose,
  );
  const toggleSigner = (id: string, on: boolean) =>
    set('allowedSigners', on ? [...draft.allowedSigners, id] : draft.allowedSigners.filter((s) => s !== id));

  return (
    <ModalDialog open wide onClose={onClose} title={editing ? `Edit Auth Policy: ${editing.name}` : 'Create Auth Policy'}>
      <form onSubmit={submit} className="space-y-4 text-xs" noValidate>
        <Field label="Name">
          <input autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormSection title="Certificate">
            <CheckField label="Allowed" checked={draft.certAllowed} onChange={(v) => set('certAllowed', v)} />
            <CheckField
              label="Allow expired certificates"
              disabled={!draft.certAllowed}
              checked={draft.certAllowExpired}
              onChange={(v) => set('certAllowExpired', v)}
              hint="Lets a device with an expired certificate sign in to extend it."
            />
          </FormSection>
          <FormSection title="Username / password">
            <CheckField label="Allowed" checked={draft.updbAllowed} onChange={(v) => set('updbAllowed', v)} />
            <Field label="Minimum length">
              <input
                inputMode="numeric"
                disabled={!draft.updbAllowed}
                value={draft.minPasswordLength}
                onChange={(e) => set('minPasswordLength', e.target.value)}
                className={inputCls}
              />
            </Field>
            <CheckField label="Require mixed case" disabled={!draft.updbAllowed} checked={draft.requireMixedCase} onChange={(v) => set('requireMixedCase', v)} />
            <CheckField label="Require a number" disabled={!draft.updbAllowed} checked={draft.requireNumberChar} onChange={(v) => set('requireNumberChar', v)} />
            <CheckField label="Require a symbol" disabled={!draft.updbAllowed} checked={draft.requireSpecialChar} onChange={(v) => set('requireSpecialChar', v)} />
            <Field label="Max attempts" hint="0 = unlimited.">
              <input
                inputMode="numeric"
                disabled={!draft.updbAllowed}
                value={draft.maxAttempts}
                onChange={(e) => set('maxAttempts', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Lockout (minutes)" hint="How long an identity is locked out after too many failures.">
              <input
                inputMode="numeric"
                disabled={!draft.updbAllowed}
                value={draft.lockoutDurationMinutes}
                onChange={(e) => set('lockoutDurationMinutes', e.target.value)}
                className={inputCls}
              />
            </Field>
          </FormSection>
          <FormSection title="External JWT">
            <CheckField label="Allowed" checked={draft.extJwtAllowed} onChange={(v) => set('extJwtAllowed', v)} />
            <div className="space-y-1">
              <span className="font-medium">Allowed signers</span>
              <span className="block text-[11px] text-[var(--ac-muted)]">None selected = any signer.</span>
              {signers.length === 0 && <span className="block text-[var(--ac-muted)]">No signers defined.</span>}
              {signers.map((s) => (
                <CheckField
                  key={s.id}
                  label={s.name}
                  disabled={!draft.extJwtAllowed}
                  checked={draft.allowedSigners.includes(s.id)}
                  onChange={(v) => toggleSigner(s.id, v)}
                />
              ))}
            </div>
          </FormSection>
        </div>
        <FormSection title="Secondary (second factor)">
          <CheckField label="Require TOTP (MFA)" checked={draft.requireTotp} onChange={(v) => set('requireTotp', v)} />
          <Field label="Require a JWT from">
            <select
              value={draft.requireExtJwtSigner}
              onChange={(e) => set('requireExtJwtSigner', e.target.value)}
              className={inputCls}
            >
              <option value="">No additional JWT</option>
              {signers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>
        <ErrorList errors={errors} />
        <FormActions onCancel={onClose} submitLabel={editing ? 'Save changes' : 'Create policy'} busy={busy} />
      </form>
    </ModalDialog>
  );
};

export const JwtSignerFormDialog: React.FC<{
  editing: ExternalJwtSigner | null;
  authPolicies: AuthPolicy[];
  onClose: () => void;
  onSaved: Saved;
}> = ({ editing, authPolicies, onClose, onSaved }) => {
  const [draft, set] = useDraft(() => jwtSignerDraft(editing || undefined));
  const { errors, busy, submit } = useFormSubmit(
    () => jwtSignerBody(draft),
    async (body) => {
      if (editing) await zitiService.patch('external-jwt-signers', editing.id, body);
      else await zitiService.create('external-jwt-signers', body);
      onSaved(editing ? 'JWT signer updated' : 'JWT signer created', body.name);
    },
    onClose,
  );

  return (
    <ModalDialog open wide onClose={onClose} title={editing ? `Edit JWT Signer: ${editing.name}` : 'Create External JWT Signer'}>
      <form onSubmit={submit} className="space-y-4 text-xs" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <input autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
          </Field>
          <div className="flex items-end pb-2">
            <CheckField label="Enabled" checked={draft.enabled} onChange={(v) => set('enabled', v)} />
          </div>
          <Field label="Issuer" hint="Must equal the token's iss claim.">
            <input value={draft.issuer} onChange={(e) => set('issuer', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Audience" hint="Must appear in the token's aud claim.">
            <input value={draft.audience} onChange={(e) => set('audience', e.target.value)} className={inputCls} />
          </Field>
        </div>
        <FormSection title="Signing key">
          <div className="flex gap-4" role="radiogroup" aria-label="Signing key source">
            {(['jwks', 'cert'] as const).map((src) => (
              <label key={src} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="keySource" checked={draft.keySource === src} onChange={() => set('keySource', src)} />
                <span>{src === 'jwks' ? 'Fetch keys from a JWKS URL' : 'Use a fixed certificate'}</span>
              </label>
            ))}
          </div>
          {draft.keySource === 'jwks' ? (
            <Field label="JWKS endpoint">
              <input
                value={draft.jwksEndpoint}
                onChange={(e) => set('jwksEndpoint', e.target.value)}
                placeholder="https://idp.example.com/.well-known/jwks.json"
                className={inputCls}
              />
            </Field>
          ) : (
            <>
              <Field label="Certificate (PEM)">
                <textarea
                  rows={5}
                  spellCheck={false}
                  value={draft.certPem}
                  onChange={(e) => set('certPem', e.target.value)}
                  className={`${inputCls} text-[11px]`}
                />
              </Field>
              <Field label="Key ID (kid)" hint="Optional; matched against the token header.">
                <input value={draft.kid} onChange={(e) => set('kid', e.target.value)} className={inputCls} />
              </Field>
            </>
          )}
        </FormSection>
        <FormSection title="Identity mapping">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Claims property" hint="The claim that names the identity, usually sub or email.">
              <input value={draft.claimsProperty} onChange={(e) => set('claimsProperty', e.target.value)} className={inputCls} />
            </Field>
            <div className="flex items-end pb-2">
              <CheckField
                label="Match external ID"
                checked={draft.useExternalId}
                onChange={(v) => set('useExternalId', v)}
                hint="Off: the claim is an identity ID."
              />
            </div>
          </div>
        </FormSection>
        <FormSection title="Browser sign-in (OIDC)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Client ID">
              <input value={draft.clientId} onChange={(e) => set('clientId', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Scopes" hint="Space or comma separated.">
              <input value={draft.scopes} onChange={(e) => set('scopes', e.target.value)} placeholder="openid profile" className={inputCls} />
            </Field>
            <Field label="External auth URL" hint="Where clients send the user to sign in.">
              <input value={draft.externalAuthUrl} onChange={(e) => set('externalAuthUrl', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Target token">
              <select
                value={draft.targetToken}
                onChange={(e) => set('targetToken', e.target.value as JwtTargetToken)}
                className={inputCls}
              >
                <option value="ACCESS">Access token</option>
                <option value="ID">ID token</option>
              </select>
            </Field>
          </div>
        </FormSection>
        <FormSection title="Enrollment from this signer">
          <CheckField
            label="Enroll to certificate"
            checked={draft.enrollToCertEnabled}
            onChange={(v) => set('enrollToCertEnabled', v)}
            hint="A valid token can create an identity that then receives a certificate."
          />
          <CheckField
            label="Enroll to token"
            checked={draft.enrollToTokenEnabled}
            onChange={(v) => set('enrollToTokenEnabled', v)}
            hint="A valid token can create an identity that keeps signing in with tokens."
          />
          {(draft.enrollToCertEnabled || draft.enrollToTokenEnabled) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Name claim selector" hint="The claim that names the new identity.">
                <input
                  value={draft.enrollNameClaimsSelector}
                  onChange={(e) => set('enrollNameClaimsSelector', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Attribute claim selector" hint="The claim that lists its role attributes.">
                <input
                  value={draft.enrollAttributeClaimsSelector}
                  onChange={(e) => set('enrollAttributeClaimsSelector', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Auth policy for new identities">
                <select
                  value={draft.enrollAuthPolicyId}
                  onChange={(e) => set('enrollAuthPolicyId', e.target.value)}
                  className={inputCls}
                >
                  <option value="">Controller default</option>
                  {authPolicies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </FormSection>
        <ErrorList errors={errors} />
        <FormActions onCancel={onClose} submitLabel={editing ? 'Save changes' : 'Create signer'} busy={busy} />
      </form>
    </ModalDialog>
  );
};
