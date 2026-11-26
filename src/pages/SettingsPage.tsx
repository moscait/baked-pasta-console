import React, { useEffect, useState } from 'react';
import { zitiService } from '../services/ziti-service';
import { Monitor, Moon, RotateCcw, Server, Sun } from 'lucide-react';

type ThemeSetting = 'light dark' | 'light' | 'dark';

export const SettingsPage: React.FC<{
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ onToast }) => {
  const settings = zitiService.getSettings();
  const [controllerUrl, setControllerUrl] = useState(settings.selectedEdgeController);
  const [theme, setTheme] = useState<ThemeSetting>(() => {
    try {
      return (localStorage.getItem('color-scheme') as ThemeSetting) || 'light dark';
    } catch {
      return 'light dark';
    }
  });

  useEffect(() => {
    const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
    if (meta) meta.content = theme;
    try {
      if (theme === 'light dark') localStorage.removeItem('color-scheme');
      else localStorage.setItem('color-scheme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight m-0">Console & Controller Settings</h1>
        <p className="text-xs text-[var(--ac-muted)] m-0">
          Configure your OpenZiti Edge Controller connection, theme preference, and ZAC binding compatibility.
        </p>
      </div>

      {/* Theme Selection (Modern Web Guidance 3-state control in Settings surface) */}
      <section className="p-5 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold m-0">Appearance & Color Scheme</h2>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Follow your operating system&apos;s light/dark preference automatically or pin an explicit scheme.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Color scheme">
          {(
            [
              { id: 'light dark', label: 'System Default', icon: Monitor },
              { id: 'light', label: 'Light Mode', icon: Sun },
              { id: 'dark', label: 'Dark Mode', icon: Moon },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(opt.id)}
                className={`flex items-center gap-3 p-3.5 rounded-xl border text-xs font-medium cursor-pointer transition-all ${
                  active
                    ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] text-[var(--ac-ink)] font-semibold'
                    : 'border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] hover:text-[var(--ac-ink)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Edge Controller Connection */}
      <section className="p-5 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] space-y-4 text-xs">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold m-0 flex items-center gap-2">
            <Server className="w-4 h-4 text-[var(--ac-dial)]" />
            <span>OpenZiti Edge Controller Binding</span>
          </h2>
          <p className="text-[var(--ac-muted)] m-0">
            Baked Pasta Console is plug-compatible with <code>openziti/ziti-console</code> and reads/writes <code>localStorage[&apos;ziti.settings&apos;]</code>.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={controllerUrl}
            onChange={(e) => setControllerUrl(e.target.value)}
            placeholder="https://controller:1280"
            className="flex-1 min-w-64 px-3 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => {
              const url = controllerUrl.trim().replace(/\/+$/, '');
              if (!URL.canParse(url) || !['https:', 'http:'].includes(new URL(url).protocol)) {
                onToast('error', 'Invalid controller URL', 'Use a full URL such as https://controller.example.com:1280');
                return;
              }
              zitiService.saveSettings({ selectedEdgeController: url });
              onToast('success', 'Controller URL updated', url);
            }}
            className="px-4 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
          >
            Save Controller URL
          </button>
        </div>

        {zitiService.isDemoMode() && (
          <div className="p-4 rounded-xl bg-[var(--ac-surface-2)] border border-[var(--ac-line)] flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Interactive Demo Sandbox Active</div>
              <div className="text-[var(--ac-muted)]">
                Reset the sample zero-trust network (Identities, Services, Routers, Policies, and Canvas Layout) back to defaults.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                zitiService.resetDemoStore();
                onToast('success', 'Demo Sandbox Reset', 'Restored initial OpenZiti sample entities.');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface)] font-medium cursor-pointer hover:border-[var(--ac-muted)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Demo Data</span>
            </button>
          </div>
        )}
      </section>

      {/* OpenZiti Controller YAML reference */}
      <section className="p-5 rounded-2xl border border-[var(--ac-line)] bg-[var(--ac-surface)] space-y-3 text-xs">
        <h2 className="text-sm font-semibold m-0">Hosting directly from an OpenZiti Controller (`zac` binding)</h2>
        <p className="text-[var(--ac-muted)] m-0">
          Build with <code>npm run package:zac</code> (or <code>./build.sh /zac/</code>) and point your OpenZiti controller configuration&apos;s <code>zac</code> binding to the generated static assets:
        </p>
        <pre className="p-3.5 rounded-xl bg-[var(--ac-surface-2)] border border-[var(--ac-line)] font-mono text-[11px] overflow-x-auto">
{`web:
  - name: client-management
    bindPoints:
      - interface: 0.0.0.0:1280
        address: 0.0.0.0:1280
    apis:
      - binding: edge-management
        options: {}
      - binding: edge-client
        options: {}
      - binding: zac
        options:
          location: /opt/openziti/share/console
          indexFile: index.html`}
        </pre>
      </section>
    </div>
  );
};
