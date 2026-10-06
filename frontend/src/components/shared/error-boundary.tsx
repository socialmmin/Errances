'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  // A short label so logs/toasts can say where it happened, e.g. "the employee list".
  label?: string;
}
interface State {
  error: Error | null;
  autoRetries: number;
}

// Code from an older deploy that is no longer on the server (the tab stayed open across a deploy).
const isStaleBuild = (e: Error) => /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(`${e?.name} ${e?.message}`);
// React losing track of a DOM node -- typically a browser extension or auto-translate editing the
// page underneath it. A plain re-render fixes it.
const isDomGlitch = (e: Error) => /removeChild|insertBefore|not a child of this node/i.test(e?.message || '');

// A LOCAL error boundary, scoped to one section of a page instead of the global one
// (src/app/error.tsx) that replaces the ENTIRE page with "Something went wrong". Stale-build
// errors reload the page once; DOM glitches re-render once by themselves; anything else shows
// "Try again" plus the real error text under Details, so a screenshot says what broke.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, autoRetries: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidMount() {
    // A page that has stayed up for a while is healthy: allow one auto-reload again after the next deploy.
    setTimeout(() => { try { if (!this.state.error) sessionStorage.removeItem('crm-stale-reload'); } catch { /* storage blocked */ } }, 15000);
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error);
    if (isStaleBuild(error)) {
      let reloaded = false;
      try { reloaded = sessionStorage.getItem('crm-stale-reload') === '1'; sessionStorage.setItem('crm-stale-reload', '1'); } catch { /* storage blocked */ }
      if (!reloaded) { window.location.reload(); return; }
    }
    if (isDomGlitch(error) && this.state.autoRetries < 1) {
      setTimeout(() => this.setState((s) => ({ error: null, autoRetries: s.autoRetries + 1 })), 50);
    }
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-sm font-semibold text-amber-800">
            {this.props.label ? `${this.props.label} hit a display hiccup.` : 'This section hit a display hiccup.'}
          </p>
          <p className="mt-1 text-xs text-amber-700">Nothing was lost -- try again{isStaleBuild(error) ? ', or reload the page (a newer version was published)' : ''}.</p>
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" onClick={() => this.setState({ error: null })} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700">Try again</button>
            <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100">Reload page</button>
          </div>
          <details className="mx-auto mt-3 max-w-xl text-left text-[11px] text-amber-800">
            <summary className="cursor-pointer text-center font-semibold">Details</summary>
            <p className="mt-1 break-words font-mono">{error.name}: {error.message}</p>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
