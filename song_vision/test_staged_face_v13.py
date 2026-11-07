"""SONG v13 tests: real trainable branches, optional honest phonetic truth.

All face pictures, phoneme timestamps and audio tensors below are synthetic.
They are NOT proof of phonetic recognition or singing animation quality.
"""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from song_vision.face_surface_motion import annotate_face_surface_dataset
from song_vision.projected_iris_v13 import (
    IRIS_COUNT, measure_projected_iris, iris_motion_from_private_face_labels,
)
from song_vision.test_joint_face_training import fake_points
from song_vision.phoneme_targets_v13 import (
    CONSONANTS, VOWELS, IGNORE_LABEL, labels_at_second,
    read_reviewed_phone_timeline,
)
from song_vision.staged_face_v13 import (
    ART_IDS, EXPR_IDS, MODEL_VERSION, STAGES,
    StagedFaceFrames, StagedSingingFaceNet, _stage_loss,
    configure_stage, train_staged,
)
from song_vision.test_joint_face_training import (
    FakeLocalLandmarker, SurfaceGeometryJointTests,
)
from song_vision.vocal_acoustics import analyze_vocal_cues
from song_vision.test_voice_to_face_v11 import VoiceToFaceV11Tests


class SongV13Tests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    @staticmethod
    def reviewed_fixture(folder: Path):
        index_file = folder / "index.json"
        index = json.loads(index_file.read_text(encoding="utf-8"))
        sha = hashlib.sha256(b"synthetic-vocal-source-v13").hexdigest()
        index["sourceVocalsSha256"] = sha
        index_file.write_text(json.dumps(index), encoding="utf-8")
        segments = [
            {"kind": "rest", "startSeconds": 0., "endSeconds": .04},
            {"kind": "consonant", "symbol": "ㅁ", "startSeconds": .04, "endSeconds": .2},
            {"kind": "vowel", "symbol": "ㅏ", "startSeconds": .2, "endSeconds": .42},
            {"kind": "consonant", "symbol": "ㅂ", "startSeconds": .42, "endSeconds": .51},
            {"kind": "vowel", "symbol": "ㅜ", "startSeconds": .51, "endSeconds": .68},
            {"kind": "rest", "startSeconds": .68, "endSeconds": 1.0},
        ]
        content = {
            "schemaVersion": 1,
            "alignmentMethod": "human_reviewed_phonemes",
            "verified": True,
            "verifiedBy": "synthetic-unit-test",
            "timeBase": "vocal_file_seconds",
            "durationSeconds": 1.0,
            "vocalSha256": sha,
            "segments": segments,
        }
        p = folder / "phones-reviewed-v13.json"
        p.write_text(json.dumps(content), encoding="utf-8")
        return p, sha

    @staticmethod
    def fixture_data(root: Path, *, review=False):
        fixture = SurfaceGeometryJointTests()
        fixture.fixture_dataset(root)
        mock_task = root.parent / "FAKE-not-a-real-person.task"
        mock_task.write_bytes(b"synthetic-frozen-teacher")
        annotate_face_surface_dataset(
            root, mock_task, detector_factory=FakeLocalLandmarker)
        waveform = VoiceToFaceV11Tests.audio_fixture()
        cues = analyze_vocal_cues(waveform)[:, :100]
        for split in ("train", "val"):
            folder = root / split / f"research-{split}"
            np.save(folder / "vocal-cues-v1.npy", cues, allow_pickle=False)
            if review:
                SongV13Tests.reviewed_fixture(folder)

    def test_13_consonants_5_vowels_exact_contract(self):
        self.assertEqual(CONSONANTS, tuple("ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅋㅌㅍㅎ"))
        self.assertEqual(VOWELS, ("ㅏ", "ㅣ", "ㅜ", "ㅔ", "ㅗ"))
        self.assertGreater(len(ART_IDS), 8)
        self.assertGreater(len(EXPR_IDS), 12)
        self.assertEqual(STAGES, ("articulation", "prosody", "emotion", "fusion"))

    def test_projected_iris_geometry_is_observed_not_assumed_gaze(self):
        points = fake_points()
        baseline = measure_projected_iris(points)
        self.assertEqual(baseline.shape, (IRIS_COUNT,))
        shifted = points.copy()
        shifted[468, 0] += .015
        measured = measure_projected_iris(shifted)
        self.assertGreater(measured[0], baseline[0])
        self.assertAlmostEqual(float(measured[2]), float(baseline[2]), places=5)
        stacked = np.stack((points, shifted, points))
        relative, valid = iris_motion_from_private_face_labels(
            stacked, np.array([True, True, False]))
        self.assertEqual(relative.shape, (3, IRIS_COUNT))
        self.assertEqual(valid.tolist(), [True, True, False])
        self.assertFalse(np.isfinite(np.array([np.nan, 0.])).all())
        with self.assertRaises(ValueError):
            measure_projected_iris(np.zeros((20,3), dtype=np.float32))

    def test_manual_phone_audio_sha_and_time_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.mkdir(exist_ok=True)
            index = {"sourceVocalsSha256": ""}
            (root / "index.json").write_text(json.dumps(index))
            path, sha = self.reviewed_fixture(root)
            aligned = read_reviewed_phone_timeline(path, sha)
            self.assertEqual(labels_at_second(aligned, .10), (CONSONANTS.index("ㅁ"), IGNORE_LABEL))
            self.assertEqual(labels_at_second(aligned, .33), (IGNORE_LABEL, VOWELS.index("ㅏ")))
            self.assertEqual(labels_at_second(aligned, .9), (IGNORE_LABEL, IGNORE_LABEL))
            self.assertEqual(labels_at_second(None, .10), (IGNORE_LABEL, IGNORE_LABEL))
            with self.assertRaisesRegex(ValueError, "does not belong"):
                read_reviewed_phone_timeline(path, "0" * 64)
            data = json.loads(path.read_text())
            data["alignmentMethod"] = "forced_guess"
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "human-reviewed"):
                read_reviewed_phone_timeline(path, sha)

    def test_branch_freezing_and_each_loss_routes_gradients(self):
        net = StagedSingingFaceNet()
        face = torch.rand(2, 3, 96, 96)
        mel = torch.rand(2, 80, 21)
        cues = torch.rand(2, 8, 61)
        target_mouth = torch.rand(2, 3, 64, 64)
        motion_target = torch.rand(2, 38) * .25
        batch = (face, mel, cues, target_mouth, motion_target,
                 mel + .1, cues + .1, motion_target + .01,
                 mel * .5, cues * .5,
                 torch.tensor([0, -100]), torch.tensor([-100, 3]),
                 torch.tensor([2, -100]),
                 torch.rand(2, IRIS_COUNT) * .1, torch.tensor([True, False]))
        expectations = {
            "articulation": ("articulation_head", "articulation_encoder"),
            "prosody": ("prosody_head", "prosody_encoder"),
            "emotion": ("emotion_head", "emotion_encoder", "projected_iris_head"),
            "fusion": ("articulation_head", "backbone"),
        }
        for stage in STAGES:
            net.zero_grad(set_to_none=True)
            configure_stage(net, stage)
            out = net(face, mel, cues, stage=stage)
            self.assertEqual(out["mouth"].shape, target_mouth.shape)
            self.assertEqual(out["motion"].shape, motion_target.shape)
            self.assertEqual(out["projectedIrisMotion"].shape, (2, IRIS_COUNT))
            self.assertEqual(out["consonantLogits"].shape, (2, 13))
            self.assertEqual(out["vowelLogits"].shape, (2, 5))
            loss, counts = _stage_loss(net, batch, stage)
            self.assertTrue(torch.isfinite(loss))
            self.assertEqual(counts["verifiedConsonantFrames"], 1)
            self.assertEqual(counts["verifiedVowelFrames"], 1)
            loss.backward()
            for prefix in expectations[stage]:
                module = getattr(net, prefix)
                self.assertTrue(
                    any(p.grad is not None and float(p.grad.abs().sum()) > 0.
                        for p in module.parameters()),
                    f"{stage}: {prefix} must receive trainable gradients",
                )
            if stage != "fusion":
                self.assertFalse(any(p.requires_grad for p in net.backbone.parameters()))

    def test_four_real_training_stages_save_checkpoint_without_old_weights(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            ds = folder / "synthetic-prepared"
            self.fixture_data(ds, review=True)
            train = StagedFaceFrames(ds / "train")
            self.assertEqual(len(train), 15)
            self.assertGreater(train.reviewed_consonant_samples, 0)
            self.assertGreater(train.reviewed_vowel_samples, 0)
            model_path = folder / "v13-new-only.pt"
            report = train_staged(
                ds, model_path,
                epochs_per_stage=(1, 1, 1, 1), batch_size=8,
            )
            self.assertEqual(report["modelVersion"], MODEL_VERSION)
            self.assertEqual(report["stages"], list(STAGES))
            self.assertEqual(report["trainFrames"], 15)
            self.assertEqual(report["valFrames"], 15)
            self.assertGreater(report["trainReviewedConsonantSamples"], 0)
            self.assertGreater(report["trainReviewedVowelSamples"], 0)
            self.assertFalse(report["canAcceptPaidJobs"])
            self.assertTrue(report["estimated2dIrisMotionNotPhysicalEyeGaze"])
            self.assertGreater(report["finalValidation"]["projectedIrisFrameCount"], 0)
            self.assertIsNotNone(report["finalValidation"]["projectedIrisMotionMAE"])
            self.assertEqual(len(report["history"]), 4)
            self.assertIsNotNone(
                report["finalValidation"]["reviewedConsonantAccuracy"])
            self.assertIsNotNone(report["finalValidation"]["reviewedVowelAccuracy"])
            weights = torch.load(model_path, map_location="cpu", weights_only=True)
            self.assertEqual(weights["trainedStages"], STAGES)
            self.assertEqual(weights["modelVersion"], MODEL_VERSION)
            self.assertTrue(model_path.with_suffix(".report.json").is_file())
            with self.assertRaises(FileExistsError):
                train_staged(ds, model_path, epochs_per_stage=(1, 1, 1, 1), batch_size=8)

    def test_no_annotated_phones_does_not_falsely_train_classifier(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            ds = folder / "synthetic-prepared"
            self.fixture_data(ds, review=False)
            out = folder / "unannotated-v13.pt"
            report = train_staged(ds, out, epochs_per_stage=(1, 1, 1, 1),
                                  batch_size=8)
            self.assertEqual(report["trainReviewedConsonantSamples"], 0)
            self.assertEqual(report["trainReviewedVowelSamples"], 0)
            self.assertIsNone(report["finalValidation"]["reviewedConsonantAccuracy"])
            self.assertIn("EXACT_PHONEME_CLASSIFICATION_NOT_TRAINED_OR_VALIDATED",
                          report["diagnosticFlags"])


if __name__ == "__main__":
    unittest.main()
