import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { zitiService } from './services/ziti-service';
import { LoginPage } from './pages/LoginPage';
import { BakedPastaMark } from './components/BakedPastaMark';
import { ErrorBoundary } from './components/ErrorBoundary';

// Route-level code splitting: each page (and React Flow, via the canvas) loads on first visit.
const AccessCanvasPage = lazy(() =>
  import('./features/access-canvas/AccessCanvasPage').then((m) => ({ default: m.AccessCanvasPage })),
);
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const IdentitiesPage = lazy(() => import('./pages/IdentitiesPage').then((m) => ({ default: m.IdentitiesPage })));
const ServicesPage = lazy(() => import('./pages/ServicesPage').then((m) => ({ default: m.ServicesPage })));
const RoutersPage = lazy(() => import('./pages/RoutersPage').then((m) => ({ default: m.RoutersPage })));
const PoliciesPage = lazy(() => import('./pages/PoliciesPage').then((m) => ({ default: m.PoliciesPage })));
const PostureChecksPage = lazy(() =>
  import('./pages/PostureChecksPage').then((m) => ({ default: m.PostureChecksPage })),
);
const AuthenticationPage = lazy(() =>
  import('./pages/AuthenticationPage').then((m) => ({ default: m.AuthenticationPage })),
);
const SessionsPage = lazy(() => import('./pages/SessionsPage').then((m) => ({ default: m.SessionsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AttributesPage = lazy(() => import('./pages/AttributesPage').then((m) => ({ default: m.AttributesPage })));
const NetworkMapPage = lazy(() => import('./pages/NetworkMapPage').then((m) => ({ default: m.NetworkMapPage })));
const ConfigBuilderPage = lazy(() =>
  import('./pages/ConfigBuilderPage').then((m) => ({ default: m.ConfigBuilderPage })),
);
import { QUICK_ADD_ITEMS, quickAddHref } from './components/useCreateIntent';
import {
  Activity,
  FileCode2,
  Globe2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Network,
  Plus,
  Router as RouterIcon,
  Server,
  Settings,
  ShieldCheck,
  Tags,
  UserCheck,
  Users,
  X,
} from 'lucide-react';

interface ToastMsg {
  id: number;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

interface NavItem {
  label: string;
  hint: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: string[];
}

const AppShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  // On a genuine first visit, decide between the Demo Sandbox and sign-in. If this page is
  // served by an OpenZiti controller (the `zac` binding), its own origin answers the
  // management API, so go to sign-in rather than showing demo data in front of a real network.
  const [checkingOrigin, setCheckingOrigin] = useState(
    () => zitiService.firstVisit && !zitiService.isAuthenticated(),
  );

  useEffect(() => zitiService.subscribe(() => setTick((t) => t + 1)), []);

  useEffect(() => {
    if (!checkingOrigin) return;
    let cancelled = false;
    zitiService.probeController(window.location.origin).then((probe) => {
      if (cancelled) return;
      if (!probe.online && !zitiService.isAuthenticated()) zitiService.enableDemoMode();
      setCheckingOrigin(false);
    });
    return () => {
      cancelled = true;
    };
  }, [checkingOrigin]);

  // Reads auth state when the effect runs (not during render), so a demo session enabled by
  // the effect above is already visible here. After a logout or an expired session this goes
  // to the login page instead of silently swapping a real controller for demo data.
  useEffect(() => {
    if (checkingOrigin) return;
    if (!zitiService.isAuthenticated() && location.pathname !== '/login') navigate('/login', { replace: true });
  }, [tick, checkingOrigin, location.pathname, navigate]);

  const handleLogout = () => {
    zitiService.logout();
    addToast('info', 'Signed out', 'Your controller session was removed from this browser.');
  };

  const addToast = useCallback(
    (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, level, title, detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4800);
    },
    [],
  );

  if (checkingOrigin) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--ac-bg)] text-xs text-[var(--ac-muted)]">
        Looking for an OpenZiti controller…
      </div>
    );
  }

  if (location.pathname === '/login') {
    return (
      <>
        <LoginPage onToast={addToast} />
        <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />
      </>
    );
  }

  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Overview & Canvas',
      items: [
        {
          label: 'Access Canvas',
          hint: 'Visual drag-and-drop policy board, 4-step guided service wizard, and reachability advisor.',
          route: '/access-canvas',
          icon: Network,
        },
        {
          label: 'Dashboard',
          hint: 'Network health summary, entity counts, and quick actions.',
          route: '/dashboard',
          icon: LayoutDashboard,
        },
        {
          label: 'Network Map',
          hint: 'Routers and identities on a world map, link latency, and live circuits from client to host.',
          route: '/network-map',
          icon: Globe2,
          match: ['/network-map', '/geolocate'],
        },
      ],
    },
    {
      label: 'Core Components',
      items: [
        {
          label: 'Identities',
          hint: 'Users, devices, and hosting servers with one-time JWT & QR enrollment tokens.',
          route: '/identities',
          icon: Users,
          match: ['/identities'],
        },
        {
          label: 'Services',
          hint: 'Zero-trust services, intercept & host configurations, config types, and live terminators.',
          route: '/services',
          icon: Server,
          match: ['/services', '/configs', '/config-types', '/terminators'],
        },
        {
          label: 'Routers',
          hint: 'Edge and transit routers that carry encrypted overlay traffic.',
          route: '/routers',
          icon: RouterIcon,
          match: ['/routers', '/transit-routers'],
        },
      ],
    },
    {
      label: 'Access Rules',
      items: [
        {
          label: 'Policies',
          hint: 'Dial & Bind service policies, edge router policies, and service router policies.',
          route: '/service-policies',
          icon: ShieldCheck,
          match: ['/service-policies', '/router-policies', '/service-router-policies'],
        },
        {
          label: 'Posture Checks',
          hint: 'Client compliance checks (MFA, OS version, MAC address, domain) enforced on connect.',
          route: '/posture-checks',
          icon: UserCheck,
          match: ['/posture-checks'],
        },
        {
          label: 'Attributes',
          hint: 'Every #attribute: who carries it, which policies select it, and policies that select nothing.',
          route: '/attributes',
          icon: Tags,
        },
      ],
    },
    {
      label: 'Management',
      items: [
        {
          label: 'Authentication',
          hint: 'Certificate authorities, authentication policies, and external JWT/OIDC signers.',
          route: '/certificate-authorities',
          icon: KeyRound,
          match: ['/certificate-authorities', '/auth-policies', '/jwt-signers'],
        },
        {
          label: 'Sessions',
          hint: 'Live Dial/Bind overlay sessions and active Edge Management API sessions.',
          route: '/sessions',
          icon: Activity,
          match: ['/sessions', '/api-sessions'],
        },
        {
          label: 'Config Builder',
          hint: 'Build or edit controller and router YAML config files with validation and a live preview.',
          route: '/config-builder',
          icon: FileCode2,
        },
        {
          label: 'Settings',
          hint: 'Controller connection settings, OIDC session status, and Demo Sandbox controls.',
          route: '/settings',
          icon: Settings,
          match: ['/settings', '/servers', '/profile'],
        },
      ],
    },
  ];

  const isSelected = (route: string, match?: string[]) => {
    const list = match || [route];
    return list.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'));
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--ac-bg)] text-[var(--ac-ink)]">
      {/* Sidebar Navigation */}
      <aside className="relative z-30 w-full lg:w-64 flex-none border-b lg:border-b-0 lg:border-r border-[var(--ac-line)] bg-[var(--ac-surface)] flex flex-col justify-between">
        <div className="p-4 space-y-5">
          {/* Brand Logo */}
          <div className="flex items-center justify-between">
            <Link to="/access-canvas" className="flex items-center gap-2.5 no-underline text-[var(--ac-ink)]">
              <BakedPastaMark size={38} className="flex-none" />
              <div>
                <div className="font-bold text-sm tracking-tight leading-tight">
                  <span>baked </span>
                  <span className="text-[var(--ac-bind)]">pasta</span>
                </div>
                <div className="text-[11px] text-[var(--ac-muted)] font-mono">console · openziti</div>
              </div>
            </Link>
          </div>

          <QuickAdd />

          {/* Nav Links */}
          <nav className="space-y-4" aria-label="Main Navigation">
            {navGroups.map((g) => (
              <div key={g.label} className="space-y-1">
                <div className="px-2.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--ac-muted)]">
                  {g.label}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1">
                  {g.items.map((item) => {
                    const Icon = item.icon;
                    const active = isSelected(item.route, item.match);
                    return (
                      <Link
                        key={item.route}
                        to={item.route}
                        aria-describedby={`nav-hint-${item.route}`}
                        className={`group relative flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium no-underline transition-all ${
                          active
                            ? 'bg-[var(--ac-dial-soft)] text-[var(--ac-dial)] font-semibold shadow-2xs'
                            : 'text-[var(--ac-muted)] hover:text-[var(--ac-ink)] hover:bg-[var(--ac-surface-2)]'
                        }`}
                      >
                        <Icon className="w-4 h-4 flex-none" />
                        <span>{item.label}</span>
                        <span
                          id={`nav-hint-${item.route}`}
                          role="tooltip"
                          className="pointer-events-none absolute top-full left-0 mt-1.5 lg:mt-0 lg:left-full lg:top-1/2 lg:-translate-y-1/2 lg:ml-3 z-50 w-60 p-2.5 rounded-xl bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-2xl text-[11px] font-normal text-[var(--ac-ink)] leading-snug opacity-0 invisible translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:visible group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:visible group-focus-visible:translate-x-0"
                        >
                          <span className="block font-semibold text-[var(--ac-ink)] mb-0.5">{item.label}</span>
                          <span className="block text-[var(--ac-muted)]">{item.hint}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Controller Status Footer */}
        <div className="p-4 border-t border-[var(--ac-line)] bg-[var(--ac-surface-2)]/60 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium truncate">
              <span className="w-2 h-2 rounded-full bg-[var(--ac-ok)] flex-none" />
              <span className="truncate font-mono text-[11px]" title={zitiService.controllerUrl()}>
                {zitiService.isDemoMode() ? 'Demo Sandbox' : zitiService.controllerHost()}
              </span>
            </span>
            <span className="text-[10.5px] font-mono text-[var(--ac-muted)]">{zitiService.controllerVersion}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-[11px] font-medium hover:border-[var(--ac-muted)] cursor-pointer"
            >
              <Server className="w-3.5 h-3.5" />
              <span>{zitiService.isDemoMode() ? 'Connect Controller' : 'Switch Controller'}</span>
            </button>
            {!zitiService.isDemoMode() && (
              <button
                type="button"
                onClick={handleLogout}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] text-[11px] font-medium hover:border-[var(--ac-bad)] hover:text-[var(--ac-bad)] cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log out</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 flex flex-col">
        <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<div className="text-xs text-[var(--ac-muted)] p-4">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/access-canvas" replace />} />
          <Route path="/access-canvas" element={<AccessCanvasPage onToast={addToast} />} />
          <Route path="/network-visualizer" element={<AccessCanvasPage onToast={addToast} />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/identities/*" element={<IdentitiesPage onToast={addToast} />} />
          <Route path="/services/*" element={<ServicesPage initialTab="services" onToast={addToast} />} />
          <Route path="/configs/*" element={<ServicesPage initialTab="configs" onToast={addToast} />} />
          <Route path="/config-types/*" element={<ServicesPage initialTab="config-types" onToast={addToast} />} />
          <Route path="/terminators/*" element={<ServicesPage initialTab="terminators" onToast={addToast} />} />
          <Route path="/routers/*" element={<RoutersPage initialTab="edge-routers" onToast={addToast} />} />
          <Route path="/transit-routers/*" element={<RoutersPage initialTab="transit-routers" onToast={addToast} />} />
          <Route
            path="/service-policies/*"
            element={<PoliciesPage initialTab="service-policies" onToast={addToast} />}
          />
          <Route
            path="/router-policies/*"
            element={<PoliciesPage initialTab="edge-router-policies" onToast={addToast} />}
          />
          <Route
            path="/service-router-policies/*"
            element={<PoliciesPage initialTab="service-edge-router-policies" onToast={addToast} />}
          />
          <Route path="/posture-checks/*" element={<PostureChecksPage onToast={addToast} />} />
          <Route
            path="/certificate-authorities/*"
            element={<AuthenticationPage initialTab="cas" onToast={addToast} />}
          />
          <Route
            path="/auth-policies/*"
            element={<AuthenticationPage initialTab="auth-policies" onToast={addToast} />}
          />
          <Route
            path="/jwt-signers/*"
            element={<AuthenticationPage initialTab="external-jwt-signers" onToast={addToast} />}
          />
          <Route path="/sessions/*" element={<SessionsPage initialTab="sessions" onToast={addToast} />} />
          <Route path="/api-sessions/*" element={<SessionsPage initialTab="api-sessions" onToast={addToast} />} />
          <Route path="/network-map" element={<NetworkMapPage onToast={addToast} />} />
          <Route path="/geolocate" element={<Navigate to="/network-map" replace />} />
          <Route path="/attributes" element={<AttributesPage onToast={addToast} />} />
          <Route path="/config-builder" element={<ConfigBuilderPage />} />
          <Route path="/settings/*" element={<SettingsPage onToast={addToast} />} />
          <Route path="/servers/*" element={<SettingsPage onToast={addToast} />} />
          <Route path="/profile/*" element={<SettingsPage onToast={addToast} />} />
          <Route path="*" element={<Navigate to="/access-canvas" replace />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />
    </div>
  );
};

/** "Quick add" menu: jumps to a page and opens its create dialog (`?new=<intent>`). */
const QuickAdd: React.FC = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const menuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--ac-dial)] text-white text-xs font-semibold shadow-sm hover:opacity-95 cursor-pointer"
      >
        <Plus className="w-4 h-4" />
        <span>Quick add</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 lg:right-auto lg:w-72 top-full mt-1.5 z-50 p-1.5 rounded-xl bg-[var(--ac-surface)] border border-[var(--ac-line)] shadow-2xl text-xs"
        >
          {QUICK_ADD_ITEMS.map((item) => (
            <button
              key={item.intent}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate(quickAddHref(item));
              }}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--ac-surface-2)] cursor-pointer"
            >
              <span className="block font-semibold text-[var(--ac-ink)]">{item.label}</span>
              <span className="block text-[11px] text-[var(--ac-muted)]">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ToastStack: React.FC<{ toasts: ToastMsg[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const border =
          t.level === 'error'
            ? 'border-[var(--ac-bad)] bg-[var(--ac-bad-soft)]'
            : t.level === 'warning'
              ? 'border-[var(--ac-pending)] bg-[var(--ac-pending-soft)]'
              : t.level === 'success'
                ? 'border-[var(--ac-ok)] bg-[var(--ac-ok-soft)]'
                : 'border-[var(--ac-dial)] bg-[var(--ac-surface)]';
        return (
          <div
            key={t.id}
            className={`pointer-events-auto p-3.5 rounded-xl border ${border} shadow-xl text-xs flex items-start justify-between gap-3`}
          >
            <div className="space-y-0.5">
              <div className="font-semibold text-[var(--ac-ink)]">{t.title}</div>
              {t.detail && <div className="text-[var(--ac-muted)]">{t.detail}</div>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="text-[var(--ac-muted)] hover:text-[var(--ac-ink)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export function App() {
  // Automatically infer basename if deployed under /zac/ on an OpenZiti Controller
  const basename =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/zac') ? '/zac' : '/';
  return (
    <BrowserRouter basename={basename}>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
