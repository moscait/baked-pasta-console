import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Quick Add targets: the `?new=` value, the page route that handles it, and its label. */
export const QUICK_ADD_ITEMS = [
  { intent: 'wizard', route: '/services', label: 'Set up a service (guided)', hint: 'Configs, service, hosts, users and policies in one flow' },
  { intent: 'identity', route: '/identities', label: 'Identity', hint: 'A user device, server or workload' },
  { intent: 'service', route: '/services', label: 'Service', hint: 'A bare service; attach configs yourself' },
  { intent: 'service-policy', route: '/service-policies', label: 'Service policy', hint: 'Dial or Bind access by attribute' },
  { intent: 'edge-router', route: '/routers', label: 'Edge router', hint: 'Returns an enrollment JWT' },
  { intent: 'posture-check', route: '/posture-checks', label: 'Posture check', hint: 'MFA, OS, MAC or domain requirement' },
] as const;

export type CreateIntent = (typeof QUICK_ADD_ITEMS)[number]['intent'];

export const quickAddHref = (item: (typeof QUICK_ADD_ITEMS)[number]) => `${item.route}?new=${item.intent}`;

/**
 * Opens a page's create dialog when the URL carries `?new=<intent>` (from Quick Add), then
 * removes the parameter so a reload or Back does not reopen it.
 */
export function useCreateIntent(handlers: Partial<Record<CreateIntent, () => void>>): void {
  const [params, setParams] = useSearchParams();
  const want = params.get('new') as CreateIntent | null;
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!want) return;
    const handler = handlersRef.current[want];
    if (!handler) return;
    handler();
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [want, setParams]);
}
