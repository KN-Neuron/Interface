import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DeviceManagerSnapshot } from "../../../core/devices/deviceManager";

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  getSnapshot: vi.fn(),
  acquire: vi.fn(),
}));
vi.mock("../../../core/devices/deviceManager", () => ({ deviceManager: mocks }));
vi.mock("../../../core/brainMetrics", () => ({ brainMetricsService: mocks }));
import { useBrainMetrics } from "./useBrainMetrics";

it("clears metrics on device loss and reacquires on reconnect", async () => {
  const release = vi.fn();
  const connected = {
    activeDeviceId: "brainlink",
    activeStatus: { state: "connected" },
  } as DeviceManagerSnapshot;
  mocks.getSnapshot.mockReturnValue(connected);
  mocks.acquire.mockImplementation((listener) => {
    listener({ attention: 75 });
    return { deviceId: "brainlink", release };
  });
  const unsubscribe = vi.fn();
  mocks.subscribe.mockReturnValue(unsubscribe);
  const { result, unmount } = renderHook(() => useBrainMetrics());
  await waitFor(() => expect(result.current.metrics?.attention).toBe(75));
  const notify = mocks.subscribe.mock.calls[0][0];
  act(() => notify({ ...connected, activeStatus: { state: "error", error: "Connection lost" } }));
  expect(result.current.state).toBe("unavailable");
  expect(result.current.metrics).toBeNull();
  expect(release).toHaveBeenCalledTimes(1);
  act(() => notify(connected));
  expect(result.current.state).toBe("live");
  expect(mocks.acquire).toHaveBeenCalledTimes(2);
  unmount();
  expect(unsubscribe).toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(2);
});
