import React from 'react';
import type { EdgeRouter, TransitRouter } from '../../services/api-types';
import { zitiService } from '../../services/ziti-service';
import { ModalDialog } from '../../components/ModalDialog';
import { JwtPanel } from '../../components/JwtPanel';
import { CheckField, ErrorList, Field, FormActions, JsonObjectField, inputCls, useDraft, useFormSubmit } from '../../components/form';
import { RouterKind, TransitRouterBody, edgeRouterBody, routerDraft, transitRouterBody } from './router-form.logic';

const KIND_LABEL: Record<RouterKind, string> = { 'edge-routers': 'Edge Router', 'transit-routers': 'Transit Router' };

/** Create or edit an edge or transit router. Mount it when opening so the draft starts fresh. */
export const RouterFormDialog: React.FC<{
  kind: RouterKind;
  editing: EdgeRouter | TransitRouter | null;
  onClose: () => void;
  onSaved: (title: string, name: string) => void;
}> = ({ kind, editing, onClose, onSaved }) => {
  const [draft, set] = useDraft(() => routerDraft(editing || undefined));
  const isEdge = kind === 'edge-routers';
  const label = KIND_LABEL[kind];
  const { errors, busy, submit } = useFormSubmit<TransitRouterBody>(
    () => (isEdge ? edgeRouterBody(draft) : transitRouterBody(draft)),
    async (body) => {
      if (editing) await zitiService.patch(kind, editing.id, body);
      else await zitiService.create(kind, body);
      onSaved(editing ? `${label} updated` : `${label} created`, body.name);
    },
    onClose,
  );

  return (
    <ModalDialog open onClose={onClose} title={editing ? `Edit ${label}: ${editing.name}` : `Create ${label}`}>
      <form onSubmit={submit} className="space-y-4 text-xs" noValidate>
        <Field label="Name">
          <input
            required
            autoFocus
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. us-west-edge-01"
            className={inputCls}
          />
        </Field>
        {isEdge && (
          <Field label="Role attributes" hint="Edge router policies select routers by these, e.g. #public.">
            <input value={draft.roleAttributes} onChange={(e) => set('roleAttributes', e.target.value)} className={inputCls} />
          </Field>
        )}
        <Field label="Cost" hint="0–65535. Higher-cost routers are avoided when a cheaper path exists.">
          <input inputMode="numeric" value={draft.cost} onChange={(e) => set('cost', e.target.value)} className={inputCls} />
        </Field>
        <CheckField
          label="No traversal"
          checked={draft.noTraversal}
          onChange={(v) => set('noTraversal', v)}
          hint="Circuits may start or end here but never pass through this router."
        />
        {isEdge && (
          <>
            <CheckField
              label="Tunneler enabled"
              checked={draft.isTunnelerEnabled}
              onChange={(v) => set('isTunnelerEnabled', v)}
              hint="Runs a built-in tunneler with its own identity so the router can host or intercept services."
            />
            <JsonObjectField label="App data" value={draft.appData} onChange={(v) => set('appData', v)} />
          </>
        )}
        <ErrorList errors={errors} />
        <FormActions onCancel={onClose} submitLabel={editing ? 'Save changes' : `Create ${label}`} busy={busy} />
      </form>
    </ModalDialog>
  );
};

/** Shows a router's outstanding enrollment JWT and the command that uses it. */
export const RouterJwtDialog: React.FC<{ router: EdgeRouter | TransitRouter; onClose: () => void }> = ({ router, onClose }) => (
  <ModalDialog open onClose={onClose} title={`Enroll Router: ${router.name}`}>
    <div className="space-y-4 text-xs">
      <p className="m-0 text-[var(--ac-muted)]">
        Copy this one-time token to the router host and enroll it. The router stays offline until it does.
      </p>
      {router.enrollmentJwt ? (
        <JwtPanel jwt={router.enrollmentJwt} fileName={router.name} expiresAt={router.enrollmentExpiresAt} />
      ) : (
        <p className="m-0">This router has no outstanding enrollment token.</p>
      )}
      <pre className="m-0 p-3 rounded-xl bg-[var(--ac-surface-2)] border border-[var(--ac-line)] overflow-x-auto font-mono text-[11px]">
        {`ziti router enroll config.yml --jwt ${router.name}.jwt`}
      </pre>
    </div>
  </ModalDialog>
);
