import React, { useCallback, useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, Trash2, Edit2 } from 'lucide-react';
import { ModalDialog } from './ModalDialog';

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
                <tr key={row.id}>
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
                  colSpan={columns.length + (onEdit || onDelete || extraActions ? 1 : 0)}
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
    </div>
  );
}
