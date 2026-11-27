import React from 'react';

const LINES: { label: string; stroke: string; dash?: string }[] = [
  { label: 'Dial (use)', stroke: 'var(--ac-dial)' },
  { label: 'Bind (host)', stroke: 'var(--ac-bind)' },
  { label: 'Routers', stroke: 'var(--ac-router)' },
  { label: 'By name (@)', stroke: 'var(--ac-dial)', dash: '2 4' },
  { label: 'Pending', stroke: 'var(--ac-pending)', dash: '5 3' },
];

/** What each line style on the canvas means. */
export const CanvasLegend: React.FC = () => (
  <div
    aria-label="Legend"
    className="absolute left-3 bottom-3 flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-lg bg-[var(--ac-surface)]/90 border border-[var(--ac-line)] text-[11.5px] text-[var(--ac-muted)] pointer-events-none"
  >
    {LINES.map((l) => (
      <span key={l.label} className="inline-flex items-center gap-1.5">
        <svg width="20" height="8">
          <path d="M1 4h18" stroke={l.stroke} strokeWidth="2" strokeDasharray={l.dash} />
        </svg>
        {l.label}
      </span>
    ))}
  </div>
);
