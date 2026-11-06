"""Verified alignment, Korean viseme control and end-to-end MP4 smoke tests.

No real performers or downloadable audio are used. Timings are human-annotated
test fixtures, NOT forced alignment obtained from synthesized audio.
"""
import hashlib
import json
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

from song_vision.face_geometry import animate_video, deform_lips
from song_vision.test_face_geometry import FakeLocalLandmarker, fake_landmarks
from song_vision.viseme_timeline import (
    BILABIAL_ONSETS, decompose_syllable, load_timeline, sample_frames,
    sample_viseme, verify_audio_file,
)


class KoreanVisemeTests(unittest.TestCase):
    def write_audio(self, folder: Path, seconds: float = 1.) -> Path:
        wav = folder / "authorized-fixture.wav"
        count = round(seconds * 16000)
        t = np.arange(count, dtype=np.float32) / 16000
        tone = np.sin(2 * np.pi * 200 * t)
        samples = np.rint(tone * 6000).astype("<i2")
        with wave.open(str(wav), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(16000)
            handle.writeframes(samples.tobytes())
        return wav

    def write_timeline(self, root: Path, vocals: Path, **overrides) -> Path:
        raw = {
            "schemaVersion": 1,
            "alignmentMethod": "human_reviewed",
            "verified": True,
            "verifiedBy": "local-test-operator",
            "timeBase": "vocal_file_seconds",
            "vocalSha256": hashlib.sha256(vocals.read_bytes()).hexdigest(),
            "durationSeconds": 1.,
            "segments": [
                {"kind": "syllable", "startSeconds": 0.0, "endSeconds": .25,
                 "syllable": "마"},
                {"kind": "syllable", "startSeconds": .25, "endSeconds": .5,
                 "syllable": "아"},
                {"kind": "syllable", "startSeconds": .5, "endSeconds": .75,
                 "syllable": "우"},
                {"kind": "rest", "startSeconds": .75, "endSeconds": 1.},
            ],
        }
        raw.update(overrides)
        dest = root / "timeline.json"
        dest.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        return dest

    def test_hangul_syllable_decomposition_and_bilabial(self):
        self.assertEqual(decompose_syllable("사").vowel, "ㅏ")
        self.assertEqual(decompose_syllable("밤").coda, "ㅁ")
        self.assertIn(decompose_syllable("마").onset, BILABIAL_ONSETS)
        self.assertEqual(decompose_syllable("우").vowel, "ㅜ")
        with self.assertRaises(ValueError):
            decompose_syllable("ᄉ")
        with self.assertRaises(ValueError):
            decompose_syllable("사랑")

    def test_viseme_targets_and_phonetic_overrides(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            vocals = self.write_audio(root)
            timeline = load_timeline(self.write_timeline(root, vocals))
            verify_audio_file(timeline, vocals)
            self.assertEqual(len(timeline.segments), 4)
            start = sample_viseme(timeline, 0.)
            vowel_a = sample_viseme(timeline, .35)
            vowel_u = sample_viseme(timeline, .61)
            silent = sample_viseme(timeline, .91)
            self.assertLess(start["openingRatio"], vowel_a["openingRatio"])
            self.assertLess(vowel_u["widthScale"], vowel_a["widthScale"])
            self.assertLess(vowel_u["openingRatio"], vowel_a["openingRatio"])
            self.assertLess(silent["openingRatio"], vowel_a["openingRatio"])
            self.assertEqual(len(sample_frames(timeline, 0, 1, 25)), 25)
            with self.assertRaises(ValueError):
                sample_frames(timeline, .7, 1., 25)
            updated = self.write_timeline(root, vocals)
            data = json.loads(updated.read_text())
            data["segments"][0]["vowel"] = "ㅜ"
            updated.write_text(json.dumps(data, ensure_ascii=False))
            override = load_timeline(updated)
            self.assertLess(sample_viseme(override, .12)["widthScale"], 1.)

    def test_reject_unreviewed_mismatch_and_timing_holes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            vocals = self.write_audio(root)
            filename = self.write_timeline(root, vocals, verified=False)
            with self.assertRaisesRegex(ValueError, "human-reviewed"):
                load_timeline(filename)
            filename = self.write_timeline(root, vocals)
            timeline = load_timeline(filename)
            bad_audio = root / "wrong.wav"
            bad_audio.write_bytes(vocals.read_bytes() + b"changed")
            with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
                verify_audio_file(timeline, bad_audio)
            data = json.loads(filename.read_text())
            data["segments"][2]["startSeconds"] = .54
            filename.write_text(json.dumps(data, ensure_ascii=False))
            with self.assertRaisesRegex(ValueError, "gap/overlap"):
                load_timeline(filename)
            data["segments"][2]["startSeconds"] = .5
            data["segments"][2]["syllable"] = "a"
            filename.write_text(json.dumps(data, ensure_ascii=False))
            with self.assertRaisesRegex(ValueError, "Hangul"):
                load_timeline(filename)

    def test_width_and_opening_have_distinct_pixel_effects(self):
        frame = np.full((160, 160, 3), 140, dtype=np.uint8)
        cv2.rectangle(frame, (65, 102), (95, 113), (10, 10, 10), -1)
        pts = fake_landmarks()
        lip_a = deform_lips(frame, pts, .25, target_width_scale=1.1)
        lip_u = deform_lips(frame, pts, .08, target_width_scale=.82)
        self.assertGreater(np.abs(lip_a.astype(np.int16) - lip_u.astype(np.int16)).sum(), 100)
        self.assertTrue(np.array_equal(lip_a[:40], frame[:40]))
        with self.assertRaises(ValueError):
            deform_lips(frame, pts, .2, target_width_scale=2.)

    def test_real_video_format_with_local_mock_detector(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            vocals = self.write_audio(root)
            timeline = self.write_timeline(root, vocals)
            source = root / "stage.mp4"
            writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"),
                                     25., (160, 160))
            self.assertTrue(writer.isOpened())
            image = np.full((160, 160, 3), 180, dtype=np.uint8)
            cv2.rectangle(image, (68, 104), (92, 112), (15, 15, 15), -1)
            for _ in range(25):
                writer.write(image)
            writer.release()
            consent = root / "consent.json"
            consent.write_text(json.dumps({
                "approved": True, "scope": "video_edit", "subjectId": "synthetic"
            }))
            fake_bundle = root / "fake.task"
            fake_bundle.write_bytes(b"mocked detector; never a real model")
            output = root / "phoneme-guided-preview.mp4"
            with patch("song_vision.face_geometry.LocalFaceLandmarker", FakeLocalLandmarker):
                report = animate_video(source, vocals, vocals, fake_bundle,
                                       consent, output, seconds=1., timeline_path=timeline)
            self.assertEqual(report["controlMode"], "human_reviewed_korean_viseme_timeline")
            self.assertEqual(report["alignmentProvenance"], "manual_timings")
            self.assertFalse(report["lipSyncVerified"])
            self.assertEqual(report["frames"], 25)
            self.assertTrue(output.exists())
            self.assertGreater(output.stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()
