import React from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { AcKind, KIND_LABEL } from './access-canvas.logic';
import { KINDS } from './canvas-page.shared';
import type { NewGroupDraft } from './useBoardCommands';

/** Name a new, initially empty role-attribute group placed on the canvas. */
export const NewGroupDialog: React.FC<{
  group: NewGroupDraft;
  onChange: (g: NewGroupDraft) => void;
  onClose: () => void;
  onSubmit: (g: NewGroupDraft) => void;
}> = ({ group, onChange, onClose, onSubmit }) => (
  <ModalDialog open onClose={onClose} title="New role attribute group">
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(group);
      }}
      className="space-y-4 text-xs"
    >
      <p className="text-[var(--ac-muted)] m-0">
        A group is a role attribute. It starts empty in your browser layout until you drag or paste cards into it.
      </p>
      <label className="block space-y-1">
        <span>Holds</span>
        <select
          value={group.kind}
          onChange={(e) => onChange({ ...group, kind: e.target.value as AcKind })}
          className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k][1]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span>Attribute name</span>
        <input
          value={group.attr}
          onChange={(e) => onChange({ ...group, attr: e.target.value })}
          placeholder="e.g. sales or db-servers"
          autoFocus
          className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
        />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--ac-line)] cursor-pointer">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!group.attr.trim()}
          className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer disabled:opacity-50"
        >
          Add group
        </button>
      </div>
    </form>
  </ModalDialog>
);
