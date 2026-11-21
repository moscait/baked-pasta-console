import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Position,
  Connection,
  Handle,
} from '@xyflow/react';
import { Board, BoardNode } from './canvas-board.logic';
import { AcEndpoint } from './access-canvas.logic';

interface ReactFlowBoardProps {
  board: Board;
  onMoved: (moves: { key: string; x: number; y: number }[]) => void;
  onGrantConnect: (src: AcEndpoint, tgt: AcEndpoint) => void;
}

const GroupFlowNode: React.FC<{ data: { n: BoardNode } }> = ({ data }) => {
  const { n } = data;
  const borderColor =
    n.kind === 'service' ? 'var(--ac-bind)' : n.kind === 'router' ? 'var(--ac-router)' : 'var(--ac-dial)';
  return (
    <div
      style={{ width: n.w, borderTop: `3px solid ${borderColor}` }}
      className="rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-ink)] shadow-md overflow-hidden text-xs"
    >
      <Handle type="target" position={Position.Left} className="!bg-[var(--ac-dial)]" />
      <div className="flex items-center gap-2 px-2.5 py-2 bg-[var(--ac-surface-2)] border-b border-[var(--ac-line)] font-semibold">
        <span className="ab-kind">{n.kind === 'service' ? 'S' : n.kind === 'router' ? 'R' : 'I'}</span>
        <span className="font-mono flex-1 truncate">#{n.attr}</span>
        <span className="text-[var(--ac-muted)]">{n.members.length}</span>
      </div>
      <div className="divide-y divide-[var(--ac-line)]/50">
        {n.shown.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-2.5 py-1.5">
            <span className="truncate">{m.name}</span>
            {m.problems.length > 0 && <span className="w-2 h-2 rounded-full bg-[var(--ac-bad)]" />}
          </div>
        ))}
        {n.shown.length === 0 && <div className="px-2.5 py-1.5 text-[var(--ac-muted)]">Empty group</div>}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[var(--ac-dial)]" />
    </div>
  );
};

const FreeFlowNode: React.FC<{ data: { n: BoardNode } }> = ({ data }) => {
  const { n } = data;
  return (
    <div
      style={{ width: n.w }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-[var(--ac-line)] bg-[var(--ac-surface)] text-[var(--ac-ink)] shadow-sm text-xs"
    >
      <Handle type="target" position={Position.Left} />
      <span className="ab-kind">{n.kind === 'service' ? 'S' : n.kind === 'router' ? 'R' : 'I'}</span>
      <span className="flex-1 truncate font-medium">{n.entity?.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

const HubFlowNode: React.FC<{ data: { n: BoardNode } }> = ({ data }) => {
  const { n } = data;
  const p = n.policy!;
  return (
    <div
      data-family={p.family}
      className="ab-hub px-3 py-1 rounded-full shadow-sm text-xs flex items-center gap-1.5"
    >
      <Handle type="target" position={Position.Left} />
      <span className="ab-fam">{p.family.toUpperCase()}</span>
      <span className="font-medium">{p.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

const nodeTypes = {
  groupNode: GroupFlowNode,
  freeNode: FreeFlowNode,
  hubNode: HubFlowNode,
};

export const ReactFlowBoard: React.FC<ReactFlowBoardProps> = ({ board, onMoved, onGrantConnect }) => {
  const nodes: Node[] = useMemo(
    () =>
      board.nodes.map((n) => ({
        id: n.key,
        type: n.type === 'group' ? 'groupNode' : n.type === 'free' ? 'freeNode' : 'hubNode',
        position: { x: n.x, y: n.y },
        data: { n },
      })),
    [board.nodes],
  );

  const edges: Edge[] = useMemo(
    () =>
      board.edges.map((e) => ({
        id: e.id,
        source: e.from.node,
        target: e.to.node,
        animated: e.pending,
        style: {
          stroke:
            e.family === 'dial'
              ? 'var(--ac-dial)'
              : e.family === 'bind'
                ? 'var(--ac-bind)'
                : 'var(--ac-router)',
          strokeWidth: 2,
          strokeDasharray: e.pending ? '6 4' : e.byName ? '2 5' : undefined,
        },
      })),
    [board.edges],
  );

  const handleConnect = (conn: Connection) => {
    if (!conn.source || !conn.target) return;
    const sNode = board.nodes.find((n) => n.key === conn.source);
    const tNode = board.nodes.find((n) => n.key === conn.target);
    if (!sNode || !tNode || sNode.kind !== 'identity' || tNode.kind !== 'service') return;
    const src: AcEndpoint =
      sNode.type === 'group' ? { kind: 'group', attr: sNode.attr } : { kind: 'identity', id: sNode.entity?.id };
    const tgt: AcEndpoint =
      tNode.type === 'group' ? { kind: 'group', attr: tNode.attr } : { kind: 'service', id: tNode.entity?.id };
    onGrantConnect(src, tgt);
  };

  return (
    <div className="w-full h-full min-h-[520px] rounded-xl border border-[var(--ac-line)] overflow-hidden bg-[var(--ac-bg)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeDragStop={(_, node) => {
          onMoved([{ key: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y) }]);
        }}
        onConnect={handleConnect}
        fitView
      >
        <Background gap={22} size={1} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          style={{ background: 'var(--ac-surface)', border: '1px solid var(--ac-line)', borderRadius: 8 }}
        />
      </ReactFlow>
    </div>
  );
};
