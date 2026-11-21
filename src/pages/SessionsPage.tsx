import React, { useCallback, useEffect, useState } from 'react';
import type { ApiSession, Session } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { DataTable, ColumnDef } from '../components/DataTable';

export const SessionsPage: React.FC<{
  initialTab?: 'sessions' | 'api-sessions';
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ initialTab = 'sessions', onToast }) => {
  const [tab, setTab] = useState<'sessions' | 'api-sessions'>(initialTab);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [apiSessions, setApiSessions] = useState<ApiSession[]>([]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([zitiService.list('sessions'), zitiService.list('api-sessions')]);
      setSessions(s);
      setApiSessions(a);
    } catch (err) {
      onToast('error', 'Load failed', zitiService.errorText(err));
    }
  }, [onToast]);

  useEffect(() => {
    load();
    return zitiService.subscribe(load);
  }, [load]);

  const sessCols: ColumnDef<Session>[] = [
    { key: 'id', header: 'Session ID', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    {
      key: 'service',
      header: 'Service',
      getValue: (r) => r.service?.name || r.serviceId || '',
      render: (r) => <span className="font-semibold font-mono">{r.service?.name || r.serviceId}</span>,
    },
    { key: 'type', header: 'Type', render: (r) => <span className="text-xs">{r.type || 'Dial'}</span> },
    {
      key: 'createdAt',
      header: 'Created',
      render: (r) => <span className="text-xs text-[var(--ac-muted)]">{r.createdAt}</span>,
    },
  ];

  const apiSessCols: ColumnDef<ApiSession>[] = [
    { key: 'id', header: 'API Session ID', render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    {
      key: 'identity',
      header: 'Identity',
      getValue: (r) => r.identity?.name || r.identityId || '',
      render: (r) => <span className="font-semibold font-mono">{r.identity?.name || r.identityId}</span>,
    },
    {
      key: 'ipAddress',
      header: 'Client IP',
      render: (r) => <code className="text-xs">{r.ipAddress || '—'}</code>,
    },
    {
      key: 'lastActivityAt',
      header: 'Last Activity',
      render: (r) => <span className="text-xs text-[var(--ac-muted)]">{r.lastActivityAt || r.createdAt}</span>,
    },
  ];

  const headerTabs = (
    <div className="inline-flex rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface)] p-1 text-xs">
      <button
        type="button"
        onClick={() => setTab('sessions')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'sessions' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        Service Sessions ({sessions.length})
      </button>
      <button
        type="button"
        onClick={() => setTab('api-sessions')}
        className={`px-3 py-1.5 rounded-lg cursor-pointer ${
          tab === 'api-sessions' ? 'bg-[var(--ac-dial)] text-white font-semibold' : 'text-[var(--ac-muted)]'
        }`}
      >
        API Sessions ({apiSessions.length})
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight m-0">Active Sessions</h1>
        <p className="text-xs text-[var(--ac-muted)] m-0">
          Real-time Edge Service Sessions and authenticated API Sessions.
        </p>
      </div>

      {tab === 'sessions' ? (
        <DataTable
          caption="Service Sessions"
          data={sessions}
          columns={sessCols}
          headerTabs={headerTabs}
          onDelete={async (row) => {
            await zitiService.remove('sessions', row.id);
            onToast('info', 'Session terminated', row.id);
            await load();
          }}
        />
      ) : (
        <DataTable
          caption="API Sessions"
          data={apiSessions}
          columns={apiSessCols}
          headerTabs={headerTabs}
          onDelete={async (row) => {
            await zitiService.remove('api-sessions', row.id);
            onToast('info', 'API Session revoked', row.id);
            await load();
          }}
        />
      )}
    </div>
  );
};
