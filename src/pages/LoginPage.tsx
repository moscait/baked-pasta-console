import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { zitiService } from '../services/ziti-service';
import { BakedPastaMark } from '../components/BakedPastaMark';
import { Lock, Play, Server } from 'lucide-react';

export const LoginPage: React.FC<{
  onToast: (level: 'info' | 'success' | 'warning' | 'error', title: string, detail?: string) => void;
}> = ({ onToast }) => {
  const navigate = useNavigate();
  const settings = zitiService.getSettings();
  const [controllerUrl, setControllerUrl] = useState(
    settings.selectedEdgeController || window.location.origin,
  );
  const [authMethod, setAuthMethod] = useState<'password' | 'cert' | 'ext-jwt'>('password');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [extJwt, setExtJwt] = useState('');
  const [busy, setBusy] = useState(false);
  const [originStatus, setOriginStatus] = useState<{ checked: boolean; online: boolean; version?: string }>({
    checked: false,
    online: false,
  });

  useEffect(() => {
    zitiService.probeController(window.location.origin).then((res) => {
      setOriginStatus({ checked: true, online: res.online, version: res.version });
      if (res.online) {
        setControllerUrl(window.location.origin);
      }
    });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await zitiService.login({
        controllerUrl,
        method: authMethod,
        username,
        password,
        extJwt,
      });
      onToast('success', 'Connected to Controller', controllerUrl);
      navigate('/access-canvas');
    } catch (err) {
      onToast('error', 'Authentication failed', zitiService.errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDemo = () => {
    zitiService.enableDemoMode();
    onToast(
      'info',
      'Interactive Demo Sandbox Enabled',
      'Explore the Access Canvas, drag & drop cards, and test the end-to-end Service Wizard.',
    );
    navigate('/access-canvas');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--ac-bg)]">
      <div className="w-full max-w-md rounded-3xl border border-[var(--ac-line)] bg-[var(--ac-surface)] shadow-2xl overflow-hidden">
        <div className="p-6 bg-gradient-to-br from-[var(--ac-dial-soft)] via-[var(--ac-surface)] to-[var(--ac-bind-soft)] border-b border-[var(--ac-line)] space-y-2.5">
          <div className="flex items-center gap-3">
            <BakedPastaMark size={48} />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ac-muted)]">
                Everything ziti needs, layered and baked
              </div>
              <h1 className="text-2xl font-bold tracking-tight m-0">
                <span>baked </span>
                <span className="text-[var(--ac-bind)]">pasta </span>
                <span>console</span>
              </h1>
            </div>
          </div>
          <p className="text-xs text-[var(--ac-muted)] m-0">
            Plug-compatible with <code>openziti/ziti-console</code> (`zac` binding) featuring the interactive Access Canvas &amp; Guided Service Wizards.
          </p>
        </div>

        <form onSubmit={handleLogin} className="p-6 space-y-4 text-xs">
          <label className="block space-y-1">
            <span className="font-medium flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-[var(--ac-dial)]" />
                Edge Controller URL
              </span>
              {originStatus.checked && originStatus.online && (
                <span className="text-[11px] text-[var(--ac-ok)] font-medium">
                  ● Controller detected ({originStatus.version})
                </span>
              )}
            </span>
            <input
              required
              value={controllerUrl}
              onChange={(e) => setControllerUrl(e.target.value)}
              placeholder="https://localhost:1280"
              className="w-full px-3 py-2 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono text-xs"
            />
          </label>

          <div className="space-y-1">
            <span className="font-medium">Authentication Method</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'password', label: 'UPDB Password' },
                  { id: 'cert', label: 'Client Cert' },
                  { id: 'ext-jwt', label: 'External JWT' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAuthMethod(m.id)}
                  className={`py-1.5 px-2 rounded-lg border text-center cursor-pointer ${
                    authMethod === m.id
                      ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)] font-semibold text-[var(--ac-ink)]'
                      : 'border-[var(--ac-line)] text-[var(--ac-muted)]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {authMethod === 'password' && (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="font-medium">Username</span>
                <input
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="font-medium">Password</span>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] text-sm"
                />
              </label>
            </div>
          )}

          {authMethod === 'cert' && (
            <div className="p-3 rounded-xl bg-[var(--ac-surface-2)] border border-[var(--ac-line)] text-[var(--ac-muted)]">
              Your browser will present its client TLS certificate to <code>/edge/management/v1/authenticate?method=cert</code> (or OIDC <code>/oidc/login/cert</code>).
            </div>
          )}

          {authMethod === 'ext-jwt' && (
            <label className="block space-y-1">
              <span className="font-medium">Bearer JWT Token</span>
              <textarea
                required
                rows={3}
                value={extJwt}
                onChange={(e) => setExtJwt(e.target.value)}
                placeholder="eyJhbGciOi..."
                className="w-full px-3 py-2 rounded-xl border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-mono text-xs"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-xl bg-[var(--ac-dial)] text-white font-semibold text-sm shadow-md hover:opacity-95 cursor-pointer flex items-center justify-center gap-2"
          >
            <Lock className="w-4 h-4" />
            <span>{busy ? 'Signing in…' : 'Sign In to Controller'}</span>
          </button>

          <div className="relative py-2 flex items-center justify-center">
            <div className="border-t border-[var(--ac-line)] w-full" />
            <span className="bg-[var(--ac-surface)] px-3 text-[11px] text-[var(--ac-muted)] uppercase tracking-wider">
              or
            </span>
            <div className="border-t border-[var(--ac-line)] w-full" />
          </div>

          <button
            type="button"
            onClick={handleDemo}
            className="w-full py-2.5 rounded-xl border border-[var(--ac-bind)] bg-[var(--ac-bind-soft)] text-[var(--ac-ink)] font-semibold text-xs hover:opacity-95 cursor-pointer flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4 text-[var(--ac-bind)]" />
            <span>Launch Interactive Demo Sandbox (No Controller Required)</span>
          </button>
        </form>
      </div>
    </div>
  );
};
