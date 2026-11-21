import { AcKind, AcLayout, AcModel, KIND_LABEL } from './access-canvas.logic';
import { buildBoard, marksFor } from './canvas-board.logic';
import { ENTITY_ROUTE, POLICY_ROUTE, showEverything } from './canvas-page.shared';

export type ProbKind = AcKind | 'policy';
export type ProbSort = 'type' | 'name' | 'problem';

export interface ProblemRow {
  id: string;
  kind: ProbKind;
  typeLabel: string;
  name: string;
  problem: string;
  detail: string;
  hint: string;
  /** Board node key; member rows use `m|<groupKey>|<entityId>`. */
  node: string;
  route: string;
}

export interface ProblemFilter {
  q: string;
  kind: ProbKind | 'all';
  type: string;
}

export interface ProblemSortState {
  col: ProbSort;
  dir: 1 | -1;
}

const PROBLEM_HINTS: Record<string, string> = {
  'Not enrolled':
    'Enroll it with its one-time token (JWT), shown in the Token column on the Identities page. The token expires; create a new one if it has.',
  'No edge router policy':
    'Add a Router Policy whose Identity Attributes include this identity (for example #all on #all).',
  'Hosting identity is offline':
    'Start the tunneler on the machine that hosts its services, or check its network.',
  'Not hosted':
    'Add a Bind service policy whose Service Attributes select this service and whose Identity Attributes select the identity running next to the server.',
  'Host not enrolled': 'Enroll the identity that hosts it (see its Token on the Identities page).',
  'No service edge router policy':
    'Add a Service Router Policy whose Service Attributes include this service (for example #all on #all).',
  'Nobody can use it':
    'Add a Dial service policy that selects this service, or give the service a role attribute an existing Dial policy already selects.',
  Offline: 'Check that the router process is running and can reach the controller.',
  'Selects no identities':
    "Give the intended identities this role attribute (Roles on the Identities page), or change the policy's Identity Attributes.",
  'Selects no services':
    "Give the intended services this role attribute (Roles on the Services page), or change the policy's Service Attributes.",
  'Selects no routers':
    "Give the intended routers this role attribute, or change the policy's Router Attributes.",
  'Names a missing identity': 'The @name it refers to no longer exists. Edit the policy.',
  'Names a missing service': 'The @name it refers to no longer exists. Edit the policy.',
  'Names a missing router': 'The @name it refers to no longer exists. Edit the policy.',
};

const POLICY_LABEL: Record<string, string> = {
  dial: 'Dial policy',
  bind: 'Bind policy',
  erp: 'Router Policy',
  serp: 'Service Router Policy',
};

/**
 * Every problem on the (draft) network, one row per problem, plus the number of distinct
 * items affected. Ignores the board's current filters so the audit always covers everything.
 */
export function collectProblems(draft: AcModel, layout: AcLayout): { rows: ProblemRow[]; total: number } {
  const all = buildBoard(draft, {
    layout,
    marks: marksFor([]),
    expanded: new Set(),
    filters: showEverything(),
  });
  const rows: ProblemRow[] = [];
  const seen = new Set<string>();
  const push = (base: Omit<ProblemRow, 'id' | 'problem' | 'detail' | 'hint'>, problems: string[]) => {
    for (const text of problems) {
      const i = text.indexOf(': ');
      const problem = i > 0 ? text.slice(0, i) : text;
      const detail = i > 0 ? text.slice(i + 2) : '';
      rows.push({
        ...base,
        id: `${base.node}|${text}`,
        problem,
        detail,
        hint: PROBLEM_HINTS[problem] || '',
      });
    }
  };
  const entity = (kind: AcKind, id: string, name: string, node: string, problems: string[]) => {
    if (!problems.length || seen.has(kind + ':' + id)) return;
    seen.add(kind + ':' + id);
    push(
      {
        kind,
        typeLabel: KIND_LABEL[kind][0][0].toUpperCase() + KIND_LABEL[kind][0].slice(1),
        name,
        node,
        route: ENTITY_ROUTE[kind],
      },
      problems,
    );
  };
  for (const n of all.nodes) {
    if (n.type === 'group') {
      n.members.forEach((mb) => entity(mb.kind, mb.id, mb.name, `m|${n.key}|${mb.id}`, mb.problems));
    } else if (n.type === 'free') {
      entity(n.kind!, n.entity!.id, n.entity!.name, n.key, n.problems);
    } else if (n.problems.length) {
      const pol = n.policy!;
      push(
        {
          kind: 'policy',
          typeLabel: POLICY_LABEL[pol.family],
          name: pol.name,
          node: n.key,
          route: POLICY_ROUTE[pol.family],
        },
        n.problems,
      );
    }
  }
  const total = new Set(rows.map((r) => (r.node.startsWith('m|') ? `${r.route}/${r.name}` : r.node))).size;
  return { rows, total };
}

export function filterProblemRows(rows: ProblemRow[], pf: ProblemFilter, sort: ProblemSortState): ProblemRow[] {
  const q = pf.q.trim().toLowerCase();
  const out = rows.filter(
    (r) =>
      (pf.kind === 'all' || r.kind === pf.kind) &&
      (!pf.type || r.problem === pf.type) &&
      (!q || `${r.name} ${r.typeLabel} ${r.problem} ${r.detail}`.toLowerCase().includes(q)),
  );
  const key = (r: ProblemRow) =>
    sort.col === 'type' ? r.typeLabel + ' ' + r.name : sort.col === 'name' ? r.name : r.problem + ' ' + r.name;
  return out.sort((a, b) => key(a).localeCompare(key(b)) * sort.dir);
}
