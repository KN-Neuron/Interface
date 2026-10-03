from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np


SIDECAR_DIR = Path(__file__).resolve().parents[1]
if str(SIDECAR_DIR) not in sys.path:
    sys.path.insert(0, str(SIDECAR_DIR))

import fbcca


FS = 250.0
TARGETS = [10.25, 11.25, 13.75, 14.75]


def synthetic_ssvep(
    frequency: float,
    *,
    fs: float = FS,
    seconds: float = 3.0,
    channels: int = 6,
    noise: float = 0.06,
    seed: int = 123,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n_samples = int(fs * seconds)
    t = np.arange(n_samples) / fs
    rows: list[np.ndarray] = []

    for channel in range(channels):
        phase = channel * 0.17
        signal = (
            np.sin(2 * np.pi * frequency * t + phase)
            + 0.55 * np.sin(2 * np.pi * 2 * frequency * t + phase / 2)
            + 0.25 * np.sin(2 * np.pi * 3 * frequency * t + phase / 3)
        )
        signal += rng.normal(0.0, noise, size=n_samples)
        signal += 10.0 + channel  # intentional per-channel DC offset
        rows.append(signal)

    return np.vstack(rows)


class FBCCATests(unittest.TestCase):
    def test_reference_shape_and_initial_sine_cosine_values(self) -> None:
        reference = fbcca.make_reference(10.0, n_samples=250, fs=250.0, n_harmonics=3)
        self.assertEqual(reference.shape, (250, 6))
        self.assertAlmostEqual(reference[0, 0], 0.0, places=12)
        self.assertAlmostEqual(reference[0, 1], 1.0, places=12)

    def test_rejects_non_2d_eeg(self) -> None:
        with self.assertRaisesRegex(ValueError, "shape"):
            fbcca.fbcca_scores(np.zeros(250), TARGETS, FS)

    def test_rejects_zero_channels(self) -> None:
        with self.assertRaisesRegex(ValueError, "Brak kanałów"):
            fbcca.fbcca_scores(np.empty((0, 250)), TARGETS, FS)

    def test_rejects_too_few_samples(self) -> None:
        with self.assertRaisesRegex(ValueError, "Za mało próbek"):
            fbcca.fbcca_scores(np.ones((2, 99)), TARGETS, FS)

    def test_rejects_nan_and_inf(self) -> None:
        eeg = synthetic_ssvep(10.25)
        eeg[0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "NaN lub Inf"):
            fbcca.fbcca_scores(eeg, TARGETS, FS)

    def test_rejects_flat_channel(self) -> None:
        eeg = synthetic_ssvep(10.25)
        eeg[2] = 4.2
        with self.assertRaisesRegex(ValueError, "Płaski kanał"):
            fbcca.fbcca_scores(eeg, TARGETS, FS)

    def test_rejects_sample_rate_not_supported_by_filter_bank(self) -> None:
        eeg = synthetic_ssvep(10.25, fs=200.0)
        with self.assertRaisesRegex(ValueError, "fs > 200"):
            fbcca.fbcca_scores(eeg, TARGETS, 200.0)

    def test_scores_are_finite_nonnegative_and_match_target_count(self) -> None:
        scores = fbcca.fbcca_scores(synthetic_ssvep(13.75), TARGETS, FS)
        self.assertEqual(scores.shape, (4,))
        self.assertTrue(np.isfinite(scores).all())
        self.assertTrue((scores >= 0).all())

    def test_predicts_clean_synthetic_target(self) -> None:
        for index, target in enumerate(TARGETS):
            with self.subTest(target=target):
                winner, scores = fbcca.fbcca_predict(
                    synthetic_ssvep(target, seed=100 + index), TARGETS, FS
                )
                self.assertEqual(winner, target)
                self.assertEqual(int(np.argmax(scores)), index)

    def test_dc_offset_does_not_materially_change_scores(self) -> None:
        eeg = synthetic_ssvep(10.25)
        scores_a = fbcca.fbcca_scores(eeg, TARGETS, FS)
        offsets = np.arange(eeg.shape[0], dtype=float)[:, None] * 100.0 + 500.0
        scores_b = fbcca.fbcca_scores(eeg + offsets, TARGETS, FS)
        np.testing.assert_allclose(scores_a, scores_b, rtol=1e-7, atol=1e-9)

    def test_arbitrary_four_frequency_set_is_supported(self) -> None:
        targets = [10.25, 13.75, 14.25, 14.75]
        winner, _ = fbcca.fbcca_predict(synthetic_ssvep(14.25), targets, FS)
        self.assertEqual(winner, 14.25)


if __name__ == "__main__":
    unittest.main()
