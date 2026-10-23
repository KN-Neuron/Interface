"""Exercise the actual classifier process, including imports and FBCCA inference.

Usage: python smoke_test.py path/to/ssvep-classifier.exe
       python smoke_test.py python bridge.py
"""
from __future__ import annotations

import argparse
import json
import math
import random
import subprocess


def verify(command: list[str], timeout: float = 90) -> None:
    targets = [10.25, 13.75, 14.25, 14.75]
    winner = 13.75
    rng = random.Random(123)
    eeg = [
        [10 + channel + sum(
            amplitude * math.sin(2 * math.pi * harmonic * winner * sample / 250 + channel * 0.17 / harmonic)
            for harmonic, amplitude in [(1, 1), (2, 0.55), (3, 0.25)]
        ) + rng.gauss(0, 0.06) for sample in range(1000)]
        for channel in range(6)
    ]
    requests = [
        {"id": "ping", "command": "ping"},
        {"id": "classify", "command": "classify", "payload": {
            "eeg": eeg, "sampleRateHz": 250, "frequencies": targets,
        }},
        {"id": "shutdown", "command": "shutdown"},
    ]
    try:
        completed = subprocess.run(command, input="".join(json.dumps(item) + "\n" for item in requests),
                                   text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Classifier startup/classification timed out.") from error
    if completed.returncode:
        raise RuntimeError(f"Classifier exited with code {completed.returncode}:\n{completed.stderr[-8000:]}")
    try:
        messages = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
        if not messages or messages[0].get("type") != "ready" or messages[0].get("protocolVersion") != 1:
            raise ValueError("Missing protocol-v1 ready message")
        replies = {item["id"]: item for item in messages if item.get("type") == "response"}
        for name in ("ping", "classify", "shutdown"):
            if replies[name].get("ok") is not True:
                raise ValueError(f"{name} failed: {replies[name]}")
        result = replies["classify"]["result"]
        if result["winnerHz"] != winner or result["channelCount"] != 6 or result["sampleCount"] != 1000:
            raise ValueError(f"Unexpected classification: {result}")
        scores = result["scores"]
        if set(scores) != {str(target) for target in targets} or not all(
            isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 for value in scores.values()
        ):
            raise ValueError("Invalid classification scores")
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        raise RuntimeError(f"Invalid classifier protocol: {error}\n{completed.stdout[-4000:]}\n{completed.stderr[-4000:]}") from error
    print("[OK] Classifier executable: ready, ping, synthetic 6-channel FBCCA classification, shutdown")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="+")
    verify(parser.parse_args().command)
