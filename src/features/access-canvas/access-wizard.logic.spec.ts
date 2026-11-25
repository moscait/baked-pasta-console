import { describe, it, expect } from 'vitest';
import { AcModel, applyOps, clone, dialFor, hostsFor } from './access-canvas.logic';
import { entityProblems } from './canvas-board.logic';
import { findOp, isOp } from './test-helpers';
import { blankInput, detectConflicts, plan, slugify, suggest, suggestAvailableServiceName, validate } from './access-wizard.logic';

function model(withRouterPolicies = true): AcModel {
  return {
    identities: [
      { id: 'i1', name: 'dev-macbook-air', attrs: ['ssh-users'], enrolled: true, online: true, isAdmin: false },
      { id: 'i2', name: 'dev-macbook-pro', attrs: [], enrolled: false, online: false, isAdmin: false },
      { id: 'adm', name: 'admin', attrs: [], enrolled: true, online: false, isAdmin: true },
    ],
    services: [{ id: 's1', name: 'devbox-ssh', attrs: ['ssh'], configs: [] }],
    routers: [{ id: 'r1', name: 'router-instance-1', attrs: [], online: true }],
    servicePolicies: [],
    erPolicies: withRouterPolicies
      ? [{ id: 'e1', name: 'all-endpoints-all-routers', semantic: 'AnyOf', identityRoles: ['#all'], routerRoles: ['#all'] }]
      : [],
    serps: withRouterPolicies
      ? [{ id: 'sp1', name: 'all-services-all-routers', semantic: 'AnyOf', serviceRoles: ['#all'], routerRoles: ['#all'] }]
      : [],
  } as AcModel;
}

const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe('access-wizard.logic', () => {
  it('suggests idiomatic names from the system and service type', () => {
    const s = suggest('postgres', 'Billing DB');
    expect(s.serviceName).toBe('billing-db-postgres');
    expect(s.interceptHost).toBe('billing-db.ziti');
    expect(s.interceptPort).toBe(5432);
    expect(s.hostAddress).toBe('127.0.0.1');
    expect(s.hostName).toBe('billing-db');
    expect(s.hostsAttr).toBe('billing-db-postgres-hosts');
    expect(s.usersAttr).toBe('dbas');

    const ollama = suggest('ollama', 'GPU Box');
    expect(ollama.serviceName).toBe('gpu-box-ollama');
    expect(ollama.interceptHost).toBe('gpu-box.ziti.internal');
    expect(ollama.interceptPort).toBe(11434);
    expect(ollama.hostAddress).toBe('127.0.0.1');
    expect(ollama.hostPort).toBe(11434);
    expect(ollama.usersAttr).toBe('developers');

    const alreadySuffixed = suggest('ollama', 'dev-mbp-ollama');
    expect(alreadySuffixed.serviceName).toBe('dev-mbp-ollama');
    expect(alreadySuffixed.interceptHost).toBe('dev-mbp-ollama.ziti.internal');
    expect(alreadySuffixed.hostsAttr).toBe('dev-mbp-ollama-hosts');
  });

  it('slugifies names the OpenZiti way', () => {
    expect(slugify('  #My Team ')).toBe('my-team');
    expect(slugify('crm.prod')).toBe('crm.prod');
  });

  it('rejects names that already exist and bad ports', () => {
    const w = blankInput('ssh', 'devbox');
    w.interceptPort = 70000;
    const fields = validate(model(), w).map((c) => c.field);
    expect(fields).toContain('serviceName');
    expect(fields).toContain('interceptPort');
    w.serviceName = 'devbox-ssh2';
    w.interceptPort = 22;
    expect(validate(model(), w).map((c) => c.field)).toEqual(['newUserName']);
    w.newUserName = 'jdoe-laptop';
    expect(validate(model(), w)).toEqual([]);
  });

  it('refuses a service nobody could use', () => {
    const w = blankInput('postgres', 'billing-db');
    w.userMode = 'existing';
    w.usersAttr = 'dbas';
    expect(validate(model(), w).map((c) => c.field)).toEqual(['userIds']);
    w.userIds = ['i2'];
    expect(validate(model(), w)).toEqual([]);
    w.userIds = [];
    w.usersAttr = 'ssh-users';
    expect(validate(model(), w)).toEqual([]);
  });

  it('creates two identities by default: the host and the user device', () => {
    const w = blankInput('postgres', 'billing-db');
    w.newUserName = 'jdoe-laptop';
    const p = plan(model(), w, ids());
    expect(p.created).toEqual(['billing-db', 'jdoe-laptop']);
    expect(p.updated).toEqual([]);
  });

  it('builds configs, service, hosting identity, users and policies that give access end to end', () => {
    const m = model();
    const w = blankInput('https', 'crm');
    w.usersAttr = 'employees';
    w.newUserName = 'jdoe-laptop';
    const p = plan(m, w, ids());
    const kinds = p.ops.map((o) => o.op);
    expect(kinds).toEqual([
      'createConfig',
      'createConfig',
      'createService',
      'createIdentity',
      'createIdentity',
      'createPolicy',
      'createPolicy',
    ]);
    const w2 = { ...w, serviceName: 'crm-https-2', userMode: 'existing' as const, userIds: ['i2'] };
    const p2 = plan(m, w2, ids());
    expect(p2.updated).toEqual(['dev-macbook-pro']);
    const after2 = applyOps(clone(m), p2.ops);
    const svc2 = after2.services.find((s) => s.name === 'crm-https-2')!;
    expect(dialFor(after2, after2.identities.find((i) => i.name === 'dev-macbook-pro')!, svc2).length).toBe(1);
    const after = applyOps(clone(m), p.ops);
    const svc = after.services.find((s) => s.name === 'crm-https')!;
    expect(svc.attrs).toEqual(['crm-https']);
    const host = after.identities.find((i) => i.name === 'crm')!;
    expect(hostsFor(after, svc).map((h) => h.name)).toEqual(['crm']);
    expect(host.attrs).toEqual(['crm-https-hosts']);
    for (const name of ['jdoe-laptop']) {
      const u = after.identities.find((i) => i.name === name)!;
      expect(dialFor(after, u, svc).map((x) => x.name)).toEqual(['crm-https-dial']);
    }
    const cfg = findOp(p.ops, 'createConfig', (o) => o.config.type === 'intercept.v1');
    expect(cfg.config.data).toEqual({
      protocols: ['tcp'],
      addresses: ['crm.ziti'],
      portRanges: [{ low: 443, high: 443 }],
    });
    expect(p.next.length).toBe(3);
  });

  it('adds router policies only when nothing covers the new pieces', () => {
    const p = plan(model(false), blankInput('ssh', 'web-01'), ids());
    const names = p.ops.filter(isOp('createSerp', 'createErPolicy')).map((o) => o.policy.name);
    expect(names).toEqual(['web-01-ssh-routers', 'web-01-ssh-identities-routers']);
    const covered = plan(model(true), blankInput('ssh', 'web-01'), ids());
    expect(covered.ops.some((o) => o.op === 'createSerp' || o.op === 'createErPolicy')).toBe(false);
  });

  it('reuses an existing hosting identity by giving it the hosts attribute', () => {
    const w = blankInput('rdp', 'desk-7');
    w.hostMode = 'existing';
    w.hostId = 'i2';
    const p = plan(model(), w, ids());
    expect(p.ops.some((o) => o.op === 'createIdentity')).toBe(false);
    expect(p.ops).toContainEqual({ op: 'addAttr', kind: 'identity', id: 'i2', attr: 'desk-7-rdp-hosts' });
  });

  it('allows the same existing hosting identity to also dial the service without service problems', () => {
    const w = blankInput('ollama', 'dev-mbp');
    w.hostMode = 'existing';
    w.hostId = 'i1';
    w.userMode = 'existing';
    w.userIds = ['i1'];
    w.usersAttr = 'developers';
    expect(validate(model(), w)).toEqual([]);

    const p = plan(model(), w, ids());
    const after = applyOps(clone(model()), p.ops);
    const svc = after.services.find((s) => s.name === 'dev-mbp-ollama')!;
    expect(hostsFor(after, svc).map((h) => h.id)).toEqual(['i1']);
    expect(dialFor(after, after.identities.find((i) => i.id === 'i1')!, svc).length).toBe(1);
    const probs = entityProblems(after, 'service', svc.id);
    expect(probs).not.toContain('Not hosted');
    expect(probs).not.toContain('Nobody can use it');
  });

  it('allows creating a single new identity that both hosts and uses the service', () => {
    const w = blankInput('ollama', 'dev-mbp');
    w.hostMode = 'new';
    w.hostName = 'dev-mbp';
    w.userMode = 'new';
    w.newUserName = 'dev-mbp';
    expect(validate(model(), w)).toEqual([]);

    const p = plan(model(), w, ids());
    expect(p.created).toEqual(['dev-mbp']);
    const after = applyOps(clone(model()), p.ops);
    const svc = after.services.find((s) => s.name === 'dev-mbp-ollama')!;
    const ident = after.identities.find((i) => i.name === 'dev-mbp')!;
    expect(ident.attrs).toEqual(['dev-mbp-ollama-hosts', 'developers']);
    expect(hostsFor(after, svc).map((h) => h.name)).toEqual(['dev-mbp']);
    expect(dialFor(after, ident, svc).length).toBe(1);
    const probs = entityProblems(after, 'service', svc.id);
    expect(probs).not.toContain('Not hosted');
    expect(probs).not.toContain('Nobody can use it');
  });

  it('detects leftover configs and policies even when the service does not exist, and suggests a clean name', () => {
    const m = model();
    m.configs = [
      { id: 'cfg-1', name: 'gpu-ollama.intercept.v1' },
      { id: 'cfg-2', name: 'gpu-ollama.host.v1' },
    ];
    m.servicePolicies = [
      {
        id: 'sp-1',
        name: 'gpu-ollama-bind',
        type: 'Bind',
        semantic: 'AnyOf',
        identityRoles: ['#other'],
        serviceRoles: ['#gpu-ollama'],
        posture: [],
      },
    ];
    const w = blankInput('ollama', 'gpu');
    w.newUserName = 'dev-macbook-air';

    const conflicts = detectConflicts(m, w);
    expect(conflicts.map((c) => `${c.kind}:${c.name}`)).toEqual([
      'config:gpu-ollama.intercept.v1',
      'config:gpu-ollama.host.v1',
      'policy:gpu-ollama-bind',
      'identity:dev-macbook-air',
    ]);
    const svcErr = validate(m, w).find((c) => c.field === 'serviceName');
    expect(svcErr?.message).toContain('gpu-ollama.intercept.v1');
    expect(suggestAvailableServiceName(m, 'gpu-ollama')).toBe('gpu-ollama-2');
  });

  it('allows updating and repairing existing service, configs, and policies when reuseExisting is enabled', () => {
    const m = model();
    m.configs = [{ id: 'cfg-ic', name: 'devbox-ssh.intercept.v1' }];
    m.servicePolicies = [
      {
        id: 'sp-bind',
        name: 'devbox-ssh-bind',
        type: 'Bind',
        semantic: 'AnyOf',
        identityRoles: ['#legacy-hosts'],
        serviceRoles: ['#devbox-ssh'],
        posture: [],
      },
    ];
    const w = blankInput('ssh', 'devbox');
    w.hostMode = 'existing';
    w.hostId = 'i1';
    w.userMode = 'existing';
    w.userIds = ['i2'];
    w.reuseExisting = true;

    expect(validate(m, w)).toEqual([]);
    const p = plan(m, w, ids());

    const icOp = findOp(p.ops, 'createConfig', (o) => o.config.name === 'devbox-ssh.intercept.v1');
    const hcOp = findOp(p.ops, 'createConfig', (o) => o.config.name === 'devbox-ssh.host.v1');
    const svcOp = findOp(p.ops, 'createService');
    const bindOp = findOp(p.ops, 'createPolicy', (o) => o.policy.type === 'Bind');
    expect(icOp.config.existingId).toBe('cfg-ic');
    expect(hcOp.config.existingId).toBeUndefined();
    expect(svcOp.service.existingId).toBe('s1');
    expect(svcOp.service.attrs).toEqual(['ssh', 'devbox-ssh']);
    expect(bindOp.policy.existingId).toBe('sp-bind');
    expect(bindOp.policy.identityRoles).toEqual(['#legacy-hosts', '#devbox-ssh-hosts']);
    expect(p.items.find((it) => it.name === 'devbox-ssh')?.existing).toBe(true);

    const after = applyOps(clone(m), p.ops);
    expect(after.services.filter((s) => s.name === 'devbox-ssh')).toHaveLength(1);
    expect(hostsFor(after, after.services.find((s) => s.id === 's1')!).map((h) => h.id)).toEqual(['i1']);
    expect(dialFor(after, after.identities.find((i) => i.id === 'i2')!, after.services.find((s) => s.id === 's1')!).length).toBe(1);
  });
});
