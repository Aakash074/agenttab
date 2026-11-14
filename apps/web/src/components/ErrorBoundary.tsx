import { Component, type ReactNode } from 'react';

/** Keeps one broken widget from blanking the whole page. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('UI error', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-2xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn">
        {this.props.label ?? 'This section'} hit an error and was paused. The rest of the page still works.{' '}
        <button className="underline" onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}
