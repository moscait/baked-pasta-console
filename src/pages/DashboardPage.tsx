import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Config } from '../services/api-types';
import { zitiService } from '../services/ziti-service';
import { AcService, accessSet, advise, clients } from '../features/access-canvas/access-canvas.logic';
import { emptyLayout } from '../features/access-canvas/canvas-board.logic';
import { collectProblems } from '../features/access-canvas/problem-rows';
import { describeServiceEndpoint } from '../features/services/service-configs';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Globe,
  KeyRound,
  Network,
  Router as RouterIcon,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({
    identities: 0,
    identitiesOnline: 0,
    services: 0,
    routers: 0,
    routersOnline: 0,
    servicePolicies: 0,
    configs: 0,
    sessions: 0,
    accessPairs: 0,
    problems: 0,
  });
  const [configs, setConfigs] = useState<Config[]>([]);
  const [recentServices, setRecentServices] = useState<AcService[]>([]);
  const [sampleAdvice, setSampleAdvice] = useState<{ identity: string; service: string; ok: boolean }[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [m, cfgs, sess] = await Promise.all([
          zitiService.loadCanvasModel(),
          zitiService.list('configs'),
          zitiService.list('sessions'),
        ]);
        // Same audit as the Access Canvas, so both pages report the same number. Layout only
        // affects presentation, not which items have problems.
        const probCount = collectProblems(m, emptyLayout()).total;

        setCounts({
          identities: m.identities.length,
          identitiesOnline: m.identities.filter((i) => i.online).length,
          services: m.services.length,
          routers: m.routers.length,
          routersOnline: m.routers.filter((r) => r.online).length,
          servicePolicies: m.servicePolicies.length,
          configs: cfgs.length,
          sessions: sess.length,
          accessPairs: accessSet(m).size,
          problems: probCount,
        });
        setConfigs(cfgs);
        setRecentServices(m.services.slice(0, 5));

        const cl = clients(m).slice(0, 4);
        const pairs: { identity: string; service: string; ok: boolean }[] = [];
        for (const i of cl) {
          for (const s of m.services.slice(0, 2)) {
            const steps = advise(m, i, s);
            pairs.push({
              identity: i.name,
              service: s.name,
              ok: !steps.some((st) => st.st === 'bad'),
            });
          }
        }
        setSampleAdvice(pairs.slice(0, 6));
      } catch {
        // ignore
      }
    };
    load();
    return zitiService.subscribe(load);
  }, []);

  const cards = [
    {
      label: 'Identities',
      value: counts.identities,
      sub: `${counts.identitiesOnline} connected`,
      icon: Users,
      color: 'var(--ac-dial)',
      route: '/identities',
    },
    {
      label: 'Services',
      value: counts.services,
      sub: `${counts.configs} configurations`,
      icon: Server,
      color: 'var(--ac-bind)',
      route: '/services',
    },
    {
      label: 'Edge Routers',
      value: counts.routers,
      sub: `${counts.routersOnline} online`,
      icon: RouterIcon,
      color: 'var(--ac-router)',
      route: '/routers',
    },
    {
      label: 'Service Policies',
      value: counts.servicePolicies,
      sub: `${counts.accessPairs} active dial pairs`,
      icon: ShieldCheck,
      color: 'var(--ac-ok)',
      route: '/service-policies',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="p-6 rounded-2xl border border-[var(--ac-line)] bg-gradient-to-br from-[var(--ac-dial-soft)] via-[var(--ac-surface)] to-[var(--ac-bind-soft)] shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--ac-surface)] border border-[var(--ac-line)] text-[11px] font-semibold text-[var(--ac-dial)]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Baked Pasta Console · Plug-Compatible OpenZiti ZAC</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight m-0">Zero-Trust Overlay Network Overview</h1>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Manage identities, services, configurations, and policies visually on the Access Canvas or via guided end-to-end wizards.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate('/access-canvas')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--ac-dial)] text-white text-xs font-semibold shadow-md hover:opacity-95 cursor-pointer"
          >
            <Network className="w-4 h-4" />
            <span>Open Access Canvas</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          {counts.problems > 0 && (
            <button
              type="button"
              onClick={() => navigate('/access-canvas')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[var(--ac-bad-soft)] border border-[var(--ac-bad)]/40 text-[var(--ac-bad)] text-xs font-semibold cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>{counts.problems === 1 ? '1 item needs attention' : `${counts.problems} items need attention`}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => navigate(c.route)}
              className="p-5 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] hover:border-[var(--ac-dial)] shadow-sm text-left flex items-start justify-between cursor-pointer transition-all group"
            >
              <div className="space-y-1">
                <div className="text-xs font-medium text-[var(--ac-muted)]">{c.label}</div>
                <div className="text-3xl font-bold tracking-tight">{c.value}</div>
                <div className="text-xs text-[var(--ac-muted)]">{c.sub}</div>
              </div>
              <div
                style={{ color: c.color }}
                className="w-10 h-10 rounded-xl bg-[var(--ac-surface-2)] inline-grid place-items-center group-hover:scale-105 transition-transform"
              >
                <Icon className="w-5 h-5" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Two Column Panel: Published Services & Reachability Matrix Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold m-0 flex items-center gap-2">
              <Globe className="w-4 h-4 text-[var(--ac-bind)]" />
              <span>Published Zero-Trust Services</span>
            </h2>
            <button
              type="button"
              onClick={() => navigate('/services')}
              className="text-xs text-[var(--ac-dial)] hover:underline cursor-pointer"
            >
              View all →
            </button>
          </div>
          <div className="divide-y divide-[var(--ac-line)] text-xs">
            {recentServices.map((s) => {
              const ep = describeServiceEndpoint(s, configs);
              return (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-semibold font-mono truncate">{s.name}</div>
                    {ep.url ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <a
                          href={ep.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono font-medium text-[var(--ac-dial)] hover:underline"
                        >
                          <span>{ep.url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                        {ep.hostDisplay && (
                          <span className="font-mono text-[11px] text-[var(--ac-muted)]">→ {ep.hostDisplay}</span>
                        )}
                      </div>
                    ) : ep.interceptDisplay ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[var(--ac-muted)]">
                        <span className="text-[var(--ac-ink)]">{ep.interceptDisplay}</span>
                        {ep.hostDisplay && <span className="text-[11px]">→ {ep.hostDisplay}</span>}
                      </div>
                    ) : null}
                    <div className="text-[var(--ac-muted)]">
                      {s.attrs?.length ? s.attrs.map((a: string) => `#${a}`).join(', ') : 'no attributes'}
                    </div>
                  </div>
                  <span className="shrink-0 px-2 py-0.5 rounded-full bg-[var(--ac-ok-soft)] text-[var(--ac-ok)] text-[11px] font-medium">
                    E2E Encrypted
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold m-0 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--ac-ok)]" />
              <span>Live Path Reachability Check</span>
            </h2>
            <button
              type="button"
              onClick={() => navigate('/access-canvas')}
              className="text-xs text-[var(--ac-dial)] hover:underline cursor-pointer"
            >
              Open Advisor →
            </button>
          </div>
          <div className="divide-y divide-[var(--ac-line)] text-xs">
            {sampleAdvice.map((p, idx) => (
              <div key={idx} className="py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono">
                  <span>{p.identity}</span>
                  <span className="text-[var(--ac-muted)]">→</span>
                  <span>{p.service}</span>
                </div>
                {p.ok ? (
                  <span className="inline-flex items-center gap-1 text-[var(--ac-ok)] font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Dial & Route OK</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[var(--ac-muted)]">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>No policy / route</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
