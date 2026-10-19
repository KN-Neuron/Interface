import type {
  ChannelCheck,
  ChannelCheckStatus,
  SignalCheckInfo,
  SignalCheckStatus,
} from "../../core/neurostate";

/**
 * Channel colours of neurostate's check window.
 */
export const STATUS_COLORS: Record<ChannelCheckStatus, string> = {
  ok: "#d0d0d0",
  flat: "#808080",
  noisy: "#e05050",
  mains: "#f0a030",
};

export const STATUS_LABELS: Record<ChannelCheckStatus, string> = {
  ok: "OK",
  flat: "FLAT",
  noisy: "NOISY",
  mains: "MAINS",
};

export type Tone = "good" | "partial" | "bad";

/**
 * All of a region's channels good, some, or none.
 */
export function regionTone(good: number, total: number): Tone {
  if (total > 0 && good === total) {
    return "good";
  }

  return good > 0 ? "partial" : "bad";
}

/**
 * "F7 noisy, P8 flat", or null when every channel is fine.
 */
export function describeProblems(channels: readonly ChannelCheck[]): string | null {
  const problems = channels
    .filter((channel) => channel.status !== "ok")
    .map((channel) => `${channel.label} ${channel.status}`);

  return problems.length > 0 ? problems.join(", ") : null;
}

export interface StreamFact {
  text: string;
  bad: boolean;
}

/**
 * The stream's health, as in the status line of `neurostate check`.
 */
export function describeStream(
  info: Readonly<SignalCheckInfo>,
  status: Readonly<SignalCheckStatus> | null,
  noSignalAfterS = 2,
): StreamFact[] {
  const facts: StreamFact[] = [{ text: `${info.labels.length} EEG channels`, bad: false }];
  const stream = status?.stream;
  const nominal = `${info.samplingRateHz} Hz`;

  facts.push({
    text:
      stream?.receivedRateHz != null
        ? `${nominal}, ${stream.receivedRateHz.toFixed(1)} received`
        : nominal,
    bad: false,
  });

  if (!stream || stream.secondsSinceData == null) {
    facts.push({ text: "waiting for data", bad: true });
  } else if (stream.secondsSinceData > noSignalAfterS) {
    facts.push({ text: `no data for ${Math.round(stream.secondsSinceData)} s`, bad: true });
  }

  if (stream) {
    const plural = stream.gaps === 1 ? "" : "s";

    facts.push({
      text: `${stream.gaps} gap${plural}, ${stream.missingSamples} samples missing`,
      bad: stream.gaps > 0,
    });
  }

  return facts;
}
