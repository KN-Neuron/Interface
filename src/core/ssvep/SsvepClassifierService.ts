import { TAALON_DEFAULT_TARGETS, validateTaalonFrequencies } from "./config";

import { SsvepClassifierBridge } from "./SsvepClassifierBridge";

import type { SsvepClassification, SsvepDirection, SsvepTarget } from "./models";

function directionForWinner(winnerHz: number, targets: readonly SsvepTarget[]): SsvepDirection {
  const target = targets.find((candidate) => Math.abs(candidate.frequencyHz - winnerHz) < 1e-6);

  if (!target) {
    throw new Error(`Classifier returned unknown frequency ${winnerHz}.`);
  }

  return target.direction;
}

export class SsvepClassifierService {
  constructor(private readonly bridge = new SsvepClassifierBridge()) {}

  async classify(
    eeg: readonly (readonly number[])[],
    sampleRateHz: number,
    targets: readonly SsvepTarget[] = TAALON_DEFAULT_TARGETS,
  ): Promise<SsvepClassification> {
    const frequencies = targets.map((target) => target.frequencyHz);

    validateTaalonFrequencies(frequencies);

    const response = await this.bridge.classify({
      eeg,
      sampleRateHz,
      frequencies,
    });

    return {
      ...response,
      direction: directionForWinner(response.winnerHz, targets),
    };
  }

  async stop(): Promise<void> {
    await this.bridge.stop();
  }
}

export const ssvepClassifierService = new SsvepClassifierService();
