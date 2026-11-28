import React, { useState } from 'react';
import { HelpCircle, LayoutGrid, Plus, Workflow } from 'lucide-react';
import { CONCEPTS } from './access-canvas.logic';

export type RenderMode = 'freeform' | 'reactflow';

/** Page title, canvas engine switch, "Set up a service" and the help popover. */
export const CanvasHeader: React.FC<{
  renderMode: RenderMode;
  onRenderMode: (mode: RenderMode) => void;
  showSetup: boolean;
  onSetup: () => void;
}> = ({ renderMode, onRenderMode, showSetup, onSetup }) => {
  const [helpOpen, setHelpOpen] = useState(false);
  const engineButton = (mode: RenderMode) =>
    `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
      renderMode === mode ? 'bg-[var(--ac-dial)] text-white font-medium' : 'text-[var(--ac-muted)] hover:text-[var(--ac-ink)]'
    }`;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight m-0">Access Canvas</h1>
        <p className="text-xs text-[var(--ac-muted)] m-0">
          Drag cards between groups, or drag an identity onto a service. Lines are policies. Nothing changes until you apply.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* Canvas Engine Switcher: Free-form Board vs React Flow */}
        <div
          className="inline-flex rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] p-0.5 text-xs"
          role="group"
          aria-label="Canvas Engine"
        >
          <button
            type="button"
            onClick={() => onRenderMode('freeform')}
            className={engineButton('freeform')}
            title="Free-form Board (drag members between groups, marquee select, clipboard)"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Board</span>
          </button>
          <button
            type="button"
            onClick={() => onRenderMode('reactflow')}
            className={engineButton('reactflow')}
            title="React Flow Graph with Minimap & Handle Connectors"
          >
            <Workflow className="w-3.5 h-3.5" />
            <span>Flow Graph</span>
          </button>
        </div>

        {showSetup && (
          <button
            type="button"
            onClick={onSetup}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--ac-dial)] text-white text-xs font-semibold shadow-sm hover:opacity-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Set up a service</span>
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setHelpOpen((prev) => !prev)}
            aria-expanded={helpOpen}
            aria-label="How to use the canvas"
            className="w-8 h-8 rounded-full border border-[var(--ac-line)] bg-[var(--ac-surface)] inline-grid place-items-center text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          {helpOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setHelpOpen(false)} />
              <div className="absolute right-0 top-10 z-30 w-96 max-w-[calc(100vw-2rem)] p-4 rounded-xl bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-2xl space-y-3 text-xs">
                <div className="font-semibold text-sm">Using the Access Canvas</div>
                <ul className="list-disc pl-4 space-y-1.5 text-[var(--ac-muted)]">
                  <li>
                    <b className="text-[var(--ac-ink)]">Zoom & Pan:</b> mouse wheel, pinch, ⌘/Ctrl+scroll, or + / −. Press <code>0</code> to fit.
                  </li>
                  <li>
                    <b className="text-[var(--ac-ink)]">Group membership:</b> drag a card into another group to move it (hold Alt/Option to copy), or onto empty space to remove it from the group.
                  </li>
                  <li>
                    <b className="text-[var(--ac-ink)]">Grant Access:</b> drag an identity (or an entire identity group) onto a service or service group.
                  </li>
                  <li>
                    <b className="text-[var(--ac-ink)]">Copy Access:</b> ⌘/Ctrl+C a card, select another card or group, ⌘/Ctrl+V. Paste on empty space to clone.
                  </li>
                  <li>
                    <b className="text-[var(--ac-ink)]">Advisor:</b> double-click any card or press Enter to diagnose its end-to-end connectivity path.
                  </li>
                </ul>
                <div className="font-semibold text-sm pt-1">OpenZiti Concepts</div>
                <div className="space-y-1.5">
                  {(['identities', 'services', 'dial', 'bind', 'routers'] as const).map((c) => (
                    <div key={c} className="p-2 rounded-lg bg-[var(--ac-dial-soft)] text-[11.5px]">
                      {CONCEPTS[c]}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
