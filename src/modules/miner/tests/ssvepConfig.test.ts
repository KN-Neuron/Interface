import { describe, expect, it } from "vitest";

import {
  TAALON_DEFAULT_TARGETS,
  TAALON_SSVEP_CHANNELS,
  validateTaalonFrequencies,
} from "../../../core/ssvep";

describe("TaaLON SSVEP configuration", () => {
  it("preserves the supplied default frequency-to-command mapping", () => {
    expect(TAALON_DEFAULT_TARGETS).toEqual([
      {
        direction: "UP",
        frequencyHz: 10.25,
      },
      {
        direction: "LEFT",
        frequencyHz: 13.75,
      },
      {
        direction: "RIGHT",
        frequencyHz: 14.25,
      },
      {
        direction: "DOWN",
        frequencyHz: 14.75,
      },
    ]);
  });

  it("uses the six posterior electrodes from the supplied game", () => {
    expect(TAALON_SSVEP_CHANNELS).toEqual(["POz", "PO3", "PO4", "Oz", "O1", "O2"]);
  });

  it("rejects frequencies separated by less than 0.5 Hz", () => {
    expect(() => {
      validateTaalonFrequencies([10.25, 13.75, 14.1, 14.5]);
    }).toThrow();
  });
});
