import React, { Dispatch, SetStateAction, useState } from 'react';
import { AlertTriangle, ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import type { AcModel } from './access-canvas.logic';
import type { BoardFilters, Clip } from './canvas-board.logic';
import { plural } from './canvas-page.shared';
import { FilterPopover } from './FilterPopover';

/** Layout ▾ menu: arrange, export and import card positions. */
const LayoutMenu: React.FC<{
  onArrange: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}> = ({ onArrange, onExport, onImport }) => {
  const [open, setOpen] = useState(false);
  const item =
    'w-full text-left px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] hover:border-[var(--ac-muted)] cursor-pointer font-medium';
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-xs font-medium cursor-pointer hover:border-[var(--ac-muted)]"
      >
        <span>Layout</span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--ac-muted)]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-30 w-64 p-3 rounded-xl bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-2xl space-y-2 text-xs">
            <p className="text-[11px] text-[var(--ac-muted)] m-0">
              Card positions are saved in your browser per controller and never alter access policies.
            </p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onArrange();
              }}
              className={item}
            >
              Arrange automatically
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onExport();
              }}
              className={item}
            >
              Export layout (.json)…
            </button>
            <label className={`block ${item}`}>
              Import layout…
              <input
                type="file"
                accept="application/json,.json"
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  ev.target.value = '';
                  setOpen(false);
                  if (file) onImport(file);
                }}
                className="hidden"
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
};

/** Search, filters, problem count, clipboard chip, layout menu and refresh. */
export const CanvasToolbar: React.FC<{
  draft: AcModel | null;
  filters: BoardFilters;
  setFilters: Dispatch<SetStateAction<BoardFilters>>;
  filtersActive: boolean;
  onClearFilters: () => void;
  searchMatches: number;
  onRevealFirstMatch: () => void;
  problemTotal: number;
  onOpenProblems: () => void;
  clip: Clip | null;
  onClearClip: () => void;
  onArrange: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onRefresh: () => void;
  busy: boolean;
}> = (p) => (
  <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Canvas filters">
    <div className="relative flex items-center min-w-56 flex-1 max-w-xs">
      <Search className="w-3.5 h-3.5 text-[var(--ac-muted)] absolute left-3 pointer-events-none" />
      <input
        type="search"
        placeholder="Filter by name, e.g. devbox or crm"
        value={p.filters.search}
        onChange={(e) => p.setFilters((prev) => ({ ...prev, search: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') p.onRevealFirstMatch();
        }}
        className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-xs"
      />
      {p.filters.search.trim() && (
        <span className="ml-2 text-xs text-[var(--ac-muted)] whitespace-nowrap">
          {plural(p.searchMatches, 'match', 'matches')}
        </span>
      )}
    </div>

    <FilterPopover
      draft={p.draft}
      filters={p.filters}
      setFilters={p.setFilters}
      filtersActive={p.filtersActive}
      onClear={p.onClearFilters}
    />

    {(p.problemTotal > 0 || p.filters.problemsOnly) && (
      <button
        type="button"
        onClick={p.onOpenProblems}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer ${
          p.filters.problemsOnly
            ? 'bg-[var(--ac-bad)] border-[var(--ac-bad)] text-white'
            : 'bg-[var(--ac-bad-soft)] border-[var(--ac-bad)]/40 text-[var(--ac-bad)]'
        }`}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>
          {p.problemTotal === 1 ? '1 item needs attention' : `${p.problemTotal} items need attention`}
          {p.filters.problemsOnly ? ' · showing only these' : ''}
        </span>
      </button>
    )}

    {p.filtersActive && (
      <button type="button" onClick={p.onClearFilters} className="text-xs text-[var(--ac-dial)] underline cursor-pointer">
        Clear filters
      </button>
    )}

    <div className="flex-1" />

    {p.clip && (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-dashed border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-[var(--ac-dial)] text-xs">
        <span>
          {p.clip.mode === 'cut' ? 'Cut' : 'Copied'}:{' '}
          {p.clip.items.length === 1 ? p.clip.items[0].name : `${p.clip.items.length} items`}
        </span>
        <button type="button" onClick={p.onClearClip} aria-label="Clear clipboard" className="hover:opacity-75 cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    )}

    <LayoutMenu onArrange={p.onArrange} onExport={p.onExport} onImport={p.onImport} />

    <button
      type="button"
      onClick={p.onRefresh}
      disabled={p.busy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-xs font-medium cursor-pointer hover:border-[var(--ac-muted)]"
    >
      <RefreshCw className="w-3.5 h-3.5" />
      <span>Refresh</span>
    </button>
  </div>
);
