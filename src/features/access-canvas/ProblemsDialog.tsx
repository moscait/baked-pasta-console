import React, { useMemo, useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { plural } from './canvas-page.shared';
import { ProbSort, ProblemFilter, ProblemRow, ProblemSortState, filterProblemRows } from './problem-rows';

const SORT_COLUMNS: { col: ProbSort; label: string }[] = [
  { col: 'type', label: 'Type' },
  { col: 'name', label: 'Name' },
  { col: 'problem', label: 'Problem' },
];

/** Audit of everything that keeps connections from completing, with Locate / Open actions. */
export const ProblemsDialog: React.FC<{
  rows: ProblemRow[];
  total: number;
  problemsOnly: boolean;
  onClose: () => void;
  onLocate: (row: ProblemRow) => void;
  onOpen: (row: ProblemRow) => void;
  onToggleProblemsOnly: () => void;
}> = ({ rows, total, problemsOnly, onClose, onLocate, onOpen, onToggleProblemsOnly }) => {
  const [pf, setPf] = useState<ProblemFilter>({ q: '', kind: 'all', type: '' });
  const [sort, setSort] = useState<ProblemSortState>({ col: 'type', dir: 1 });
  const shown = useMemo(() => filterProblemRows(rows, pf, sort), [rows, pf, sort]);

  return (
    <ModalDialog
      open
      onClose={onClose}
      wide
      title={
        <span>
          {total === 1 ? '1 item needs attention' : `${total} items need attention`}
          <span className="text-xs font-normal text-[var(--ac-muted)] ml-2">({plural(rows.length, 'problem', 'problems')})</span>
        </span>
      }
    >
      <div className="space-y-4 text-xs">
        <p className="text-[var(--ac-muted)] m-0">Issues across the network that prevent zero-trust connections from completing.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Filter by name or problem…"
            value={pf.q}
            onChange={(e) => setPf({ ...pf, q: e.target.value })}
            className="flex-1 min-w-48 px-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)]"
          />
          <div className="flex flex-wrap gap-1">
            {(['all', 'identity', 'service', 'router', 'policy'] as const).map((k) => {
              const cnt = k === 'all' ? rows.length : rows.filter((r) => r.kind === k).length;
              if (k !== 'all' && cnt === 0) return null;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPf({ ...pf, kind: k })}
                  className={`px-2.5 py-1 rounded-full border capitalize cursor-pointer ${
                    pf.kind === k
                      ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] font-semibold'
                      : 'border-[var(--ac-line)] text-[var(--ac-muted)]'
                  }`}
                >
                  {k} ({cnt})
                </button>
              );
            })}
          </div>
        </div>

        <div className="bpc-table-region rounded-xl border border-[var(--ac-line)] max-h-96">
          <table className="bpc-table">
            <thead>
              <tr>
                {SORT_COLUMNS.map(({ col, label }) => (
                  <th
                    key={col}
                    scope="col"
                    aria-sort={sort.col === col ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => setSort((prev) => ({ col, dir: prev.col === col ? (-prev.dir as 1 | -1) : 1 }))}
                    >
                      {label} {sort.col === col ? (sort.dir === 1 ? '▲' : '▼') : ''}
                    </button>
                  </th>
                ))}
                <th scope="col">What to do</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="px-2 py-0.5 rounded-full bg-[var(--ac-surface-2)] font-semibold text-[11px]">{r.typeLabel}</span>
                  </td>
                  <td className="font-medium font-mono">{r.name}</td>
                  <td>
                    <div className="font-semibold text-[var(--ac-bad)]">{r.problem}</div>
                    {r.detail && <div className="text-[var(--ac-muted)]">{r.detail}</div>}
                  </td>
                  <td className="text-[var(--ac-muted)] max-w-xs">{r.hint}</td>
                  <td className="whitespace-nowrap space-x-1">
                    <button
                      type="button"
                      onClick={() => onLocate(r)}
                      className="px-2.5 py-1 rounded border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer hover:border-[var(--ac-muted)]"
                    >
                      Locate
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen(r)}
                      className="px-2.5 py-1 rounded border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer hover:border-[var(--ac-muted)]"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between pt-2">
          <button
            type="button"
            onClick={onToggleProblemsOnly}
            className="px-3.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] cursor-pointer"
          >
            {problemsOnly ? 'Show everything on canvas' : 'Show only these on canvas'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
