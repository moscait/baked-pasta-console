import { describe, expect, it } from 'vitest';
import type { Config, ConfigType, Service } from '../../services/api-types';
import {
  configTemplate,
  configTypeName,
  describeServiceEndpoint,
  duplicateTypes,
  groupConfigsByType,
  parseConfigData,
  selectConfigForType,
  servicesByConfig,
} from './service-configs';

const types: ConfigType[] = [
  { id: 't-int', name: 'intercept.v1' },
  { id: 't-host', name: 'host.v1' },
  { id: 't-layout', name: 'access-canvas-layout' },
];
const cfg = (id: string, typeId: string, name = id): Config => ({ id, name, configTypeId: typeId, data: {} });
const configs = [
  cfg('host-a', 't-host', 'a.host.v1'),
  cfg('layout', 't-layout', 'access-canvas-layout'),
  cfg('int-b', 't-int', 'b.intercept.v1'),
  cfg('int-a', 't-int', 'a.intercept.v1'),
];

describe('service config rules', () => {
  it('names a config type from the embedded ref, the type list, or the raw id', () => {
    expect(configTypeName({ ...cfg('x', 't-int'), configType: { name: 'intercept.v1' } }, [])).toBe('intercept.v1');
    expect(configTypeName(cfg('x', 't-host'), types)).toBe('host.v1');
    expect(configTypeName(cfg('x', 't-unknown'), types)).toBe('t-unknown');
  });

  it('groups by type with known service types first and unfamiliar types last', () => {
    const groups = groupConfigsByType(configs, types);
    expect(groups.map((g) => [g.typeName, g.known])).toEqual([
      ['intercept.v1', true],
      ['host.v1', true],
      ['access-canvas-layout', false],
    ]);
    expect(groups[0].configs.map((c) => c.name)).toEqual(['a.intercept.v1', 'b.intercept.v1']);
    expect(groups[0].purpose).toMatch(/clients dial/);
  });

  it('keeps at most one config per type and leaves other types and unknown ids alone', () => {
    let sel = ['int-a', 'host-a', 'missing-id'];
    sel = selectConfigForType(sel, 't-int', 'int-b', configs);
    expect(sel.sort()).toEqual(['host-a', 'int-b', 'missing-id']);
    sel = selectConfigForType(sel, 't-host', null, configs);
    expect(sel.sort()).toEqual(['int-b', 'missing-id']);
    expect(duplicateTypes(sel, configs, types)).toEqual([]);
    expect(duplicateTypes(['int-a', 'int-b'], configs, types)).toEqual(['intercept.v1']);
  });

  it('lists which services use each config', () => {
    const services: Service[] = [
      { id: 's1', name: 'crm', configs: ['int-a', 'host-a'] },
      { id: 's2', name: 'erp', configs: ['int-a'] },
      { id: 's3', name: 'bare' },
    ];
    const used = servicesByConfig(services);
    expect(used.get('int-a')!.map((s) => s.name)).toEqual(['crm', 'erp']);
    expect(used.get('host-a')!.map((s) => s.name)).toEqual(['crm']);
    expect(used.has('layout')).toBe(false);
  });

  it('validates config data as a JSON object', () => {
    expect(parseConfigData('{"port": 22}')).toEqual({ data: { port: 22 } });
    expect(parseConfigData('{port: 22}')).toHaveProperty('error');
    expect(parseConfigData('[1,2]')).toEqual({ error: expect.stringMatching(/JSON object/) });
    expect(parseConfigData('null')).toHaveProperty('error');
    expect(JSON.parse(configTemplate('host.v1'))).toMatchObject({ protocol: 'tcp' });
    expect(configTemplate('custom.v9')).toBe('{}');
  });

  it('describes intercept endpoints, forwarding targets, and clickable URLs for services', () => {
    const cfgs: Config[] = [
      {
        id: 'c-ollama-ic',
        name: 'dev-mbp-ollama.intercept.v1',
        configTypeId: 't-int',
        configType: { name: 'intercept.v1' },
        data: { protocols: ['tcp'], addresses: ['dev-mbp-ollama.ziti'], portRanges: [{ low: 11434, high: 11434 }] },
      },
      {
        id: 'c-ollama-hc',
        name: 'dev-mbp-ollama.host.v1',
        configTypeId: 't-host',
        configType: { name: 'host.v1' },
        data: { protocol: 'tcp', address: '127.0.0.1', port: 11434 },
      },
      {
        id: 'c-https-ic',
        name: 'crm.intercept.v1',
        configTypeId: 't-int',
        configType: { name: 'intercept.v1' },
        data: { protocols: ['tcp'], addresses: ['crm.ziti'], portRanges: [{ low: 443, high: 443 }] },
      },
      {
        id: 'c-ssh-ic',
        name: 'devbox-ssh.intercept.v1',
        configTypeId: 't-int',
        configType: { name: 'intercept.v1' },
        data: { protocols: ['tcp'], addresses: ['devbox.ziti'], portRanges: [{ low: 22, high: 22 }] },
      },
    ];

    expect(
      describeServiceEndpoint({ name: 'dev-mbp-ollama', configs: ['c-ollama-ic', 'c-ollama-hc'] }, cfgs),
    ).toEqual({
      interceptDisplay: 'dev-mbp-ollama.ziti:11434',
      hostDisplay: '127.0.0.1:11434',
      url: 'http://dev-mbp-ollama.ziti:11434',
      protocol: 'tcp',
    });

    expect(describeServiceEndpoint({ name: 'crm-https', configs: ['c-https-ic'] }, cfgs)).toEqual({
      interceptDisplay: 'crm.ziti:443',
      hostDisplay: undefined,
      url: 'https://crm.ziti:443',
      protocol: 'tcp',
    });

    expect(describeServiceEndpoint({ name: 'devbox-ssh', configs: ['c-ssh-ic'] }, cfgs)).toEqual({
      interceptDisplay: 'devbox.ziti:22',
      hostDisplay: undefined,
      url: undefined,
      protocol: 'tcp',
    });

    expect(describeServiceEndpoint({ name: 'bare', configs: [] }, cfgs)).toEqual({
      interceptDisplay: undefined,
      hostDisplay: undefined,
      url: undefined,
      protocol: undefined,
    });
  });
});
