"""Offline tests for joint singing face geometry. Synthetic images and landmarks only."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import torch

from song_vision.face_surface_motion import (
    FEATURE_NAMES, FEATURE_SCALE, measure_surface_feature_vector,
    annotate_face_surface_dataset,
)
from song_vision.joint_face_training import (
    JOINT_MODEL_VERSION, JointSingingFaceNet, SurfaceLabeledFrames,
    joint_loss, surface_loss, train_joint,
)
from song_vision.masked_retrain import load_masked_model


def fake_points(i=0):
    pts = np.zeros((478, 3), dtype=np.float32)
    pts[:, 0], pts[:, 1] = .5, .5
    coords = {
        33: (.34, .37), 133: (.43, .37),
        263: (.66, .37), 362: (.57, .37),
        1: (.5, .51),
        13: (.5, .635), 14: (.5, .664 + .002 * (i % 4)),
        61: (.38, .645), 291: (.62, .645),
        152: (.5, .89 + .001 * (i % 4)),
        205: (.32, .56 + .001 * i), 425: (.68, .56 + .002 * (i % 4)),
        234: (.26, .58), 454: (.74, .58)
    }
    for index, (x, y) in coords.items():
        pts[index, 0:2] = x, y
    return pts


def fake_shapes(i=0):
    return {
        "jawOpen": .12 + .04 * (i % 4),
        "cheekPuff": .08 + .01 * i,
        "cheekSquintLeft": .13 + .01 * (i % 4),
        "cheekSquintRight": .1 + .01 * (i % 4),
    }


class FakeLocalLandmarker:
    def __init__(self, task, video=False):
        self.index = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def detect(self, image, timestamp_ms=None):
        index = self.index
        self.index += 1
        return fake_points(index), fake_shapes(index)


class SurfaceGeometryJointTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    def fixture_dataset(self, root):
        for split, phase in (("train", 0), ("val", 1)):
            clip = root / split / ("research-" + split)
            frames = clip / "frames"
            frames.mkdir(parents=True)
            records = []
            for i in range(16):
                frame = np.full((96, 96, 3), 140 + phase * 3, dtype=np.uint8)
                cv2.ellipse(frame, (48, 70), (12, 4 + i % 4), 0, 0, 360, (20, 20, 20), -1)
                fname = f"{i:06d}.png"
                self.assertTrue(cv2.imwrite(str(frames / fname), frame))
                records.append({"file": fname, "seconds": float(i) / 25})
            (clip / "index.json").write_text(json.dumps({
                "schemaVersion": 2, "split": split, "clipId": "research-" + split,
                "frames": records, "consentEvidenceSha256": "mock-research",
                "consentSubjectId": "synthetic-face-not-human",
            }))
            np.save(clip / "mel.npy", np.random.default_rng(phase).random((80, 100))
                    .astype(np.float32), allow_pickle=False)

    def test_jaw_and_zygomatic_surface_metrics_change_independently(self):
        neutral = measure_surface_feature_vector(fake_points(), fake_shapes())
        jaw = fake_points()
        jaw[152, 1] += .03
        output = measure_surface_feature_vector(jaw, fake_shapes())
        self.assertGreater(output[3], neutral[3])
        self.assertAlmostEqual(float(output[4]), float(neutral[4]), places=5)
        cheek = fake_points()
        cheek[205, 1] -= .03
        changed = measure_surface_feature_vector(cheek, fake_shapes())
        self.assertLess(changed[4], neutral[4])
        self.assertAlmostEqual(float(changed[3]), float(neutral[3]), places=5)
        self.assertEqual(neutral.shape, (12,))
        with self.assertRaises(ValueError):
            measure_surface_feature_vector(np.zeros((100, 3)), fake_shapes())
        with self.assertRaisesRegex(ValueError, "scores required"):
            measure_surface_feature_vector(fake_points(), {})

    def test_local_only_surface_label_extraction_and_shape_validation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            dataset = root / "dataset"
            self.fixture_dataset(dataset)
            model_file = root / "offline-model.task"
            model_file.write_bytes(b"synthetic fake marker")
            counts = annotate_face_surface_dataset(
                dataset, model_file, detector_factory=FakeLocalLandmarker)
            self.assertEqual(counts["train"]["valid"], 16)
            self.assertEqual(counts["val"]["valid"], 16)
            first = dataset / "train" / "research-train" / "face-surface-v1.npz"
            with np.load(first) as record:
                self.assertEqual(record["motion"].shape, (16, 12))
                self.assertEqual(record["surfacePoints"].shape, (16, 478, 3))
                self.assertTrue(record["valid"].all())
                self.assertTrue(np.allclose(np.median(record["observed"], axis=0),
                                            record["median"], atol=1e-5))
            with self.assertRaises(FileExistsError):
                annotate_face_surface_dataset(
                    dataset, model_file, detector_factory=FakeLocalLandmarker)

    def test_shared_audio_and_face_motion_head_both_receive_gradients(self):
        net = JointSingingFaceNet()
        source = torch.rand(2, 3, 64, 64)
        acoustics = torch.rand(2, 80, 21)
        video_target = torch.rand(2, 3, 64, 64)
        surface_gt = torch.rand(2, 12) * .4
        output, motion = net(source, acoustics)
        self.assertEqual(tuple(output.shape), tuple(video_target.shape))
        self.assertEqual(tuple(motion.shape), (2, 12))
        loss = joint_loss(output, video_target, motion, surface_gt)
        loss.backward()
        self.assertGreater(float(net.motion_head[-1].weight.grad.abs().sum()), 0)
        self.assertGreater(float(net.mouth.audio_encoder[0].weight.grad.abs().sum()), 0)
        self.assertGreater(float(net.motion_feedback.weight.grad.abs().sum()), 0)
        with self.assertRaises(ValueError):
            surface_loss(motion, torch.zeros(2, 11))
        changed, changed_motion = net(source, acoustics + 5.)
        self.assertGreater(float((motion - changed_motion).abs().sum()), 1e-7)
        self.assertGreater(float((output - changed).abs().sum()), 1e-7)

    def test_synthetic_one_epoch_training_and_checkpoint(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            data = root / "prepared"
            self.fixture_dataset(data)
            model = root / "mock.task"
            model.write_bytes(b"fake model")
            annotate_face_surface_dataset(data, model, detector_factory=FakeLocalLandmarker)
            study = SurfaceLabeledFrames(data / "train")
            self.assertEqual(len(study), 16)
            self.assertEqual(study[0][3].shape, (12,))
            ckpt = root / "joint.pt"
            report = train_joint(data, ckpt, epochs=1, min_epochs=1, batch_size=8)
            self.assertEqual(report["modelVersion"], JOINT_MODEL_VERSION)
            self.assertEqual(report["trainFrames"], 16)
            self.assertEqual(report["valFrames"], 16)
            self.assertFalse(report["canAcceptPaidJobs"])
            self.assertFalse(report["anatomicalBoneMeasurementsAvailable"])
            self.assertIn("cheekMotionMAE", report["bestMetrics"])
            self.assertIn("chinJawMAE", report["bestMetrics"])
            payload = torch.load(ckpt, map_location="cpu", weights_only=True)
            self.assertEqual(payload["modelVersion"], JOINT_MODEL_VERSION)
            self.assertEqual(payload["epoch"], 1)
            self.assertTrue(ckpt.with_suffix(".report.json").is_file())
            with self.assertRaises(FileExistsError):
                train_joint(data, ckpt, epochs=1, min_epochs=1, batch_size=8)


if __name__ == "__main__":
    unittest.main()
