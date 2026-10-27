import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface Props {
  moduleName: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// Keeps the shell usable when one screen fails, and shows the reason instead of a blank page.
export class ModuleErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.moduleName}] screen failed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto my-12 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
          {this.props.moduleName} could not open
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Reload the page. If it happens again, send this message to the system administrator.
        </p>
        <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          {error.message || String(error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze-500 focus-visible:ring-offset-2"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Reload page
        </button>
      </div>
    );
  }
}
