import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, Search, Trash2, Edit2 } from 'lucide-react';
import { ModalDialog } from './ModalDialog';
import { csvFileName, downloadText, toCsv } from './csv';

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  type?: 'text' | 'number';
  getValue?: (row: T) => string | number;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T extends { id: string; name?: string }> {
  caption: string;
  data: T[];
  columns: ColumnDef<T>[];
  searchPlaceholder?: string;
  /** Optional controlled search value; when provided, filtering is delegated to the caller. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onCreate?: () => void;
  createLabel?: string;
  onEdit?: (row: T) => void;
  /** Called only after the user confirms. A rejected promise is shown in the confirm dialog. */
  onDelete?: (row: T) => void | Promise<void>;
  extraActions?: (row: T) => React.ReactNode;
  headerTabs?: React.ReactNode;
  /** Shows row checkboxes and "Delete selected" (runs `onDelete` per row). Defaults to on when `onDelete` is set. */
  bulkDelete?: boolean;
  /** Hides the "Export CSV" button (e.g. for tables whose rows hold secrets). */
  noExport?: boolean;
}

interface BulkResult {
  deleted: number;
  failures: { name: string; error: string }[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Reads a column's raw value by key, for columns without a custom getValue/render. */
const cellValue = (row: object, key: string): unknown => (row as Record<string, unknown>)[key];

export function DataTable<T extends { id: string; name?: string }>({
  caption,
  data,
  columns,
  searchPlaceholder = 'Search by name or attribute…',
  searchValue,
  onSearchChange,
  onCreate,
  createLabel = 'Create',
  onEdit,
  onDelete,
  extraActions,
  headerTabs,
  bulkDelete,
  noExport,
}: DataTableProps<T>) {
  const captionId = useId();
  const [internalQuery, setInternalQuery] = useState('');
  const query = searchValue !== undefined ? searchValue : internalQuery;
  const setQuery = useCallback(
    (next: string) => {
      if (onSearchChange) onSearchChange(next);
      else setInternalQuery(next);
    },
    [onSearchChange],
  );
  const canBulk = !!onDelete && bulkDelete !== false;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [sortCol, setSortCol] = useState<string>(columns[0]?.key || 'name');
  const [sortDir, setSortDir] = useState<'ascending' | 'descending'>('ascending');
  const [confirmRow, setConfirmRow] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Always reset: the native <dialog> can be closed with Escape even mid-request, and the
  // React state must follow it or the next delete click would not reopen the dialog.
  const closeConfirm = useCallback(() => {
    setConfirmRow(null);
    setDeleteError('');
  }, []);

  const confirmDelete = async () => {
    if (!confirmRow || !onDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDelete(confirmRow);
      setConfirmRow(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q || searchValue !== undefined
      ? [...data]
      : data.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
    const col = columns.find((c) => c.key === sortCol);
    if (!col) return list;
    const factor = sortDir === 'ascending' ? 1 : -1;
    const valueOf = (row: T) => (col.getValue ? col.getValue(row) : cellValue(row, col.key));
    return list.sort((a, b) => {
      const va = valueOf(a) ?? '';
      const vb = valueOf(b) ?? '';
      if (col.type === 'number') {
        return factor * (Number(va) - Number(vb));
      }
      return factor * collator.compare(String(va), String(vb));
    });
  }, [data, query, searchValue, sortCol, sortDir, columns]);

  // Drop selections for rows that no longer exist (deleted here or elsewhere).
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(data.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  const visibleSelected = filtered.filter((r) => selected.has(r.id));
  const allVisibleSelected = filtered.length > 0 && visibleSelected.length === filtered.length;

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });

  const closeBulk = useCallback(() => {
    setBulkOpen(false);
    setBulkResult(null);
  }, []);

  /** Deletes the selected rows one at a time so each failure is reported against its row. */
  const runBulkDelete = async () => {
    if (!onDelete) return;
    const rows = visibleSelected;
    setBulkRunning(true);
    const failures: BulkResult['failures'] = [];
    let deleted = 0;
    for (const row of rows) {
      try {
        await onDelete(row);
        deleted++;
      } catch (err) {
        failures.push({ name: row.name || row.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    setBulkRunning(false);
    setSelected(new Set());
    if (failures.length) {
      // Reopen if the dialog was dismissed (Escape) while the deletes were still running.
      setBulkResult({ deleted, failures });
      setBulkOpen(true);
    } else {
      closeBulk();
    }
  };

  const exportCsv = () => {
    const headers = columns.map((c) => c.header);
    const rows = filtered.map((row) => columns.map((c) => (c.getValue ? c.getValue(row) : cellValue(row, c.key))));
    downloadText(csvFileName(caption), toCsv(headers, rows));
  };

  const handleSort = (key: string) => {
    if (sortCol === key) {
      setSortDir((prev) => (prev === 'ascending' ? 'descending' : 'ascending'));
    } else {
      setSortCol(key);
      setSortDir('ascending');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {headerTabs}
          <div className="relative min-w-64">
            <Search className="w-3.5 h-3.5 text-[var(--ac-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-xs"
            />
          </div>
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-xs text-[var(--ac-dial)] underline cursor-pointer"
            >
              Clear filter
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canBulk && visibleSelected.length > 0 && (
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)] text-[var(--ac-bad)] text-xs font-semibold cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete selected ({visibleSelected.length})</span>
            </button>
          )}
          {!noExport && (
            <button
              type="button"
              onClick={exportCsv}
              disabled={!filtered.length}
              title={`Download the ${filtered.length} shown row${filtered.length === 1 ? '' : 's'} as CSV`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] text-xs font-medium hover:border-[var(--ac-muted)] cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--ac-dial)] text-white text-xs font-semibold shadow-sm hover:opacity-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{createLabel}</span>
            </button>
          )}
        </div>
      </div>

      <div role="status" className="sr-only-status">
        Sorted by {sortCol}, {sortDir}, {filtered.length} rows
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-labelledby={captionId}
        className="bpc-table-region rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] shadow-sm"
      >
        <table className="bpc-table">
          <caption id={captionId} className="sr-only-status">
            {caption}
          </caption>
          <thead>
            <tr>
              {canBulk && (
                <th scope="col" className="w-8">
                  <input
                    type="checkbox"
                    aria-label={allVisibleSelected ? 'Deselect all shown rows' : 'Select all shown rows'}
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = visibleSelected.length > 0 && !allVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    disabled={!filtered.length}
                    className="cursor-pointer"
                  />
                </th>
              )}
              {columns.map((c) => {
                const isSorted = sortCol === c.key;
                const sortable = c.sortable !== false;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={sortable && isSorted ? sortDir : undefined}
                  >
                    {sortable ? (
                      <button type="button" onClick={() => handleSort(c.key)}>
                        <span>{c.header}</span>
                        {isSorted && (
                          <span aria-hidden="true">
                            {sortDir === 'ascending' ? (
                              <ArrowUp className="w-3 h-3" />
                            ) : (
                              <ArrowDown className="w-3 h-3" />
                            )}
                          </span>
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {(onEdit || onDelete || extraActions) && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.map((row) => (
                <tr key={row.id} className={selected.has(row.id) ? 'bg-[var(--ac-dial-soft)]' : undefined}>
                  {canBulk && (
                    <td className="w-8">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.name || row.id}`}
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="cursor-pointer"
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key}>{c.render ? c.render(row) : (cellValue(row, c.key) as React.ReactNode)}</td>
                  ))}
                  {(onEdit || onDelete || extraActions) && (
                    <td className="whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {extraActions && extraActions(row)}
                        {onEdit && (
                          <button
                            type="button"
                            onClick={() => onEdit(row)}
                            title="Edit"
                            className="p-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmRow(row)}
                            title="Delete"
                            aria-label={`Delete ${row.name || row.id}`}
                            className="p-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-bad)] hover:bg-[var(--ac-bad-soft)] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length + (onEdit || onDelete || extraActions ? 1 : 0) + (canBulk ? 1 : 0)}
                  className="text-center py-8 text-[var(--ac-muted)] text-xs"
                >
                  No records match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ModalDialog open={!!confirmRow} onClose={closeConfirm} title="Delete this item?">
        <div className="space-y-4 text-xs">
          <p className="m-0">
            Permanently delete <strong className="font-mono">{confirmRow?.name || confirmRow?.id}</strong> from{' '}
            {caption.toLowerCase()}? This takes effect on the controller immediately and cannot be undone.
          </p>
          {deleteError && (
            <p role="alert" className="m-0 p-3 rounded-lg border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)]">
              {deleteError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeConfirm}
              disabled={deleting}
              className="px-3.5 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              autoFocus
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--ac-bad)] text-white font-semibold cursor-pointer disabled:opacity-60"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{deleting ? 'Deleting…' : 'Delete'}</span>
            </button>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={bulkOpen}
        onClose={closeBulk}
        title={bulkResult ? 'Some items were not deleted' : `Delete ${visibleSelected.length} items?`}
      >
        {bulkResult ? (
          <div className="space-y-4 text-xs">
            <p className="m-0">
              Deleted {bulkResult.deleted}. These {bulkResult.failures.length} failed and are still on the controller:
            </p>
            <ul role="alert" className="m-0 p-3 rounded-lg border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)] space-y-1 list-none max-h-60 overflow-auto">
              {bulkResult.failures.map((f) => (
                <li key={f.name}>
                  <strong className="font-mono">{f.name}</strong>: {f.error}
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={closeBulk}
                autoFocus
                className="px-3.5 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <p className="m-0">
              Permanently delete these from {caption.toLowerCase()}? This takes effect on the controller immediately and
              cannot be undone.
            </p>
            <ul className="m-0 p-3 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono max-h-48 overflow-auto list-none space-y-0.5">
              {visibleSelected.map((r) => (
                <li key={r.id}>{r.name || r.id}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeBulk}
                disabled={bulkRunning}
                className="px-3.5 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runBulkDelete}
                disabled={bulkRunning || !visibleSelected.length}
                autoFocus
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--ac-bad)] text-white font-semibold cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{bulkRunning ? 'Deleting…' : `Delete ${visibleSelected.length}`}</span>
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
