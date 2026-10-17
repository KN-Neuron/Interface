import type { SsvepClassifierRequest, SsvepClassifierResponse } from "./SsvepClassifierBridge";

/** Same-origin transport for browser builds served by the container. */
export class HttpSsvepClassifierBridge {
  private readonly active = new Set<AbortController>();

  async classify(request: SsvepClassifierRequest): Promise<SsvepClassifierResponse> {
    const controller = new AbortController();
    this.active.add(controller);
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Classifier failed (${response.status}).`);
      return body as SsvepClassifierResponse;
    } finally {
      clearTimeout(timeout);
      this.active.delete(controller);
    }
  }

  async stop(): Promise<void> {
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }
}
