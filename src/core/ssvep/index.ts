export {
  TAALON_COUNTDOWN_SECONDS,
  TAALON_DEFAULT_TARGETS,
  TAALON_DEFAULT_TRIAL_SECONDS,
  TAALON_MAX_TRIAL_SECONDS,
  TAALON_MIN_TRIAL_SECONDS,
  TAALON_SAMPLE_TIMEOUT_SECONDS,
  TAALON_SSVEP_CHANNELS,
  TAALON_TRIAL_STEP_SECONDS,
  validateTaalonFrequencies,
} from "./config";

export { SsvepClassifierService, ssvepClassifierService } from "./SsvepClassifierService";

export type { SsvepClassification, SsvepDirection, SsvepTarget } from "./models";
