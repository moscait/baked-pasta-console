import { describe, expect, it } from 'vitest';
import { formatJsonObject, isHttpUrl, parseJsonObject, parseWholeNumber, splitList } from './form-values';

describe('parseJsonObject', () => {
  it('treats blank text as an empty map', () => {
    expect(parseJsonObject('  ')).toEqual({ ok: true, value: {} });
  });

  it('accepts nested objects', () => {
    expect(parseJsonObject('{"a": {"b": [1, true, null]}}')).toEqual({ ok: true, value: { a: { b: [1, true, null] } } });
  });

  it.each(['[1]', '"x"', '3', 'null'])('rejects the non-object %s', (text) => {
    const r = parseJsonObject(text);
    expect(r.ok).toBe(false);
  });

  it('reports syntax errors', () => {
    const r = parseJsonObject('{"a": }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Not valid JSON/);
  });

  it('round-trips through formatJsonObject', () => {
    const value = { region: 'us-east', tier: 2 };
    expect(parseJsonObject(formatJsonObject(value))).toEqual({ ok: true, value });
    expect(formatJsonObject({})).toBe('');
    expect(formatJsonObject(undefined)).toBe('');
  });
});

describe('splitList', () => {
  it('splits on commas and whitespace, drops # and duplicates', () => {
    expect(splitList(' sales, #ops\nsales  dev ')).toEqual(['sales', 'ops', 'dev']);
    expect(splitList('')).toEqual([]);
  });
});

describe('parseWholeNumber', () => {
  it('uses the fallback for blank text', () => {
    expect(parseWholeNumber(' ', 'Cost', { fallback: 0 })).toEqual({ ok: true, value: 0 });
  });

  it('enforces whole numbers and range', () => {
    expect(parseWholeNumber('12', 'Cost', { max: 65535 })).toEqual({ ok: true, value: 12 });
    expect(parseWholeNumber('1.5', 'Cost').ok).toBe(false);
    expect(parseWholeNumber('-1', 'Cost').ok).toBe(false);
    expect(parseWholeNumber('70000', 'Cost', { max: 65535 })).toEqual({
      ok: false,
      error: 'Cost must be between 0 and 65535.',
    });
    expect(parseWholeNumber('', 'Cost').ok).toBe(false);
  });
});

describe('isHttpUrl', () => {
  it('accepts only absolute http(s) URLs', () => {
    expect(isHttpUrl('https://idp.example.com/.well-known/jwks.json')).toBe(true);
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('idp.example.com')).toBe(false);
  });
});
