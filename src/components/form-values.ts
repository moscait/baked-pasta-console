import type { JsonObject } from '../services/api-types';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Either a request body, or the reasons the form can't be saved yet. */
export type FormOutcome<B> = { ok: true; body: B } | { ok: false; errors: string[] };

/** Builds the body only when there are no errors. */
export const formOutcome = <B>(errors: string[], build: () => B): FormOutcome<B> =>
  errors.length ? { ok: false, errors } : { ok: true, body: build() };

const isPlainObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses the text of a free-form JSON map field (`appData`, `tags`). Blank text is an empty
 * map; anything other than a JSON object (an array, a string, a number) is rejected.
 */
export function parseJsonObject(text: string): ParseResult<JsonObject> {
  if (!text.trim()) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  // JSON.parse only ever yields JSON values, so an object here is a JsonObject.
  if (!isPlainObject(parsed)) return { ok: false, error: 'Must be a JSON object, e.g. { "key": "value" }.' };
  return { ok: true, value: parsed };
}

/** Pretty-prints a map for editing; an empty or missing map becomes blank text. */
export function formatJsonObject(value: object | null | undefined): string {
  return value && Object.keys(value).length ? JSON.stringify(value, null, 2) : '';
}

/** Splits "a, #b  c" into ['a', 'b', 'c']: commas or whitespace, leading `#` dropped, duplicates removed. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\s]+/)) {
    const item = raw.trim().replace(/^#/, '');
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Parses a whole number in [min, max]; blank text gives `fallback`. */
export function parseWholeNumber(
  text: string,
  label: string,
  opts: { min?: number; max?: number; fallback?: number } = {},
): ParseResult<number> {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = opts;
  const t = text.trim();
  if (!t && fallback !== undefined) return { ok: true, value: fallback };
  if (!/^\d+$/.test(t)) return { ok: false, error: `${label} must be a whole number.` };
  const n = Number(t);
  if (n < min || n > max) return { ok: false, error: `${label} must be between ${min} and ${max}.` };
  return { ok: true, value: n };
}

/** A plausible single PEM certificate block; the controller does the real parsing. */
export function looksLikePemCertificate(text: string): boolean {
  return /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.test(text);
}

/** True for an absolute http(s) URL. */
export function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
