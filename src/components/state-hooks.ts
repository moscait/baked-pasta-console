import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { zitiService } from '../services/ziti-service';

/**
 * State that starts from `value` and resets to it whenever `value` changes, e.g. a tab chosen by
 * the route that the user can also switch locally. Uses React's "adjust state while rendering"
 * pattern instead of an effect, so there is no extra render with the stale value.
 */
export function useResettableState<T>(value: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(value);
  const [seen, setSeen] = useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    setState(value);
  }
  return [state, setState];
}

/**
 * Fetches with `fetchData` on mount and whenever the service reports a change, and hands the
 * result to `apply`. Only the newest fetch is applied: a slow response that finishes after a
 * later one (or after unmount) is dropped. Returns `reload` for refreshing after a save.
 * Pass `{ onChange: false }` for data the service's change events don't cover: it then loads
 * on mount and on `reload` only.
 */
export function useServiceLoad<T>(
  fetchData: () => Promise<T>,
  apply: (data: T) => void,
  onError: (err: unknown) => void,
  { onChange = true }: { onChange?: boolean } = {},
): () => Promise<void> {
  // Latest callbacks without resubscribing when a page passes new closures each render.
  const fns = useRef({ fetchData, apply, onError });
  useEffect(() => {
    fns.current = { fetchData, apply, onError };
  });
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await fns.current.fetchData();
      if (mine === seq.current) fns.current.apply(data);
    } catch (err) {
      if (mine === seq.current) fns.current.onError(err);
    }
  }, []);

  useEffect(() => {
    const counter = seq; // a counter, not a DOM ref: reading it at cleanup time is intended
    void reload();
    const unsubscribe = onChange ? zitiService.subscribe(() => void reload()) : undefined;
    return () => {
      unsubscribe?.();
      counter.current++; // discard anything still in flight
    };
  }, [reload, onChange]);

  return reload;
}
