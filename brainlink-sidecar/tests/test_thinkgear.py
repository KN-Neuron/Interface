from __future__ import annotations

import sys
import unittest
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
if str(SIDECAR_DIR) not in sys.path:
    sys.path.insert(0, str(SIDECAR_DIR))

from thinkgear import ThinkGearParser, build_packet


class ThinkGearParserRobustnessTests(unittest.TestCase):
    def test_parses_esense_packet(self) -> None:
        packet = build_packet([0x02, 32, 0x04, 18, 0x05, 96])
        parsed = ThinkGearParser().feed(packet)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].values["poorSignalLevel"], 32)
        self.assertEqual(parsed[0].values["attention"], 18)
        self.assertEqual(parsed[0].values["meditation"], 96)

    def test_parses_raw_signed_value(self) -> None:
        packet = build_packet([0x80, 0x02, 0xFF, 0x9C])
        parsed = ThinkGearParser().feed(packet)
        self.assertEqual(parsed[0].values["rawEeg"], -100)

    def test_parses_eeg_power(self) -> None:
        power_bytes: list[int] = []
        for value in range(1, 9):
            power_bytes.extend(value.to_bytes(3, byteorder="big"))

        packet = build_packet([0x83, 0x18, *power_bytes])
        power = ThinkGearParser().feed(packet)[0].values["eegPower"]
        self.assertEqual(power["delta"], 1)
        self.assertEqual(power["highGamma"], 8)

    def test_packet_can_arrive_in_multiple_serial_chunks(self) -> None:
        packet = build_packet([0x04, 77])
        parser = ThinkGearParser()
        self.assertEqual(parser.feed(packet[:2]), [])
        self.assertEqual(parser.feed(packet[2:5]), [])
        parsed = parser.feed(packet[5:])
        self.assertEqual(parsed[0].values["attention"], 77)

    def test_parses_multiple_packets_from_one_chunk(self) -> None:
        data = build_packet([0x04, 10]) + build_packet([0x05, 20])
        parsed = ThinkGearParser().feed(data)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0].values["attention"], 10)
        self.assertEqual(parsed[1].values["meditation"], 20)

    def test_recovers_after_noise_and_corrupted_checksum(self) -> None:
        valid = build_packet([0x04, 88])
        corrupt = bytearray(build_packet([0x04, 33]))
        corrupt[-1] ^= 0xFF

        parsed = ThinkGearParser().feed(b"\x01\x02\xAA" + bytes(corrupt) + valid)
        self.assertTrue(parsed)
        self.assertEqual(parsed[-1].values["attention"], 88)

    def test_extended_rows_are_ignored(self) -> None:
        # EXCODE=0x55, then a standard single-byte attention code/value.
        packet = build_packet([0x55, 0x04, 99, 0x05, 42])
        parsed = ThinkGearParser().feed(packet)
        self.assertNotIn("attention", parsed[0].values)
        self.assertEqual(parsed[0].values["meditation"], 42)

    def test_reset_discards_partial_frame(self) -> None:
        packet = build_packet([0x04, 55])
        parser = ThinkGearParser()
        parser.feed(packet[:4])
        parser.reset()
        self.assertEqual(parser.feed(packet[4:]), [])

    def test_build_packet_rejects_oversized_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "payload is too long"):
            build_packet([0] * 170)


if __name__ == "__main__":
    unittest.main()
