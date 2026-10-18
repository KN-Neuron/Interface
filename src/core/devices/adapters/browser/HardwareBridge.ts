import type {
  BrainAccessBridgeLike,
  BrainAccessConnectionInfo,
  BrainAccessDiscoveredDevice,
  BrainAccessSampleListener,
  BrainAccessDisconnectListener,
} from "../brainaccess/BrainAccessBridge";
import type {
  BrainLinkBridgeLike,
  BrainLinkConnectionInfo,
  BrainLinkPortInfo,
  BrainLinkMetricsListener,
} from "../brainlink/BrainLinkBridge";
import type { EEGSampleBatch } from "../../../eeg/models";
import type { BrainMetricsSnapshot } from "../../../brainMetrics";

const ENDPOINT = "http://127.0.0.1:18765";
const PAIRING_KEY = "kneuron-hardware-pairing";
export function getHardwarePairingCode(): string {
  return sessionStorage.getItem(PAIRING_KEY) ?? "";
}
export function setHardwarePairingCode(code: string): void {
  sessionStorage.setItem(PAIRING_KEY, code.trim());
}
const MANAGED_KEY = "kneuron-hardware-managed";
let managedError = "";
export function isManagedHardwareSession(): boolean {
  return sessionStorage.getItem(MANAGED_KEY) === "true";
}
export function getManagedHardwareError(): string {
  return managedError;
}

/** Consume a single-use fragment ticket before loading modules; fragments never reach Docker. */
export async function initializeManagedHardwareSession(): Promise<void> {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const ticket = fragment.get("kneuron-launch");
  if (ticket) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    try {
      const result = await call<{ token: string }>("/claim", {}, ticket);
      setHardwarePairingCode(result.token);
      sessionStorage.setItem(MANAGED_KEY, "true");
    } catch (error) {
      sessionStorage.removeItem(MANAGED_KEY);
      managedError = error instanceof Error ? error.message : String(error);
      return;
    }
  }
  if (!isManagedHardwareSession()) return;
  let timer: ReturnType<typeof setInterval> | undefined;
  const heartbeat = async () => {
    try {
      await call("/heartbeat", {}, getHardwarePairingCode());
    } catch (error) {
      if (timer) clearInterval(timer);
      sessionStorage.removeItem(MANAGED_KEY);
      managedError = error instanceof Error ? error.message : String(error);
      window.dispatchEvent(new Event("kneuron:hardware-status"));
    }
  };
  await heartbeat();
  if (isManagedHardwareSession())
    timer = setInterval(() => {
      void heartbeat();
    }, 5_000);
}

export async function checkHardwareBridge(): Promise<void> {
  await call("/health", {}, getHardwarePairingCode());
}
async function call<T>(path: string, body: object, token: string): Promise<T> {
  if (!token) throw new Error("Enter the hardware bridge pairing code in Device settings first.");
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        ["/health", "/heartbeat", "/claim"].includes(path)
          ? 5_000
          : path.endsWith("/events")
            ? 15_000
            : 100_000,
      ),
    });
  } catch {
    throw new Error(
      "Cannot reach the hardware bridge. Start KNeuron Hardware Bridge on this computer and allow Chrome’s local network permission if requested.",
    );
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Hardware bridge request failed.");
  return data as T;
}

interface HardwareEvent {
  type: string;
  batch?: EEGSampleBatch;
  metrics?: BrainMetricsSnapshot;
  reason?: string;
  message?: string;
}
class BrowserTransport {
  private session: string | null = null;
  private token = "";
  private starting: Promise<void> | null = null;
  readonly disconnected = new Set<BrainAccessDisconnectListener>();
  constructor(
    private readonly device: "brainaccess" | "brainlink",
    private readonly event: (event: HardwareEvent) => void,
  ) {}
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.session) return;
    this.starting = this.open();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }
  private async open(): Promise<void> {
    this.token = getHardwarePairingCode();
    const { session } = await call<{ session: string }>(`/${this.device}/start`, {}, this.token);
    this.session = session;
    void this.poll(session);
    try {
      await this.request("ping");
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  async stop(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) await call(`/${this.device}/stop`, { session }, this.token);
  }
  request<T>(command: string, payload: object = {}): Promise<T> {
    if (!this.session) return Promise.reject(new Error("Hardware bridge is disconnected."));
    return call<T>(
      `/${this.device}/command`,
      { session: this.session, command, payload },
      this.token,
    );
  }
  private async poll(session: string): Promise<void> {
    let cursor = 0;
    try {
      while (this.session === session) {
        const result = await call<{ cursor: number; events: HardwareEvent[] }>(
          `/${this.device}/events`,
          { session, cursor },
          this.token,
        );
        if (this.session !== session) return;
        cursor = result.cursor;
        for (const event of result.events) {
          if (event.type === "device-disconnected" || event.type === "bridge-error") {
            throw new Error(event.reason ?? event.message ?? "Bluetooth connection lost.");
          }
          this.event(event);
        }
      }
    } catch (error) {
      if (this.session !== session) return;
      void this.stop().catch(() => {});
      const reason = error instanceof Error ? error.message : String(error);
      for (const listener of this.disconnected) listener(reason);
    }
  }
}
export class BrowserBrainAccessBridge implements BrainAccessBridgeLike {
  private readonly samples = new Set<BrainAccessSampleListener>();
  private readonly transport = new BrowserTransport("brainaccess", (event) => {
    if (event.type === "samples" && event.batch)
      for (const listener of this.samples) listener(event.batch);
  });
  start() {
    return this.transport.start();
  }
  stop() {
    return this.transport.stop();
  }
  scan() {
    return this.transport.request<BrainAccessDiscoveredDevice[]>("scan");
  }
  connect(deviceName: string) {
    return this.transport.request<BrainAccessConnectionInfo>("connect", { deviceName });
  }
  async disconnect() {
    await this.transport.request("disconnect");
  }
  async startStream() {
    await this.transport.request("start_stream");
  }
  async stopStream() {
    await this.transport.request("stop_stream");
  }
  subscribeSamples(listener: BrainAccessSampleListener) {
    this.samples.add(listener);
    return () => {
      this.samples.delete(listener);
    };
  }
  subscribeDisconnected(listener: BrainAccessDisconnectListener) {
    this.transport.disconnected.add(listener);
    return () => {
      this.transport.disconnected.delete(listener);
    };
  }
}
export class BrowserBrainLinkBridge implements BrainLinkBridgeLike {
  private readonly metrics = new Set<BrainLinkMetricsListener>();
  private readonly transport = new BrowserTransport("brainlink", (event) => {
    if (event.type === "metrics" && event.metrics)
      for (const listener of this.metrics) listener(event.metrics);
  });
  start() {
    return this.transport.start();
  }
  stop() {
    return this.transport.stop();
  }
  scan() {
    return this.transport.request<BrainLinkPortInfo[]>("scan");
  }
  connect(port?: string) {
    return this.transport.request<BrainLinkConnectionInfo>("connect", port ? { port } : {});
  }
  async disconnect() {
    await this.transport.request("disconnect");
  }
  getMetrics() {
    return this.transport.request<BrainMetricsSnapshot | null>("get_metrics");
  }
  subscribeMetrics(listener: BrainLinkMetricsListener) {
    this.metrics.add(listener);
    return () => {
      this.metrics.delete(listener);
    };
  }
  subscribeDisconnected(listener: BrainAccessDisconnectListener) {
    this.transport.disconnected.add(listener);
    return () => {
      this.transport.disconnected.delete(listener);
    };
  }
}
