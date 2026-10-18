import { afterEach, expect, it, vi } from "vitest";
import {
  BrowserBrainAccessBridge,
  BrowserBrainLinkBridge,
  checkHardwareBridge,
  setHardwarePairingCode,
} from "./HardwareBridge";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it("requires pairing before contacting the helper", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(checkHardwareBridge()).rejects.toThrow("pairing code");
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps credentials out of URLs and surfaces authentication errors", async () => {
  setHardwarePairingCode(" code ");
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ error: "Invalid code" }), { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  await expect(checkHardwareBridge()).rejects.toThrow("Invalid code");
  expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:18765/health");
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer code");
});
it("delivers real EEG batches, commands, and stops its owned session", async () => {
  setHardwarePairingCode("code");
  const batch = { sampleCount: 1, values: [[12]] };
  let release: ((value: Response) => void) | undefined;
  let polls = 0;
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      requests.push({ url, ...body });
      if (url.endsWith("/start")) return Response.json({ session: "owned-session" });
      if (url.endsWith("/events")) {
        if (++polls === 1)
          return Response.json({ cursor: 1, events: [{ type: "samples", batch }] });
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return Response.json({});
    }),
  );
  const bridge = new BrowserBrainAccessBridge();
  const listener = vi.fn();
  bridge.subscribeSamples(listener);
  await bridge.start();
  await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(batch));
  await bridge.connect("BA MAXI 009");
  await bridge.startStream();
  await bridge.stop();
  release?.(Response.json({ cursor: 1, events: [] }));
  expect(requests).toContainEqual({
    url: "http://127.0.0.1:18765/brainaccess/command",
    session: "owned-session",
    command: "connect",
    payload: { deviceName: "BA MAXI 009" },
  });
  expect(requests).toContainEqual({
    url: "http://127.0.0.1:18765/brainaccess/stop",
    session: "owned-session",
  });
});
it("reports stream failure rather than replacing hardware data with simulation", async () => {
  setHardwarePairingCode("code");
  let fail: ((reason: Error) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/start")) return Response.json({ session: "s" });
      if (url.endsWith("/events"))
        return new Promise<Response>((_, reject) => {
          fail = reject;
        });
      return Response.json({});
    }),
  );
  const bridge = new BrowserBrainLinkBridge();
  const disconnected = vi.fn();
  bridge.subscribeDisconnected(disconnected);
  await bridge.start();
  fail?.(new Error("offline"));
  await vi.waitFor(() => expect(disconnected).toHaveBeenCalledOnce());
  await expect(bridge.getMetrics()).rejects.toThrow("disconnected");
});

it("claims an ephemeral launch ticket, clears the URL, and maintains a managed lease", async () => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/#kneuron-launch=single-use-ticket");
  const fetch = vi.fn(async (url: string) =>
    Response.json(url.endsWith("/claim") ? { token: "secret-token" } : { managed: true }),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    const { initializeManagedHardwareSession, isManagedHardwareSession } =
      await import("./HardwareBridge");
    await initializeManagedHardwareSession();
    expect(window.location.hash).toBe("");
    expect(sessionStorage.getItem("kneuron-hardware-pairing")).toBe("secret-token");
    expect(isManagedHardwareSession()).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:18765/claim");
    expect((fetch.mock.calls as unknown as [string, RequestInit][])[0][1].headers).toMatchObject({
      Authorization: "Bearer single-use-ticket",
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

it("does not pair or start heartbeats for an invalid launch ticket", async () => {
  window.history.replaceState(null, "", "/#kneuron-launch=expired");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ error: "Launch link expired" }, { status: 401 })),
  );
  const { initializeManagedHardwareSession, isManagedHardwareSession, getManagedHardwareError } =
    await import("./HardwareBridge");
  await initializeManagedHardwareSession();
  expect(isManagedHardwareSession()).toBe(false);
  expect(window.location.hash).toBe("");
  expect(getManagedHardwareError()).toBe("Launch link expired");
});
