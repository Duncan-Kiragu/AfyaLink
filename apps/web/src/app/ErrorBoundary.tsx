import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Wire @kkd/observability / Sentry in KKD-WEB-001. Do not log clinical text.
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return <p>This page failed to load. Return home and try again.</p>;
    }
    return this.props.children;
  }
}
