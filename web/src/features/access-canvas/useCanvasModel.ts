import { useCallback, useEffect, useRef, useState } from 'react';
import { zitiService } from '../../services/ziti-service';
import type { AcModel } from './access-canvas.logic';

/** Loads the committed network model and reloads it whenever the service reports a change. */
export function useCanvasModel() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [committed, setCommitted] = useState<AcModel | null>(null);

  // Kept in a ref so `reload` stays stable: depending on `committed` here would recreate
  // `reload` after every load, re-run the effect below, and refetch forever.
  const hasLoadedRef = useRef(false);
  const reload = useCallback(async () => {
    setLoading((prev) => !hasLoadedRef.current && prev);
    setLoadError('');
    try {
      const m = await zitiService.loadCanvasModel();
      hasLoadedRef.current = true;
      setCommitted(m);
    } catch (err) {
      setLoadError(zitiService.errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    return zitiService.subscribe(() => {
      reload();
    });
  }, [reload]);

  return { loading, loadError, committed, reload };
}
