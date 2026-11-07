import { Component, type ErrorInfo, type ReactNode } from 'react';

/** One view throwing must not blank the whole panel until it is reopened. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[wys] view crashed', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col gap-3 p-3.5">
        <div className="rounded-xl border border-bad-line bg-bad-soft p-3 text-[13px] leading-[18px] text-bad-ink">
          <span className="font-bold text-bad">Something went wrong in this view.</span>
          <br />
          {this.state.error.message}
        </div>
        <button
          className="wys-btn"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        >
          Back to home
        </button>
      </div>
    );
  }
}
