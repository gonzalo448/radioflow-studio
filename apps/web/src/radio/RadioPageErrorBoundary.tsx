import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Etiqueta corta para el mensaje (p. ej. "Reproductor"). */
  label?: string;
};

type State = { error: Error | null };

/**
 * Aísla fallos de render para que un bug en metadatos/UI no tumbe toda la página.
 */
export class RadioPageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[RadioPageErrorBoundary] ${this.props.label ?? "radio"}`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="radio-app-error-boundary" role="alert">
          <p>Algo falló en {this.props.label ?? "el reproductor"}.</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
