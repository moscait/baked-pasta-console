import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { ApiSession } from '../../services/api-types';
import { AcEndpoint, AcKind, buildOptions, clone } from './access-canvas.logic';
import { BoardFilters, Clip, buildBoard, groupKey, marksFor, remapLayout } from './canvas-board.logic';
import { ConcurrencyPolicy, evaluateSessionMonitor } from '../sessions/session-monitor.logic';
import { CanvasBoard, CanvasBoardHandle } from './CanvasBoard';
import { AccessWizard } from './AccessWizard';
import type { WizardPlan } from './access-wizard.logic';
import { revertsOf, zitiService } from '../../services/ziti-service';
import { useServiceLoad } from '../../components/state-hooks';
import { DrawerKind, ToastFn, showEverything } from './canvas-page.shared';
import { collectProblems } from './problem-rows';
import { useCanvasModel } from './useCanvasModel';
import { useCanvasLayout } from './useCanvasLayout';
import { useChangeSets } from './useChangeSets';
import { useAdvisor } from './useAdvisor';
import { NewGroupDraft, useBoardCommands } from './useBoardCommands';
import { CanvasHeader, RenderMode } from './CanvasHeader';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasDock } from './CanvasDock';
import { CanvasDrawer } from './CanvasDrawer';
import { CanvasLegend } from './CanvasLegend';
import { GrantAccessDialog, GrantState } from './GrantAccessDialog';
import { NewGroupDialog } from './NewGroupDialog';
import { ProblemsDialog } from './ProblemsDialog';

// React Flow is only needed for the graph view, so load it on demand.
const ReactFlowBoard = React.lazy(() => import('./ReactFlowBoard').then((m) => ({ default: m.ReactFlowBoard })));

/**
 * The Access Canvas: the network as groups, cards and policy lines. Edits are staged as
 * change sets (see useChangeSets) and only reach the controller on Apply.
 */
export const AccessCanvasPage: React.FC<{ onToast: ToastFn }> = ({ onToast }) => {
  const navigate = useNavigate();
  const boardRef = useRef<CanvasBoardHandle>(null);
  const seqRef = useRef(1);
  const newId = useCallback(() => `new-${seqRef.current++}`, []);
  const newChangeId = useCallback(() => 'c' + seqRef.current++, []);

  const [filters, setFilters] = useState<BoardFilters>(showEverything);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [clip, setClip] = useState<Clip | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>('freeform');
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [advisorI, setAdvisorI] = useState('');
  const [advisorS, setAdvisorS] = useState('');
  const [newGroup, setNewGroup] = useState<NewGroupDraft | null>(null);
  const [grant, setGrant] = useState<GrantState | null>(null);

  const { loading, loadError, committed, reload } = useCanvasModel();
  const [apiSessions, setApiSessions] = useState<ApiSession[]>([]);
  const [concPolicy, setConcPolicy] = useState<ConcurrencyPolicy>(() => zitiService.getConcurrencyPolicy());

  // Live session overlay: loaded on mount and after commits; a failure just leaves it empty.
  const loadLiveSessions = useServiceLoad(
    () => zitiService.list('api-sessions').catch(() => []),
    setApiSessions,
    () => {},
    { onChange: false },
  );

  useEffect(() => zitiService.subscribePolicy(() => setConcPolicy(zitiService.getConcurrencyPolicy())), []);

  const changes = useChangeSets({
    committed,
    onToast,
    reload,
    newChangeId,
    onFollowUps: () => setDrawer('pending'),
  });
  const { draft: rawDraft, pending } = changes;

  // Overlay live session IPs & concurrency badges in memory without coupling them to staged edits or problem counts.
  const draft = useMemo(() => {
    if (!rawDraft) return null;
    if (!apiSessions.length) return rawDraft;
    const monitor = evaluateSessionMonitor({
      identities: rawDraft.identities.map((i) => ({
        id: i.id,
        name: i.name,
        isAdmin: i.isAdmin,
        externalId: i.externalId,
        roleAttributes: i.attrs,
      })),
      apiSessions,
      sessions: [],
      policy: concPolicy,
      currentSessionToken: zitiService.currentSessionToken(),
    });
    return {
      ...rawDraft,
      identities: rawDraft.identities.map((i) => {
        const s = monitor.byIdentity.get(i.id);
        if (!s) return i;
        return {
          ...i,
          sessionIps: s.distinctLiveIps,
          liveSessionCount: s.liveSessionCount,
          concurrency: s.finding
            ? {
                severity: s.finding.severity,
                concurrentSessionCount: s.finding.concurrentSessionCount,
                distinctIps: s.finding.distinctIps,
                summary: s.finding.summary,
              }
            : undefined,
        };
      }),
    };
  }, [rawDraft, apiSessions, concPolicy]);

  const layout = useCanvasLayout({ draft, committed, expanded, boardRef, onToast });
  const { layoutDraft, saveLayout } = layout;
  // New entities get server ids on apply; move their saved card positions to the new ids.
  const applyAll = () => changes.applyAll((idMap) => saveLayout(remapLayout(layoutDraft, idMap)));

  const board = useMemo(() => {
    if (!draft) return { nodes: [], edges: [] };
    return buildBoard(draft, {
      layout: layoutDraft,
      filters,
      marks: marksFor(pending.map((p) => p.ops)),
      expanded,
    });
  }, [draft, layoutDraft, filters, pending, expanded]);

  const problems = useMemo(
    () => (draft ? collectProblems(draft, layoutDraft) : { rows: [], total: 0 }),
    [draft, layoutDraft],
  );

  const advisor = useAdvisor(draft, advisorI, advisorS);

  const openGrant = useCallback(
    (src: AcEndpoint, tgt: AcEndpoint | null) => {
      if (!draft) return;
      const result = tgt ? buildOptions(draft, src, tgt, newId) : undefined;
      const selected = result ? Math.max(0, result.opts.findIndex((o) => o.recommended)) : 0;
      setGrant({ src, tgt, result, selected, targetVal: tgt ? JSON.stringify(tgt) : '' });
    },
    [draft, newId],
  );

  const showAdvisorFor = useCallback((kind: AcKind, id: string) => {
    if (kind === 'identity') setAdvisorI(id);
    else if (kind === 'service') setAdvisorS(id);
  }, []);

  const { handleMemberDrop, handleNodeDrop, handleCommand } = useBoardCommands({
    draft,
    boardNodes: board.nodes,
    layoutDraft,
    saveLayout,
    clip,
    setClip,
    newId,
    queueIntent: changes.queueIntent,
    undoLastPending: changes.undoLastPending,
    openGrant,
    autoArrange: layout.autoArrange,
    setNewGroup,
    setExpanded,
    showAdvisorFor,
    setDrawer,
    navigate,
    onToast,
  });

  const filtersActive =
    !filters.types.identity ||
    !filters.types.service ||
    !filters.types.router ||
    filters.attrs.length > 0 ||
    !!filters.search.trim() ||
    filters.problemsOnly ||
    !!filters.ipFilter?.trim() ||
    !!filters.activeSessionsOnly ||
    !!filters.concurrentOnly;
  const clearFilters = () => setFilters(showEverything());

  const searchMatches = useMemo(
    () =>
      board.nodes.reduce(
        (n, x) =>
          n +
          (x.type === 'group'
            ? x.members.filter((mb) => mb.hit).length + (x.hit && !x.members.some((mb) => mb.hit) ? 1 : 0)
            : x.hit
              ? 1
              : 0),
        0,
      ),
    [board.nodes],
  );

  const addGroup = (g: NewGroupDraft) => {
    const attr = g.attr.trim().replace(/^#/, '');
    if (!attr || /\s/.test(attr)) {
      onToast('warning', 'Invalid name', 'Use a single word without spaces, such as sales or web-servers.');
      return;
    }
    const id = `${g.kind}:${attr}`;
    if (board.nodes.some((n) => n.key === groupKey(g.kind, attr)) || (layoutDraft.groups || []).includes(id)) {
      onToast('info', 'Already exists', `#${attr} is already on the canvas.`);
    } else {
      const next = clone(layoutDraft);
      next.groups = [...(next.groups || []), id];
      next.nodes[groupKey(g.kind, attr)] = { x: Math.round(g.at.x), y: Math.round(g.at.y) };
      saveLayout(next);
    }
    setNewGroup(null);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <CanvasHeader
        renderMode={renderMode}
        onRenderMode={setRenderMode}
        showSetup={!loading && !loadError}
        onSetup={() => setWizardOpen(true)}
      />

      {loading ? (
        <div className="p-8 rounded-xl border border-dashed border-[var(--ac-line)] bg-[var(--ac-surface)] text-center text-sm text-[var(--ac-muted)]">
          Loading identities, services, routers and policies…
        </div>
      ) : loadError ? (
        <div className="p-6 rounded-xl border border-[var(--ac-bad)] bg-[var(--ac-bad-soft)] text-sm text-[var(--ac-bad)] flex items-center justify-between">
          <span>Couldn&apos;t load the network: {loadError}</span>
          <button type="button" onClick={reload} className="underline font-semibold cursor-pointer">
            Try again
          </button>
        </div>
      ) : (
        <>
          <CanvasToolbar
            draft={draft}
            filters={filters}
            setFilters={setFilters}
            filtersActive={filtersActive}
            onClearFilters={clearFilters}
            searchMatches={searchMatches}
            onRevealFirstMatch={() => {
              const hit = board.nodes.find((x) => x.hit);
              if (hit) boardRef.current?.reveal(hit.key);
            }}
            problemTotal={problems.total}
            onOpenProblems={() => setProblemsOpen(true)}
            clip={clip}
            onClearClip={() => setClip(null)}
            onArrange={layout.autoArrange}
            onExport={layout.exportLayout}
            onImport={layout.importLayout}
            onRefresh={async () => {
              await Promise.all([reload(), loadLiveSessions()]);
              requestAnimationFrame(() => boardRef.current?.fit());
            }}
            busy={changes.busy}
          />

          <section className="relative flex-1 min-h-[540px]" aria-label="Canvas">
            {renderMode === 'freeform' ? (
              <CanvasBoard
                ref={boardRef}
                board={board}
                hasClip={!!clip}
                onMoved={layout.handleMoved}
                onMemberDrop={handleMemberDrop}
                onNodeDrop={handleNodeDrop}
                onCommand={handleCommand}
              />
            ) : (
              <React.Suspense fallback={<div className="p-4 text-xs text-[var(--ac-muted)]">Loading graph view…</div>}>
                <ReactFlowBoard board={board} onMoved={layout.handleMoved} onGrantConnect={(src, tgt) => openGrant(src, tgt)} />
              </React.Suspense>
            )}

            {draft && !draft.services.length && !pending.length && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-96 p-6 rounded-2xl bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-2xl text-center space-y-3">
                <Sparkles className="w-8 h-8 text-[var(--ac-dial)] mx-auto" />
                <h2 className="text-base font-semibold m-0">No services yet</h2>
                <p className="text-xs text-[var(--ac-muted)] m-0">
                  Set up your first OpenZiti service: the service configs, the hosting identity, who may dial it, and the policies between them.
                </p>
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  className="px-4 py-2 rounded-xl bg-[var(--ac-dial)] text-white text-xs font-semibold cursor-pointer"
                >
                  ＋ Set up a service
                </button>
              </div>
            )}

            <CanvasDock
              drawer={drawer}
              onToggleDrawer={(d) => setDrawer((prev) => (prev === d ? null : d))}
              advisorOk={advisor.identity && advisor.service ? !advisor.failure : null}
              pendingCount={pending.length}
              pulse={changes.pulse}
              busy={changes.busy}
              onApply={applyAll}
            />

            {drawer && (
              <CanvasDrawer
                kind={drawer}
                onClose={() => setDrawer(null)}
                advisor={{ draft, advisor, onIdentity: setAdvisorI, onService: setAdvisorS }}
                pending={{
                  pending,
                  followUps: changes.followUps,
                  busy: changes.busy,
                  canUndo: changes.history.length > 0,
                  onApply: applyAll,
                  onDiscard: changes.discard,
                  onDiscardAll: changes.discardAll,
                  onUndo: changes.undoLast,
                  onDismissFollowUp: changes.dismissFollowUp,
                }}
              />
            )}

            <CanvasLegend />
          </section>
        </>
      )}

      {wizardOpen && draft && (
        <AccessWizard
          open={wizardOpen}
          model={draft}
          newId={newId}
          onClose={() => setWizardOpen(false)}
          onQueued={(p: WizardPlan) => {
            setWizardOpen(false);
            changes.queueChange(p.title, p.summary, p.ops, p.next);
            setDrawer('pending');
          }}
          onApplyNow={async (p: WizardPlan) => {
            try {
              await zitiService.applyCanvasOps(p.ops);
              setWizardOpen(false);
              onToast('success', 'Service set up end-to-end!', p.summary);
            } catch (err) {
              const failures = await zitiService.revertCanvasOps(revertsOf(err));
              const msg = failures.length
                ? `${zitiService.errorText(err)}. Rolling back also failed: ${zitiService.describeRevertFailures(failures)}`
                : `${zitiService.errorText(err)}. Nothing was kept.`;
              onToast('error', 'Failed to apply wizard', msg);
              throw new Error(msg);
            } finally {
              await reload();
            }
          }}
        />
      )}

      {grant && draft && (
        <GrantAccessDialog
          state={grant}
          onChange={setGrant}
          onClose={() => setGrant(null)}
          draft={draft}
          newId={newId}
          onQueue={changes.queueChange}
        />
      )}

      {newGroup && (
        <NewGroupDialog group={newGroup} onChange={setNewGroup} onClose={() => setNewGroup(null)} onSubmit={addGroup} />
      )}

      {problemsOpen && (
        <ProblemsDialog
          rows={problems.rows}
          total={problems.total}
          problemsOnly={filters.problemsOnly}
          onClose={() => setProblemsOpen(false)}
          onLocate={(r) => {
            setProblemsOpen(false);
            const nodeKey = r.node.startsWith('m|') ? r.node.split('|')[1] : r.node;
            if (!board.nodes.some((n) => n.key === nodeKey)) clearFilters();
            requestAnimationFrame(() => boardRef.current?.reveal(nodeKey, r.node.startsWith('m|') ? r.node : undefined));
          }}
          onOpen={(r) => {
            setProblemsOpen(false);
            navigate(r.route);
          }}
          onToggleProblemsOnly={() => {
            setFilters((prev) => ({ ...prev, problemsOnly: !prev.problemsOnly }));
            setProblemsOpen(false);
            requestAnimationFrame(() => boardRef.current?.fit());
          }}
        />
      )}
    </div>
  );
};
