"""SONG v11 tests: no real face or private singer data, no audio generator."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from song_vision.vocal_acoustics import (
    CUE_COUNT, CUE_CONTEXT, CUE_NAMES, analyze_vocal_cues, cue_window,
)
from song_vision.voice_to_face_v11 import (
    VocalDrivenFaceNet, VoiceFaceFrames, MODEL_VERSION, train_voice_to_face,
    _objective,
)
from song_vision.face_surface_motion import annotate_face_surface_dataset
from song_vision.test_joint_face_training import (
    SurfaceGeometryJointTests, FakeLocalLandmarker,
)


class VoiceToFaceV11Tests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    @staticmethod
    def audio_fixture():
        rate = 16000
        t = np.arange(rate, dtype=np.float32) / rate
        # Equalized pitch but changing amplitude and transient spectral body.
        envelope = np.where(t < .50, .02, .45).astype(np.float32)
        low = np.sin(2 * np.pi * 220 * t)
        high = np.sin(2 * np.pi * 2900 * t)
        waveform = envelope * np.where(t < .75, low, high)
        return waveform.astype(np.float32)

    def test_measured_vocal_loudness_transition_and_frequency_shape(self):
        cues = analyze_vocal_cues(self.audio_fixture())
        self.assertEqual(cues.shape[0], 8)
        self.assertEqual(len(CUE_NAMES), 8)
        self.assertEqual(cues.shape[1], 101)
        self.assertTrue(np.isfinite(cues).all())
        self.assertGreater(float(cues[0, 75]), float(cues[0, 25]) + .1)
        self.assertGreater(float(cues[4, 25]), float(cues[4, 88]))
        self.assertGreater(float(cues[6, 88]), float(cues[6, 25]))
        self.assertGreater(float(cues[2, 75]), 0.)
        self.assertEqual(cue_window(cues, .54).shape, (CUE_COUNT, CUE_CONTEXT))
        with self.assertRaises(ValueError):
            analyze_vocal_cues(np.array([.1, .2], dtype=np.float32))
        with self.assertRaises(ValueError):
            cue_window(cues[:7], .2)

    def test_silence_is_finite_not_false_phoneme_label(self):
        cues = analyze_vocal_cues(np.zeros(16000, dtype=np.float32))
        self.assertTrue(np.isfinite(cues).all())
        self.assertAlmostEqual(float(cues[0].max()), 0., places=6)
        self.assertEqual(len(CUE_NAMES), 8)
        self.assertNotIn("phoneme", " ".join(CUE_NAMES).lower())

    def test_voice_controls_and_spectrum_have_trainable_face_effect(self):
        net = VocalDrivenFaceNet()
        face = torch.rand(2, 3, 96, 96)
        mel = torch.rand(2, 80, 21)
        cues = torch.rand(2, 8, 61)
        lips, skin = net(face, mel, cues)
        self.assertEqual(lips.shape, (2, 3, 64, 64))
        self.assertEqual(skin.shape, (2, 38))
        new_lips, new_skin = net(face, mel, cues * .12)
        self.assertGreater(float((new_lips - lips).abs().sum()), 1e-7)
        self.assertGreater(float((new_skin - skin).abs().sum()), 1e-7)
        sample = (
            face, mel, cues, torch.rand_like(lips),
            torch.rand_like(skin) * .2, mel + .03, cues + .03,
            skin.detach() + .02, mel * .75, cues * .75,
        )
        loss = _objective(net, sample)
        self.assertTrue(torch.isfinite(loss).all())
        loss.backward()
        self.assertGreater(float(net.vocal_cue_encoder[0].weight.grad.abs().sum()), 0.)
        self.assertGreater(float(net.mouth.audio_encoder[0].weight.grad.abs().sum()), 0.)
        with self.assertRaises(ValueError):
            net(face, mel, torch.rand(2, 8, 21))

    def test_synthetic_real_audio_to_visible_face_study_checkpoint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ds = root / "prepared"
            fixture = SurfaceGeometryJointTests()
            fixture.fixture_dataset(ds)
            teacher = root / "synthetic-teacher.task"
            teacher.write_bytes(b"mock-detector-not-for-real-use")
            annotate_face_surface_dataset(
                ds, teacher, detector_factory=FakeLocalLandmarker)
            # These are measured from synthetic isolated waveform, exactly
            # aligned with the synthetic Mel time dimension.
            wave = self.audio_fixture()
            cues = analyze_vocal_cues(wave)[:, :100]
            self.assertEqual(cues.shape, (8,100))
            for split in ("train", "val"):
                clip = ds / split / f"research-{split}"
                np.save(clip / "vocal-cues-v1.npy", cues, allow_pickle=False)
                (clip / "index.json").read_text()
            study = VoiceFaceFrames(ds / "train")
            self.assertEqual(len(study), 15)
            self.assertEqual(study[0][2].shape, (8,61))
            checkpoint = root / "separate-v11-test-weights.pt"
            report = train_voice_to_face(
                ds, checkpoint, epochs=1, min_epochs=1,
                patience=1, batch_size=8,
            )
            self.assertEqual(report["modelVersion"], MODEL_VERSION)
            self.assertFalse(report["generatesOrTransformsVoice"])
            self.assertFalse(report["canAcceptPaidJobs"])
            self.assertEqual(report["trainFrames"], 15)
            for key in ("soundControlsSensitivity", "matchedVsShiftedVoiceGain",
                        "articulatoryFaceMAE", "mouthMAE"):
                self.assertIn(key, report["bestMetrics"])
            actual_weights = torch.load(checkpoint, map_location="cpu", weights_only=True)
            self.assertEqual(actual_weights["modelVersion"], MODEL_VERSION)
            self.assertEqual(actual_weights["epoch"], 1)
            self.assertEqual(len(actual_weights["acousticCueNames"]), 8)
            with self.assertRaises(FileExistsError):
                train_voice_to_face(ds, checkpoint, epochs=1, min_epochs=1,
                                    patience=1, batch_size=8)


if __name__ == "__main__":
    unittest.main()
