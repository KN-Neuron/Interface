import { afterEach, expect, it, vi } from "vitest";
import { HttpSsvepClassifierBridge } from "./HttpSsvepClassifierBridge";

const request = { eeg: [[1, 2]], sampleRateHz: 250, frequencies: [10.25, 13.75, 14.25, 14.75] };
afterEach(() => vi.unstubAllGlobals());

it("posts EEG to the same-origin classifier", async () => {
  const result = {
    winnerHz: 10.25,
    scores: { "10.25": 1 },
    sampleRateHz: 250,
    sampleCount: 2,
    channelCount: 1,
  };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
  vi.stubGlobal("fetch", fetch);
  await expect(new HttpSsvepClassifierBridge().classify(request)).resolves.toEqual(result);
  expect(fetch).toHaveBeenCalledWith(
    "/api/classify",
    expect.objectContaining({ method: "POST", body: JSON.stringify(request) }),
  );
});

it("shows backend errors instead of treating them as classifications", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Classifier is busy." }) }),
  );
  await expect(new HttpSsvepClassifierBridge().classify(request)).rejects.toThrow(
    "Classifier is busy.",
  );
});

it("aborts pending requests on stop", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ),
  );
  const bridge = new HttpSsvepClassifierBridge();
  const pending = bridge.classify(request);
  const assertion = expect(pending).rejects.toThrow("Aborted");
  await bridge.stop();
  await assertion;
});
