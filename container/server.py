"""Serve the browser app and the existing FBCCA classifier on one origin."""
from pathlib import Path
import math
import threading

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from bridge import classify

DIST = Path(__file__).resolve().parent / "dist"
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
classification_lock = threading.Lock()


@app.get("/api/health")
def health():
    return jsonify(status="ok")


@app.post("/api/classify")
def classify_request():
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Expected a JSON object."), 400
    try:
        eeg = payload.get("eeg")
        fs = float(payload.get("sampleRateHz"))
        frequencies = payload.get("frequencies")
        if not math.isfinite(fs) or not 200 < fs <= 2000:
            raise ValueError("Sample rate must be greater than 200 and at most 2000 Hz.")
        if not isinstance(frequencies, list) or len(frequencies) != 4:
            raise ValueError("Exactly four target frequencies are required.")
        frequencies = [float(value) for value in frequencies]
        if any(not math.isfinite(f) or not 0 < f < fs / 2 for f in frequencies):
            raise ValueError("Frequencies must be finite, positive, and below Nyquist.")
        if len(set(frequencies)) != 4:
            raise ValueError("Target frequencies must be distinct.")
        if not isinstance(eeg, list) or not 1 <= len(eeg) <= 32:
            raise ValueError("Expected 1–32 EEG channels.")
        count = len(eeg[0]) if isinstance(eeg[0], list) else 0
        if not 32 <= count <= min(20000, int(fs * 10)):
            raise ValueError("Expected 32 samples to 10 seconds of EEG per channel (maximum 20000 samples).")
        if any(not isinstance(row, list) or len(row) != count for row in eeg):
            raise ValueError("EEG channels must have equal sample counts.")
        if any(not isinstance(value, (float, int)) or not math.isfinite(value)
               for row in eeg for value in row):
            raise ValueError("EEG values must be finite numbers.")
    except (ValueError, TypeError, OverflowError) as error:
        return jsonify(error=str(error)), 400
    if not classification_lock.acquire(blocking=False):
        return jsonify(error="Classifier is busy. Please retry."), 503
    try:
        return jsonify(classify(payload))
    except (ValueError, TypeError) as error:
        return jsonify(error=str(error)), 400
    finally:
        classification_lock.release()


@app.get("/")
def index():
    return send_from_directory(DIST, "index.html", max_age=0)


@app.get("/<path:path>")
def static_file(path):
    return send_from_directory(DIST, path)


@app.errorhandler(HTTPException)
def http_error(error):
    if request.path.startswith("/api/"):
        return jsonify(error=error.description), error.code
    return error
