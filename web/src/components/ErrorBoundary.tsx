import React from 'react';

interface State {
  error: Error | null;
}

/** Shows a recoverable error screen instead of a blank page when rendering throws. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[baked-pasta-console] render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center p-6 bg-[var(--ac-bg)] text-[var(--ac-ink)]">
        <div className="max-w-lg w-full space-y-4 p-6 rounded-2xl border border-[var(--ac-bad)] bg-[var(--ac-surface)] text-xs">
          <h1 className="text-lg font-semibold m-0">Something went wrong</h1>
          <p className="m-0 text-[var(--ac-muted)]">
            The console hit an unexpected error. Nothing was sent to the controller because of it.
          </p>
          <pre className="p-3 rounded-lg bg-[var(--ac-surface-2)] border border-[var(--ac-line)] overflow-x-auto whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-3.5 py-2 rounded-lg border border-[var(--ac-line)] bg-[var(--ac-surface-2)] font-medium cursor-pointer"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3.5 py-2 rounded-lg bg-[var(--ac-dial)] text-white font-semibold cursor-pointer"
            >
              Reload console
            </button>
          </div>
        </div>
      </div>
    );
  }
}
