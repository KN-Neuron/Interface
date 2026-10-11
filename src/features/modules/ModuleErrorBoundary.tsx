import { Component, type ErrorInfo, type ReactNode } from "react";

import { moduleManager } from "./moduleManager";

interface ModuleErrorBoundaryProps {
  moduleId: string;

  onReturnToDashboard: () => void;

  children: ReactNode;
}

interface ModuleErrorBoundaryState {
  hasError: boolean;

  message?: string;
}

/**
 * Isolates rendering failures inside an individual KNeuron module.
 *
 * A broken module must never take down the global shell.
 */
export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  state: ModuleErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(error: Error): ModuleErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[KNeuron] Module "${this.props.moduleId}" crashed.`, error, info);

    try {
      moduleManager.fail(this.props.moduleId, error);
    } catch (managerError) {
      console.error("[KNeuron] Failed to update module runtime after crash.", managerError);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="module-error">
          <h1>Module failed</h1>

          <p>KNeuron isolated the module failure. The desktop shell is still running normally.</p>

          {this.state.message && <code>{this.state.message}</code>}

          <button type="button" className="primary-button" onClick={this.props.onReturnToDashboard}>
            Return to Dashboard
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}
