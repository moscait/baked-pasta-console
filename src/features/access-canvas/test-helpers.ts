// Typed narrowing for specs: pick ops and intents without casting.

import type { AcOp } from './access-canvas.logic';
import type { Intent } from './canvas-board.logic';

export type OpOf<K extends AcOp['op']> = Extract<AcOp, { op: K }>;

export const isOp =
  <K extends AcOp['op']>(...kinds: K[]) =>
  (o: AcOp): o is OpOf<K> =>
    (kinds as AcOp['op'][]).includes(o.op);

/** The first op of type `op` that also matches `where`; fails the test when there is none. */
export function findOp<K extends AcOp['op']>(ops: AcOp[], op: K, where: (o: OpOf<K>) => boolean = () => true): OpOf<K> {
  const found = ops.filter(isOp(op)).find(where);
  if (!found) throw new Error(`no ${op} op matched`);
  return found;
}

/** The intent of a successful edit; fails the test with the error otherwise. */
export function intentOf<T extends Intent>(r: T | { error: string }): T {
  if ('error' in r) throw new Error(`expected an intent, got: ${r.error}`);
  return r;
}
