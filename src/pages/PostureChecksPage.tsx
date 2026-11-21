import React, { useCallback, useEffect, useState } from 'react';
import type { PostureCheck } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';
import { ModalDialog } from '../components/ModalDialog';

export const PostureChecksPage: React.FC<{
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ onToast }) => {
  const [rows, setRows] = useState<PostureCheck[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('MFA');
  const [attrs, setAttrs] = useState('mfa-required');

  const load = useCallback(async () => {
    try {
      setRows(await zitiService.list('posture-checks'));
    } catch (err) {
      onToast('error', 'Load failed', zitiService.errorText(err));
    }
  }, [onToast]);

  useEffect(() => {
    load();
    return zitiService.subscribe(load);
  }, [load]);

  const columns: ColumnDef<PostureCheck>[] = [
    {
      key: 'name',
      header: 'Posture Check Name',
      render: (r) => <span className="font-semibold font-mono">{r.name}</span>,
    },
    {
      key: 'typeId',
      header: 'Check Type',
      render: (r) => (
        <span className="px-2.5 py-0.5 rounded-full bg-[var(--ac-dial-soft)] text-[var(--ac-dial)] text-xs font-semibold">
          {r.typeId}
        </span>
      ),
    },
    {
      key: 'roleAttributes',
      header: 'Role Attributes',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.roleAttributes || []).map((a: string) => (
            <span
              key={a}
              className="px-2 py-0.5 rounded bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-xs"
            >
              #{a}
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight m-0">Posture Checks</h1>
        <p className="text-xs text-[var(--ac-muted)] m-0">
          Continuous device posture verification (MFA, OS version, MAC address, running processes, domain membership).
        </p>
      </div>

      <DataTable
        caption="Posture Checks"
        data={rows}
        columns={columns}
        createLabel="New Posture Check"
        onCreate={() => {
          setName('');
          setTypeId('MFA');
          setAttrs('mfa-required');
          setModalOpen(true);
        }}
        onDelete={async (row) => {
          await zitiService.remove('posture-checks', row.id);
          onToast('info', 'Posture check deleted', row.name);
          await load();
        }}
      />

      <ModalDialog open={modalOpen} onClose={() => setModalOpen(false)} title="Create Posture Check">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const roleAttributes = attrs
              .split(/[,\s]+/)
              .map((s) => s.trim().replace(/^#/, ''))
              .filter(Boolean);
            try {
              await zitiService.create('posture-checks', {
                name: name.trim(),
                typeId,
                roleAttributes,
              });
              onToast('success', 'Posture check created', name.trim());
              setModalOpen(false);
              await load();
            } catch (err) {
              onToast('error', 'Save failed', zitiService.errorText(err));
            }
          }}
          className="space-y-4 text-xs"
        >
          <label className="block space-y-1">
            <span className="font-medium">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Require TOTP MFA"
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Posture Check Type</span>
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
            >
              <option value="MFA">MFA (TOTP)</option>
              <option value="OS">Operating System Version</option>
              <option value="PROCESS">Running Process Hash</option>
              <option value="DOMAIN">Windows Domain</option>
              <option value="MAC">MAC Address</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Role Attributes</span>
            <input
              value={attrs}
              onChange={(e) => setAttrs(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm font-mono"
            />
          </label>
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--ac-line)]">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[var(--ac-line)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
            >
              Create Check
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
};
