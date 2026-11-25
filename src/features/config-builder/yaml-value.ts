// Types and narrowing helpers for parsed YAML documents. Config files are user-supplied, so nothing
// about their shape is assumed: every read goes through `isObj` / `get` / `str` / `num` instead.

/** A value produced by parsing YAML with the core schema (no timestamps, no custom tags). */
export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;

/** A YAML mapping. `undefined` marks a key to leave out when the document is written. */
export interface YamlMap {
  [key: string]: YamlValue | undefined;
}

/** True for a mapping (not null, not a list). */
export const isObj = (v: unknown): v is YamlMap => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The value when it is a mapping, otherwise an empty one. */
export const asMap = (v: unknown): YamlMap => (isObj(v) ? v : {});

/** The value when it is a list, otherwise an empty one. */
export const asList = (v: YamlValue | undefined): YamlValue[] => (Array.isArray(v) ? v : []);

/** Follows `path` through nested mappings; undefined as soon as a step is not a mapping. */
export function get(v: YamlValue | undefined, ...path: string[]): YamlValue | undefined {
  let cur = v;
  for (const key of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** The value as a string, or `def` when it is missing or null. */
export const str = (v: YamlValue | undefined, def = ''): string => (v === undefined || v === null ? def : String(v));

/** A deep copy of a mapping; parsed YAML holds only plain data. */
export const cloneMap = (m: YamlMap): YamlMap => structuredClone(m);
