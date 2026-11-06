"""Offline fake-landmark tests: no personal images or vendor model downloads."""
import json
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

from song_vision.face_geometry import (
    VERSION, annotate_face, audio_to_opening_curve, deform_lips,
    inspect_image, measure_face, animate_video,
)


def fake_landmarks():
    pts = np.zeros((478, 3), dtype=np.float64)
    pts[:, 0] = .5
    pts[:, 1] = .52
    coordinates = {
        33: (.34, .36), 263: (.66, .36), 133: (.43, .36),
        362: (.57, .36), 1: (.50, .52), 152: (.50, .88),
        234: (.25, .58), 454: (.75, .58), 10: (.50, .13),
        61: (.38, .65), 291: (.62, .65),
        13: (.50, .645), 14: (.50, .675),
    }
    for idx, (x, y) in coordinates.items():
        pts[idx, :2] = x, y
    for idx in (78, 95, 88, 178, 87, 317, 402, 318, 324, 308,
                415, 310, 311, 312, 82, 81, 80, 191):
        pts[idx, :2] = .5, .66
    return pts


class FakeLocalLandmarker:
    def __init__(self, _model_path, video=False):
        self.video = video
        self.last_timestamp = -1

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def detect(self, bgr, timestamp_ms=None):
        if self.video:
            assert timestamp_ms is not None and timestamp_ms > self.last_timestamp
            self.last_timestamp = timestamp_ms
        return fake_landmarks(), {"jawOpen": .3, "mouthSmileLeft": .1}


class GeometryTests(unittest.TestCase):
    def test_face_report_has_surface_only(self):
        pts = fake_landmarks()
        d = measure_face(pts, 160, 160, {"jawOpen": .25}, detailed=True)
        self.assertEqual(d["count"], 478)
        self.assertEqual(len(d["allLandmarks"]), 478)
        self.assertFalse(d["boneMeasurementsAvailable"])
        self.assertFalse(d["internalTonguePositionAvailable"])
        self.assertGreater(d["mouth"]["openingWidthNormalizedRatio"], 0)
        self.assertEqual(d["blendshapes"]["jawOpen"], .25)
        with self.assertRaises(ValueError):
            measure_face(np.zeros((100, 3)), 160, 160)

    def test_mouth_warp_is_local_and_nonzero(self):
        frame = np.full((160, 160, 3), 140, dtype=np.uint8)
        cv2.rectangle(frame, (65, 104), (95, 109), (5, 5, 5), -1)
        target = deform_lips(frame, fake_landmarks(), target_open_ratio=.26)
        self.assertEqual(target.shape, frame.shape)
        self.assertGreater(np.abs(target.astype(np.int16) - frame.astype(np.int16)).sum(), 50)
        self.assertTrue(np.array_equal(target[:50, :50], frame[:50, :50]))
        self.assertTrue(np.array_equal(annotate_face(frame, fake_landmarks()).shape, frame.shape))

    def test_audio_curve_not_silent_and_variable(self):
        t = np.arange(16000) / 16000
        waveform = np.sin(2 * np.pi * 230 * t).astype(np.float32)
        waveform *= np.linspace(0.01, .75, 16000).astype(np.float32)
        curve = audio_to_opening_curve(waveform, 1., 0, 25)
        self.assertEqual(len(curve), 25)
        self.assertTrue(np.all(np.isfinite(curve)))
        self.assertGreater(float(curve.max() - curve.min()), .02)
        quiet = audio_to_opening_curve(np.zeros(16000, dtype=np.float32), 1.)
        self.assertTrue(np.allclose(quiet, .008))

    def test_full_mock_face_detection_video_pipeline(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image_path = root / "face.png"
            frame = np.full((160, 160, 3), 180, dtype=np.uint8)
            cv2.rectangle(frame, (65, 103), (95, 109), (5, 10, 10), -1)
            self.assertTrue(cv2.imwrite(str(image_path), frame))
            model_file = root / "fake-model.task"
            model_file.write_bytes(b"mock only")
            with patch("song_vision.face_geometry.LocalFaceLandmarker", FakeLocalLandmarker):
                photo = inspect_image(image_path, model_file, root / "face-report.json",
                                      root / "face-annotated.png")
            self.assertEqual(photo["engine"], VERSION)
            self.assertTrue((root / "face-annotated.png").exists())

            video = root / "stage.mp4"
            writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), 25., (160, 160))
            self.assertTrue(writer.isOpened())
            for i in range(25):
                writer.write(frame)
            writer.release()

            sound = root / "vocal.wav"
            samples = np.arange(16000, dtype=np.float32) / 16000
            amp = np.linspace(.02, .8, 16000)
            mono = (np.sin(2 * np.pi * 220 * samples) * amp * 12000).astype("<i2")
            with wave.open(str(sound), "wb") as fh:
                fh.setnchannels(1)
                fh.setsampwidth(2)
                fh.setframerate(16000)
                fh.writeframes(mono.tobytes())

            consent = root / "consent.json"
            consent.write_text(json.dumps(
                {"approved": True, "scope": "video_edit", "subjectId": "synthetic-subject"}
            ))
            output = root / "preview.mp4"
            with patch("song_vision.face_geometry.LocalFaceLandmarker", FakeLocalLandmarker):
                report = animate_video(video, sound, sound, model_file, consent,
                                       output, seconds=1.)
            self.assertTrue(output.is_file())
            self.assertGreater(output.stat().st_size, 1000)
            self.assertEqual(report["frames"], 25)
            self.assertIn("NOT_ACCURATE_PHONEME", report["status"])
            self.assertTrue(output.with_suffix(".geometry.json").exists())
            with patch("song_vision.face_geometry.LocalFaceLandmarker", FakeLocalLandmarker):
                with self.assertRaises(FileExistsError):
                    animate_video(video, sound, sound, model_file, consent, output, seconds=1.)


if __name__ == "__main__":
    unittest.main()
