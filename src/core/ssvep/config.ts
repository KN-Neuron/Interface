import type { SsvepTarget } from "./models";

/**
 * TaaLON defaults from the supplied working project.
 *
 * Order matters because the original game maps the four FBCCA outputs to:
 *
 * 10.25 -> UP
 * 13.75 -> LEFT
 * 14.25 -> RIGHT
 * 14.75 -> DOWN
 */
export const TAALON_DEFAULT_TARGETS: readonly SsvepTarget[] = [
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
] as const;

/**
 * Anatomical channel set used by the supplied TaaLON game.
 *
 * The old project addressed these electrodes using MAXI-specific numeric IDs.
 * KNeuron resolves them by normalized labels instead, so the classifier stays
 * independent of BrainAccess hardware numbering.
 */
export const TAALON_SSVEP_CHANNELS = ["POz", "PO3", "PO4", "Oz", "O1", "O2"] as const;

export const TAALON_DEFAULT_TRIAL_SECONDS = 4;

export const TAALON_MIN_TRIAL_SECONDS = 4;

export const TAALON_MAX_TRIAL_SECONDS = 10;

export const TAALON_TRIAL_STEP_SECONDS = 0.5;

export const TAALON_COUNTDOWN_SECONDS = 2;

export const TAALON_SAMPLE_TIMEOUT_SECONDS = 3;

export function validateTaalonFrequencies(values: readonly number[]): void {
  if (values.length !== 4) {
    throw new Error("Exactly four SSVEP frequencies are required.");
  }

  if (values.some((value) => !Number.isFinite(value) || value < 6 || value > 18)) {
    throw new Error("Each SSVEP frequency must be between 6 and 18 Hz.");
  }

  for (let index = 0; index < values.length; index += 1) {
    for (let other = index + 1; other < values.length; other += 1) {
      if (Math.abs(values[index] - values[other]) < 0.5) {
        throw new Error("SSVEP frequencies must differ by at least 0.5 Hz.");
      }
    }
  }
}
