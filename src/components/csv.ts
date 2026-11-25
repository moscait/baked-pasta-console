/** CSV export for list tables (RFC 4180 quoting, spreadsheet-formula neutralisation). */

/**
 * Cells starting with these characters are evaluated as formulas by Excel, LibreOffice and
 * Google Sheets. Entity names and attributes come from the controller, so a leading quote is
 * added to keep a crafted name such as `=HYPERLINK(...)` inert when the file is opened.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s: string;
  if (value === null || value === undefined) s = '';
  else if (Array.isArray(value)) s = value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('; ');
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** File name for an export: `<caption>-<yyyy-mm-dd>.csv`, lower-case and dash-separated. */
export function csvFileName(caption: string, now = new Date()): string {
  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'export'}-${now.toISOString().slice(0, 10)}.csv`;
}

/** Starts a browser download of `text`. The UTF-8 BOM makes Excel read non-ASCII names correctly. */
export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
