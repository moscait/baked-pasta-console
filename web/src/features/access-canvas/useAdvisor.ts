import { useMemo } from 'react';
import { AcModel, advise, clients, groups } from './access-canvas.logic';

/**
 * "Why can't they connect?" for the chosen identity and service. Falls back to the first
 * client / service when the chosen one no longer exists in the draft.
 */
export function useAdvisor(draft: AcModel | null, identityId: string, serviceId: string) {
  const clientGroups = useMemo(() => {
    if (!draft) return [];
    return groups(clients(draft)).map(([attr, members]) => ({ attr, members }));
  }, [draft]);

  const activeIdentityId = useMemo(() => {
    if (!draft) return '';
    const cl = clients(draft);
    return cl.some((i) => i.id === identityId) ? identityId : cl[0]?.id || '';
  }, [draft, identityId]);

  const activeServiceId = useMemo(() => {
    if (!draft) return '';
    return draft.services.some((s) => s.id === serviceId) ? serviceId : draft.services[0]?.id || '';
  }, [draft, serviceId]);

  const identity = draft?.identities.find((i) => i.id === activeIdentityId);
  const service = draft?.services.find((s) => s.id === activeServiceId);
  const steps = useMemo(() => {
    if (!draft || !identity || !service) return [];
    return advise(draft, identity, service);
  }, [draft, identity, service]);

  return {
    clientGroups,
    activeIdentityId,
    activeServiceId,
    identity,
    service,
    steps,
    failure: steps.find((x) => x.st === 'bad') || null,
    needsPosture: steps.some((x) => x.st === 'info'),
  };
}

export type AdvisorState = ReturnType<typeof useAdvisor>;
