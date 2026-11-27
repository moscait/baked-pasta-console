import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultConfig, fromYaml, toYaml, validate } from './controller-config.model';
import {
  defaultRouterConfig,
  detectKind,
  parseConfigText,
  routerFromDocument,
  routerToYaml,
  validateRouter,
} from './router-config.model';

const errors = <T extends { level: string }>(issues: T[]) => issues.filter((i) => i.level === 'error');

describe('controller config (ported from ZAC)', () => {
  it('has no validation errors with defaults', () => {
    expect(errors(validate(defaultConfig()))).toEqual([]);
  });

  it('emits YAML that parses as a v3 controller config', () => {
    const doc = parse(toYaml(defaultConfig()));
    expect(doc.v).toBe(3);
    expect(doc.ctrl.listener).toBe('tls:0.0.0.0:6262');
    expect(detectKind(doc)).toBe('controller');
  });

  it('round-trips through YAML', () => {
    const cfg = defaultConfig();
    cfg.ctrl.advertiseAddress = 'tls:ctrl.example.com:6262';
    cfg.edge.apiAddress = 'ctrl.example.com:1280';
    const back = fromYaml(toYaml(cfg)).cfg;
    expect(back.ctrl.advertiseAddress).toBe('tls:ctrl.example.com:6262');
    expect(back.edge.apiAddress).toBe('ctrl.example.com:1280');
    expect(back.web[0].apis['edge-management']).toBe(true);
  });

  it('keeps keys the form does not manage', () => {
    const text = `${toYaml(defaultConfig())}\ncustomPlugin:\n  enabled: true\n`;
    expect(parse(toYaml(fromYaml(text).cfg)).customPlugin).toEqual({ enabled: true });
  });

  it('flags a malformed listener', () => {
    const cfg = defaultConfig();
    cfg.ctrl.listener = 'not-an-endpoint';
    expect(errors(validate(cfg)).some((i) => i.section === 'ctrl')).toBe(true);
  });
});

describe('router config (ported from ZAC)', () => {
  it('has no validation errors with defaults', () => {
    expect(errors(validateRouter(defaultRouterConfig()))).toEqual([]);
  });

  it('is detected as a router and round-trips', () => {
    const cfg = defaultRouterConfig();
    cfg.ctrl.endpoints = ['tls:ctrl-a.example.com:6262'];
    const doc = parseConfigText(routerToYaml(cfg));
    expect(detectKind(doc)).toBe('router');
    expect(routerFromDocument(doc).cfg.ctrl.endpoints).toEqual(['tls:ctrl-a.example.com:6262']);
  });

  it('cannot decide on a document with neither side’s keys', () => {
    expect(detectKind({ v: 3 })).toBe('unknown');
    expect(detectKind('text')).toBe('unknown');
  });
});
