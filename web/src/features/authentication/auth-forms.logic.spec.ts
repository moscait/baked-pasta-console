import { describe, expect, it } from 'vitest';
import {
  authPolicyBody,
  authPolicyDraft,
  caBody,
  caDraft,
  jwtSignerBody,
  jwtSignerDraft,
} from './auth-forms.logic';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ\n-----END CERTIFICATE-----';

describe('caBody', () => {
  it('requires a PEM certificate only when creating', () => {
    const d = { ...caDraft(), name: 'corp-ca' };
    expect(caBody(d, true)).toEqual({ ok: false, errors: ['Paste the CA certificate in PEM format.'] });
    const edit = caBody(d, false);
    expect(edit.ok && 'certPem' in edit.body).toBe(false);
  });

  it('builds a create body with roles and no claim by default', () => {
    const r = caBody({ ...caDraft(), name: ' corp-ca ', certPem: PEM, identityRoles: '#laptops, byod' }, true);
    expect(r).toMatchObject({
      ok: true,
      body: {
        name: 'corp-ca',
        certPem: PEM,
        identityRoles: ['laptops', 'byod'],
        identityNameFormat: '[caName]-[commonName]',
        externalIdClaim: null,
      },
    });
  });

  it('validates and builds the external ID claim', () => {
    const base = { ...caDraft(), name: 'ca', useExternalIdClaim: true, claimMatcher: 'PREFIX' as const };
    const bad = caBody({ ...base, claimParser: 'SPLIT', claimIndex: 'x' }, false);
    expect(bad.ok ? [] : bad.errors).toEqual([
      'Matcher PREFIX needs match criteria.',
      'The SPLIT parser needs a separator.',
      'Claim index must be a whole number.',
    ]);
    const good = caBody({ ...base, claimLocation: 'SAN_URI', claimMatcherCriteria: 'spiffe://', claimIndex: '1' }, false);
    expect(good.ok && good.body.externalIdClaim).toEqual({
      location: 'SAN_URI',
      matcher: 'PREFIX',
      matcherCriteria: 'spiffe://',
      parser: 'NONE',
      parserCriteria: '',
      index: 1,
    });
  });

  it('round-trips an existing CA through the draft', () => {
    const ca = {
      id: 'ca1',
      name: 'ca',
      identityRoles: ['a'],
      identityNameFormat: '[commonName]',
      isAutoCaEnrollmentEnabled: false,
      isOttCaEnrollmentEnabled: true,
      isAuthEnabled: true,
      externalIdClaim: {
        location: 'SAN_EMAIL' as const,
        matcher: 'SUFFIX' as const,
        matcherCriteria: '@corp.example',
        parser: 'NONE' as const,
        parserCriteria: '',
        index: 0,
      },
    };
    const r = caBody(caDraft(ca), false);
    expect(r).toEqual({
      ok: true,
      body: {
        name: 'ca',
        identityRoles: ['a'],
        identityNameFormat: '[commonName]',
        isAutoCaEnrollmentEnabled: false,
        isOttCaEnrollmentEnabled: true,
        isAuthEnabled: true,
        externalIdClaim: ca.externalIdClaim,
      },
    });
  });
});

describe('authPolicyBody', () => {
  it('defaults to every method allowed with the controller minimum password length', () => {
    const r = authPolicyBody({ ...authPolicyDraft(), name: 'contractors' });
    expect(r).toMatchObject({
      ok: true,
      body: {
        primary: { cert: { allowed: true }, updb: { allowed: true, minPasswordLength: 5 }, extJwt: { allowed: true } },
        secondary: { requireTotp: false, requireExtJwtSigner: null },
      },
    });
  });

  it('refuses a policy nobody can sign in with', () => {
    const r = authPolicyBody({ ...authPolicyDraft(), name: 'x', certAllowed: false, updbAllowed: false, extJwtAllowed: false });
    expect(r.ok).toBe(false);
  });

  it('rejects a password minimum below 5 and bad numbers', () => {
    const r = authPolicyBody({ ...authPolicyDraft(), name: 'x', minPasswordLength: '4', maxAttempts: 'many' });
    expect(r.ok ? [] : r.errors).toEqual([
      'Minimum password length must be between 5 and 1024.',
      'Max attempts must be a whole number.',
    ]);
  });

  it('clears allowed signers when external JWT is turned off', () => {
    const r = authPolicyBody({ ...authPolicyDraft(), name: 'x', extJwtAllowed: false, allowedSigners: ['s1'] });
    expect(r.ok && r.body.primary.extJwt).toEqual({ allowed: false, allowedSigners: [] });
  });
});

describe('jwtSignerBody', () => {
  const base = { ...jwtSignerDraft(), name: 'okta', issuer: 'https://corp.okta.com', audience: 'openziti' };

  it('requires a JWKS URL or a PEM certificate, matching the chosen key source', () => {
    expect(jwtSignerBody(base).ok).toBe(false);
    expect(jwtSignerBody({ ...base, keySource: 'cert' }).ok).toBe(false);
    const jwks = jwtSignerBody({ ...base, jwksEndpoint: 'https://corp.okta.com/keys', kid: 'ignored', certPem: PEM });
    expect(jwks.ok && [jwks.body.jwksEndpoint, jwks.body.certPem, jwks.body.kid]).toEqual([
      'https://corp.okta.com/keys',
      null,
      null,
    ]);
    const cert = jwtSignerBody({ ...base, keySource: 'cert', certPem: PEM, kid: ' k1 ' });
    expect(cert.ok && [cert.body.jwksEndpoint, cert.body.kid]).toEqual([null, 'k1']);
  });

  it('sends cleared optional fields as null and splits scopes', () => {
    const r = jwtSignerBody({ ...base, jwksEndpoint: 'https://x/keys', scopes: 'openid, profile email' });
    expect(r.ok && [r.body.clientId, r.body.externalAuthUrl, r.body.scopes]).toEqual([
      null,
      null,
      ['openid', 'profile', 'email'],
    ]);
  });

  it('keeps an existing signer unchanged through the draft', () => {
    const signer = {
      id: 's1',
      name: 'okta',
      issuer: 'https://corp.okta.com',
      audience: 'openziti',
      jwksEndpoint: 'https://corp.okta.com/keys',
      enabled: false,
      claimsProperty: 'email',
      useExternalId: true,
      clientId: 'abc',
      scopes: ['openid'],
      externalAuthUrl: 'https://corp.okta.com/auth',
      targetToken: 'ID' as const,
    };
    const { id: _id, ...fields } = signer;
    expect(jwtSignerBody(jwtSignerDraft(signer))).toMatchObject({ ok: true, body: fields });
  });
});
