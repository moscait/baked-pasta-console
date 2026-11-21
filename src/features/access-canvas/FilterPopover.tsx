import React, { Dispatch, SetStateAction, useMemo, useState } from 'react';
import { Check, ChevronDown, Filter } from 'lucide-react';
import { AcKind, AcModel, KIND_LABEL, entitiesOf } from './access-canvas.logic';
import type { BoardFilters } from './canvas-board.logic';
import { KINDS } from './canvas-page.shared';

/** Every role attribute in the draft, with how many entities carry it and of which kinds. */
function attributeIndex(draft: AcModel | null, query: string) {
  if (!draft) return [];
  const map = new Map<string, { count: number; kinds: Set<AcKind> }>();
  for (const k of KINDS) {
    for (const e of entitiesOf(draft, k)) {
      for (const a of e.attrs) {
        if (!map.has(a)) map.set(a, { count: 0, kinds: new Set() });
        const v = map.get(a)!;
        v.count++;
        v.kinds.add(k);
      }
    }
  }
  const q = query.trim().toLowerCase().replace(/^#/, '');
  return [...map.entries()]
    .filter(([a]) => !q || a.toLowerCase().includes(q))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([attr, v]) => ({
      attr,
      count: v.count,
      kinds: [...v.kinds].map((k) => KIND_LABEL[k][1]).join(', '),
    }));
}

/** "Filters" button with the entity-kind and role-attribute filter popover. */
export const FilterPopover: React.FC<{
  draft: AcModel | null;
  filters: BoardFilters;
  setFilters: Dispatch<SetStateAction<BoardFilters>>;
  filtersActive: boolean;
  onClear: () => void;
}> = ({ draft, filters, setFilters, filtersActive, onClear }) => {
  const [open, setOpen] = useState(false);
  const [attrQuery, setAttrQuery] = useState('');
  const allAttrs = useMemo(() => attributeIndex(draft, attrQuery), [draft, attrQuery]);
  const narrowCount = KINDS.filter((k) => !filters.types[k]).length + filters.attrs.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-xs font-medium cursor-pointer hover:border-[var(--ac-muted)]"
      >
        <Filter className="w-3.5 h-3.5 text-[var(--ac-muted)]" />
        <span>Filters</span>
        {narrowCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-full bg-[var(--ac-dial)] text-white text-[10px] font-bold">
            {narrowCount}
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-[var(--ac-muted)]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-30 w-80 p-3.5 rounded-xl bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-2xl space-y-3 text-xs">
            <div className="space-y-1.5">
              <div className="font-semibold">Show Entity Kinds</div>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => {
                  const on = filters.types[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          types: { ...prev.types, [k]: !prev.types[k] },
                        }))
                      }
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border cursor-pointer capitalize ${
                        on
                          ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-[var(--ac-ink)] font-medium'
                          : 'border-[var(--ac-line)] text-[var(--ac-muted)]'
                      }`}
                    >
                      <Check className={`w-3 h-3 ${on ? 'opacity-100' : 'opacity-0'}`} />
                      <span>{KIND_LABEL[k][1]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="font-semibold">Role Attributes</div>
              <input
                type="search"
                placeholder="Find an attribute…"
                value={attrQuery}
                onChange={(e) => setAttrQuery(e.target.value)}
                className="w-full px-2.5 py-1 rounded-md border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-xs"
              />
              <div className="max-h-52 overflow-y-auto space-y-0.5">
                {allAttrs.map((a) => {
                  const on = filters.attrs.includes(a.attr);
                  return (
                    <button
                      key={a.attr}
                      type="button"
                      onClick={() => {
                        const s = new Set(filters.attrs);
                        if (s.has(a.attr)) s.delete(a.attr);
                        else s.add(a.attr);
                        setFilters((prev) => ({ ...prev, attrs: [...s] }));
                      }}
                      className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-[var(--ac-surface-2)] text-left cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <span
                          className={`w-3.5 h-3.5 rounded inline-grid place-items-center border ${
                            on ? 'bg-[var(--ac-dial)] border-[var(--ac-dial)] text-white' : 'border-[var(--ac-line)]'
                          }`}
                        >
                          {on ? '✓' : ''}
                        </span>
                        #{a.attr}
                      </span>
                      <span className="text-[11px] text-[var(--ac-muted)]">
                        {a.count} · {a.kinds}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {filtersActive && (
              <button type="button" onClick={onClear} className="text-xs text-[var(--ac-dial)] underline cursor-pointer">
                Clear all filters
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
