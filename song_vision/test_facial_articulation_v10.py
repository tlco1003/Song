"""Offline SONG v10 eye / perioral / jaw acoustic training tests.

Only synthetic images and synthetic landmark teacher; no real human faces,
RAVDESS archives or secret keys in this test module.
"""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from song_vision.face_surface_motion import EXPRESSION_EXTRAS, annotate_face_surface_dataset
from song_vision.facial_articulation_v10 import (
    ARTICULATORY_IDS, FEATURE_COUNT, MODEL_VERSION, TARGET_NAMES,
    AudioFacialArticulationNet, TemporalFaceArticulationFrames,
    motion_error, multitask_loss, train_articulation,
)
from song_vision.test_joint_face_training import (
    FakeLocalLandmarker, SurfaceGeometryJointTests,
)


class JointEyesAndArticulationV10Tests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    def test_explicit_eye_cheek_jaw_perioral_features(self):
        self.assertEqual(FEATURE_COUNT, 38)
        for name in ("eyeBlinkLeft", "eyeSquintRight", "browInnerUp",
                     "mouthFunnel", "mouthPucker", "jawOpenBlendshape",
                     "chinVerticalToNose", "leftCheekVerticalToEye",
                     "rightCheekHorizontalToNose", "mouthPressLeft"):
            self.assertIn(name, TARGET_NAMES)
        self.assertIn(TARGET_NAMES.index("mouthFunnel"), ARTICULATORY_IDS)
        self.assertNotIn(TARGET_NAMES.index("eyeBlinkLeft"), ARTICULATORY_IDS)
        self.assertEqual(len(EXPRESSION_EXTRAS), 26)

    def test_model_uses_acoustic_time_and_eye_context(self):
        model = AudioFacialArticulationNet()
        face = torch.rand(2, 3, 96, 96)
        vocal = torch.rand(2, 80, 21)
        predicted, dynamics = model(face, vocal)
        self.assertEqual(predicted.shape, (2, 3, 64, 64))
        self.assertEqual(dynamics.shape, (2, FEATURE_COUNT))
        changed_lip, changed_expression = model(face, vocal + 2)
        self.assertGreater(float((dynamics - changed_expression).abs().sum()), 1e-7)
        self.assertGreater(float((predicted - changed_lip).abs().sum()), 1e-7)

        target = torch.rand_like(predicted)
        motion = torch.randn_like(dynamics) * .1
        sample = (face, vocal, target, motion, vocal + .2,
                  motion + .05, vocal + 2.)
        loss = multitask_loss(model, sample, contrastive=True)
        self.assertTrue(torch.isfinite(loss).all())
        loss.backward()
        self.assertGreater(float(model.motion_predictor[-1].weight.grad.abs().sum()), 0)
        self.assertGreater(float(model.mouth.audio_encoder[0].weight.grad.abs().sum()), 0)
        self.assertGreater(float(model.face_encoder[0].weight.grad.abs().sum()), 0)
        with self.assertRaises(ValueError):
            motion_error(dynamics, torch.zeros(2, 12))

    def test_synthetic_labels_eyeblinks_and_temporal_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dataset = root / "prepared"
            fixture = SurfaceGeometryJointTests()
            fixture.fixture_dataset(dataset)
            model_file = root / "fake-local-landmarker.task"
            model_file.write_bytes(b"fake-only")
            summary = annotate_face_surface_dataset(
                dataset, model_file, detector_factory=FakeLocalLandmarker)
            self.assertEqual(summary["train"]["valid"], 16)
            self.assertEqual(summary["val"]["valid"], 16)
            samples = TemporalFaceArticulationFrames(dataset / "train")
            self.assertEqual(len(samples), 15)
            self.assertEqual(tuple(samples[0][0].shape), (3, 96, 96))
            self.assertEqual(tuple(samples[0][3].shape), (FEATURE_COUNT,))
            self.assertEqual(tuple(samples[0][4].shape), (80, 21))
            # Always preserve old study files; output must be exclusive create.
            ckpt = root / "new-v10-raw-research.pt"
            report = train_articulation(
                dataset, ckpt, epochs=1, min_epochs=1, patience=1,
                batch_size=8)
            self.assertEqual(report["modelVersion"], MODEL_VERSION)
            self.assertEqual(report["trainFrames"], 15)
            self.assertEqual(report["valFrames"], 15)
            self.assertFalse(report["canAcceptPaidJobs"])
            self.assertTrue(report["surfaceMeasurementsNotActualMuscleOrBones"])
            for field in ("eyesBrowMAE", "cheeksMAE", "lipJawMAE",
                          "temporalDeltaMAE", "correctVsShiftedAudioGain"):
                self.assertIn(field, report["bestMetrics"])
            checkpoint = torch.load(ckpt, map_location="cpu", weights_only=True)
            self.assertEqual(checkpoint["epoch"], 1)
            self.assertEqual(checkpoint["modelVersion"], MODEL_VERSION)
            self.assertTrue(ckpt.with_suffix(".report.json").is_file())
            with self.assertRaises(FileExistsError):
                train_articulation(dataset, ckpt, epochs=1, min_epochs=1,
                                   patience=1, batch_size=8)


if __name__ == "__main__":
    unittest.main()
