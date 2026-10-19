"""neurostate JSON-lines sidecar for KNeuron.

Runs the neurostate service on the LSL EEG stream of the connected device, so the
native games (Neurosniper, Neurorun) and any other neurostate client receive
attention and relaxation on neurostate's usual outputs: JSON over TCP (13855),
WebSocket (13856), ThinkGear (13854) and LSL. The values are also reported back
to KNeuron on stdout.

Protocol:
- stdin: one JSON request per line
- stdout: one JSON response/event per line
- stderr: diagnostic logs only

It can also run neurostate's signal check, the headless equivalent of
`neurostate check`: filtered signals, per-channel status (flat, noisy, mains
hum), gaps and the spectrum over the back of the head, for fitting the cap.

Requests: ping, start {stream, profile}, stop, start_check {stream, profile},
stop_check, shutdown.
Events: ready, service-status {status, message, outputs}, brain-state {state},
check-state {state, message}, check-info {...}, check-signals {values},
check-status {...}.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, TextIO

import numpy as np
import pylsl
from scipy.signal import welch

from neurostate.acquisition.lsl_source import LslSource, find_streams
from neurostate.config import Config, load_config
from neurostate.estimators.eeg import EegEstimator
from neurostate.montage import REGIONS, Montage, load_montage
from neurostate.outputs.thinkgear_server import poor_signal_level
from neurostate.pipeline import OutputStartError, run_service
from neurostate.preprocessing.channels import ChannelStatus, assess_channels
from neurostate.preprocessing.filters import CausalFilter
from neurostate.schema import BrainState

PROTOCOL_VERSION = 1

# How long each LSL lookup waits, between checks for a stop request.
STREAM_LOOKUP_S = 1.0

# Signal check timing and spectrum, as in neurostate's own check window.
CHECK_PULL_S = 0.05
CHECK_ASSESS_S = 0.5
CHECK_SPECTRUM_S = 4.0
CHECK_SPECTRUM_MAX_HZ = 60.0

PROFILE_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Profiles are neurostate config files tuned for a cap, bundled next to this script.
# "standard" means neurostate's defaults (any cap with 10-20 labels).
PROFILES_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "profiles"


_write_lock = threading.Lock()

# The real stdout. main() points sys.stdout at stderr, so a stray print from a
# library can never corrupt the protocol.
_protocol_out: TextIO | None = None


def emit(message: dict[str, Any]) -> None:
    """Write exactly one protocol message to stdout."""
    payload = json.dumps(message, separators=(",", ":"), allow_nan=False)
    out = _protocol_out or sys.stdout

    with _write_lock:
        out.write(payload + "\n")
        out.flush()


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def load_profile(profile: str) -> Config:
    """The neurostate config for a cap profile."""
    if not PROFILE_NAME.match(profile):
        raise RuntimeError(f'Invalid neurostate profile name "{profile}".')

    if profile == "standard":
        return load_config(None)

    path = PROFILES_DIR / f"{profile}.yaml"
    if not path.is_file():
        raise RuntimeError(f'Unknown neurostate profile "{profile}".')

    return load_config(path)


def brain_state_event(state: BrainState) -> dict[str, Any]:
    return {
        "type": "brain-state",
        "state": {
            "t": state.t,
            "attention": round(state.attention, 1),
            "relaxation": round(state.relaxation, 1),
            "quality": round(state.quality, 1),
            "state": state.state.value,
            "calibrated": state.calibrated,
            "poorSignalLevel": poor_signal_level(state),
        },
    }


def status_event(status: str, message: str, outputs: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "service-status",
        "status": status,
        "message": message,
        "outputs": outputs or [],
    }


def find_stream(
    stream: str, stream_type: str, stop: threading.Event
) -> pylsl.StreamInfo | None:
    """Wait for the named LSL stream; None if ``stop`` is set first."""
    while not stop.is_set():
        found = find_streams(stream, stream_type, STREAM_LOOKUP_S)
        if found:
            return found[0]
    return None


def finite(value: float, digits: int) -> float | None:
    """A rounded number, or None where JSON can't carry it (infinity, NaN)."""
    return round(value, digits) if math.isfinite(value) else None


class SignalCheck:
    """neurostate's signal check without its window.

    It applies exactly what ``neurostate check`` does, with the cap profile's
    settings: the causal display filter, the per-channel assessment (flat, noisy,
    mains hum) and the spectrum over the back of the head.
    """

    def __init__(self, source: LslSource, montage: Montage, config: Config):
        self._source = source
        self._config = config
        fs = source.sampling_rate
        self._filter = CausalFilter(config.filters, fs, len(source.labels))
        self._regions = montage.region_indices(source.labels)
        self._spectrum_channels = self._regions["occipital"] or list(range(len(source.labels)))

    def info_event(self) -> dict[str, Any]:
        labels = self._source.labels
        return {
            "type": "check-info",
            "stream": self._source.description.name,
            "samplingRateHz": self._source.sampling_rate,
            "labels": labels,
            "regions": {
                region: [labels[i] for i in self._regions[region]] for region in REGIONS
            },
            "spectrumChannels": [labels[i] for i in self._spectrum_channels],
            "alphaHz": list(self._config.bands.alpha),
            "thresholds": {
                "flatUv": self._config.bad_channels.flat_uv,
                "noisyUv": self._config.bad_channels.noisy_uv,
                "mainsRatio": self._config.bad_channels.mains_ratio,
            },
        }

    def signals_event(self) -> dict[str, Any] | None:
        """Newly arrived samples, filtered for display (channels x samples, µV)."""
        n_new = self._source.pull()
        if not n_new:
            return None
        samples, _ = self._source.buffer.latest(n_new)
        filtered = self._filter(samples)
        return {
            "type": "check-signals",
            "values": np.round(filtered.T, 2).tolist(),
        }

    def status_event(self) -> dict[str, Any]:
        """Per-channel status, regions, stream health and the spectrum."""
        source = self._source
        fs = source.sampling_rate
        gaps = source.gaps
        idle = source.seconds_since_data()

        event: dict[str, Any] = {
            "type": "check-status",
            "stream": {
                "nominalRateHz": fs,
                "receivedRateHz": finite(gaps.effective_rate_hz or math.nan, 2),
                "gaps": gaps.n_gaps,
                "missingSamples": gaps.n_missing,
                "secondsSinceData": finite(idle, 2) if idle is not None else None,
            },
            "channels": [],
            "regions": {},
            "spectrum": None,
        }

        raw, _ = source.buffer.latest(round(self._config.processing.window_s * fs))
        if len(raw) < fs / 2:
            return event

        reports = assess_channels(
            raw, fs, self._config.filters.notch_hz, self._config.bad_channels
        )
        event["channels"] = [
            {
                "label": label,
                "status": report.status.value,
                "rmsUv": finite(report.rms_uv, 2),
                "mainsRatio": finite(report.mains_ratio, 2),
            }
            for label, report in zip(source.labels, reports, strict=True)
        ]
        event["regions"] = {
            region: {
                "good": sum(reports[i].status is ChannelStatus.OK for i in positions),
                "total": len(positions),
            }
            for region, positions in self._regions.items()
        }

        raw, _ = source.buffer.latest(round(CHECK_SPECTRUM_S * fs))
        freqs, psd = welch(
            raw[:, self._spectrum_channels],
            fs=fs,
            nperseg=min(len(raw), round(fs)),
            detrend="linear",
            axis=0,
        )
        shown = (freqs >= 1) & (freqs <= min(CHECK_SPECTRUM_MAX_HZ, fs / 2))
        # A floor keeps flat channels from producing log(0) in the plot.
        power = np.maximum(psd[shown].mean(axis=1), 1e-6)
        event["spectrum"] = {
            "hz": np.round(freqs[shown], 2).tolist(),
            "psd": [float(f"{value:.4g}") for value in power],
        }
        return event


def check_state_event(state: str, message: str) -> dict[str, Any]:
    return {"type": "check-state", "state": state, "message": message}


class CheckSession:
    """Runs at most one signal check at a time, on a background thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._stream: str | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, stream: str, config: Config) -> dict[str, Any]:
        with self._lock:
            if self.running:
                if self._stream == stream:
                    return {"started": False, "stream": stream}
                raise RuntimeError(
                    f'The signal check is already running on "{self._stream}". Stop it first.'
                )

            self._stop.clear()
            self._stream = stream
            self._thread = threading.Thread(
                target=self._run, args=(stream, config), name="signal-check", daemon=True
            )
            self._thread.start()

        return {"started": True, "stream": stream}

    def stop(self, timeout_s: float = 10.0) -> dict[str, Any]:
        with self._lock:
            thread = self._thread
            self._stop.set()

        if thread is not None:
            thread.join(timeout_s)
            if thread.is_alive():
                raise RuntimeError("The signal check did not stop in time.")

        with self._lock:
            self._thread = None
            self._stream = None

        return {"running": False}

    def _run(self, stream: str, config: Config) -> None:
        try:
            self._check(stream, config)
            emit(check_state_event("stopped", "Signal check stopped."))
        except Exception as exc:
            log(f"Signal check failed: {exc!r}")
            emit(check_state_event("error", f"Signal check failed: {exc}"))

    def _check(self, stream: str, config: Config) -> None:
        montage = load_montage(config.input.montage)

        emit(check_state_event("waiting-for-stream", f'Waiting for the EEG stream "{stream}"...'))
        info = find_stream(stream, config.input.stream_type, self._stop)
        if info is None:
            return

        source = LslSource(info, montage)
        try:
            check = SignalCheck(source, montage, config)
            emit(check.info_event())
            emit(check_state_event("running", f'Checking "{stream}".'))

            next_status = 0.0
            while not self._stop.wait(CHECK_PULL_S):
                signals = check.signals_event()
                if signals is not None:
                    emit(signals)

                if time.monotonic() >= next_status:
                    next_status = time.monotonic() + CHECK_ASSESS_S
                    emit(check.status_event())
        finally:
            source.close()


class NeuroStateSession:
    """Runs at most one neurostate service at a time, on a background thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_requested = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop_event: asyncio.Event | None = None
        self._stream: str | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, stream: str, config: Config) -> dict[str, Any]:
        with self._lock:
            if self.running:
                if self._stream == stream:
                    return {"started": False, "stream": stream}

                raise RuntimeError(
                    f'neurostate is already running on "{self._stream}". Stop it first.'
                )

            self._stop_requested.clear()
            self._loop = None
            self._stop_event = None
            self._stream = stream
            self._thread = threading.Thread(
                target=self._run, args=(stream, config), name="neurostate", daemon=True
            )
            self._thread.start()

        return {"started": True, "stream": stream}

    def stop(self, timeout_s: float = 10.0) -> dict[str, Any]:
        with self._lock:
            thread = self._thread
            self._stop_requested.set()

            loop, stop_event = self._loop, self._stop_event
            if thread is not None and loop is not None and stop_event is not None:
                # The loop may close between the check and the call when the service
                # ends on its own (an error); there is nothing left to stop then.
                with contextlib.suppress(RuntimeError):
                    loop.call_soon_threadsafe(stop_event.set)

        if thread is not None:
            thread.join(timeout_s)

            if thread.is_alive():
                raise RuntimeError("neurostate did not stop in time.")

        with self._lock:
            self._thread = None
            self._stream = None
            self._loop = None
            self._stop_event = None

        return {"running": False}

    def _run(self, stream: str, config: Config) -> None:
        try:
            asyncio.run(self._serve(stream, config))
            emit(status_event("stopped", "neurostate stopped."))
        except OutputStartError as exc:
            emit(status_event("error", str(exc)))
        except Exception as exc:
            log(f"neurostate failed: {exc!r}")
            emit(status_event("error", f"neurostate failed: {exc}"))

    async def _serve(self, stream: str, config: Config) -> None:
        self._loop = asyncio.get_running_loop()
        self._stop_event = asyncio.Event()
        if self._stop_requested.is_set():
            return

        montage = load_montage(config.input.montage)

        emit(status_event("waiting-for-stream", f'Waiting for the EEG stream "{stream}"...'))
        info = await asyncio.to_thread(
            find_stream, stream, config.input.stream_type, self._stop_requested
        )
        if info is None:
            return

        source = await asyncio.to_thread(LslSource, info, montage)
        try:
            for warning in source.warnings:
                log(f"Stream warning: {warning}")
            log(f"Reading {len(source.labels)} EEG channels: {' '.join(source.labels)}")

            estimator = EegEstimator(source, montage, config)

            # Report every update to KNeuron as well as to neurostate's own outputs.
            def estimate(t: float) -> BrainState:
                state = estimator(t)
                emit(brain_state_event(state))
                return state

            def started(outputs: list[Any]) -> None:
                descriptions = [output.description for output in outputs]
                for description in descriptions:
                    log(f"Publishing on {description}")
                emit(status_event("running", f'Reading "{stream}".', descriptions))

            await run_service(config.outputs, estimate, on_started=started, stop=self._stop_event)
        finally:
            source.close()


SESSION = NeuroStateSession()
CHECK = CheckSession()


def stream_and_profile(payload: dict[str, Any], command: str) -> tuple[str, Config]:
    stream = str(payload.get("stream", "")).strip()
    if not stream:
        raise RuntimeError(f"{command} requires payload.stream.")

    return stream, load_profile(str(payload.get("profile") or "standard"))


def response_ok(request_id: str, result: Any = None) -> None:
    emit({"type": "response", "id": request_id, "ok": True, "result": result})


def response_error(request_id: str, exc: Exception) -> None:
    emit({"type": "response", "id": request_id, "ok": False, "error": str(exc)})


def handle_request(request: dict[str, Any]) -> bool:
    request_id = str(request.get("id", ""))
    command = str(request.get("command", ""))
    payload = request.get("payload") or {}

    try:
        if command == "ping":
            response_ok(request_id, {"protocolVersion": PROTOCOL_VERSION})

        elif command == "start":
            response_ok(request_id, SESSION.start(*stream_and_profile(payload, command)))

        elif command == "stop":
            response_ok(request_id, SESSION.stop())

        elif command == "start_check":
            response_ok(request_id, CHECK.start(*stream_and_profile(payload, command)))

        elif command == "stop_check":
            response_ok(request_id, CHECK.stop())

        elif command == "shutdown":
            SESSION.stop()
            CHECK.stop()
            response_ok(request_id, {"shutdown": True})
            return False

        else:
            raise RuntimeError(f'Unknown neurostate bridge command "{command}".')

    except Exception as exc:
        response_error(request_id, exc)

    return True


def main() -> None:
    global _protocol_out
    _protocol_out = sys.stdout
    sys.stdout = sys.stderr

    try:
        emit({"type": "ready", "protocolVersion": PROTOCOL_VERSION})

        for raw_line in sys.stdin:
            line = raw_line.strip()

            if not line:
                continue

            try:
                request = json.loads(line)

                if not isinstance(request, dict):
                    raise RuntimeError("Protocol request must be a JSON object.")

            except Exception as exc:
                emit({"type": "bridge-error", "message": f"Invalid JSON request: {exc}"})
                continue

            if not handle_request(request):
                break

    finally:
        for session in (SESSION, CHECK):
            try:
                session.stop()
            except Exception as exc:
                log(f"neurostate shutdown warning: {exc}")

        sys.stdout = _protocol_out
        _protocol_out = None


if __name__ == "__main__":
    main()
