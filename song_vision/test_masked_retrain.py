"""Synthetic masked-reference retrain tests; never uploads face data or checkpoints."""
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
import torch

from song_vision.masked_retrain import (
    MASKED_MODEL_VERSION, MaskedSingingMouthNet, hide_reference_mouth,
    load_masked_model, masked_loss, masked_retrain,
)


class MaskedTrainingResearchTests(unittest.TestCase):
    def test_reference_lips_are_not_visible_to_image_encoder(self):
        base = torch.rand(2, 3, 64, 64)
        modified = base.clone()
        modified[:, :, 10:55, 7:57] = torch.rand_like(modified[:, :, 10:55, 7:57])
        self.assertTrue(torch.equal(hide_reference_mouth(base), hide_reference_mouth(modified)))
        self.assertFalse(torch.equal(base, modified))
        with self.assertRaises(ValueError):
            hide_reference_mouth(torch.rand(1, 3, 32, 32))

    def test_audio_perturbation_changes_forward_pass_and_gradient(self):
        torch.manual_seed(13)
        model = MaskedSingingMouthNet()
        reference = torch.rand(2, 3, 64, 64)
        audio1 = torch.randn(2, 80, 21)
        audio2 = audio1.clone() + 1.2
        prediction1 = model(reference, audio1)
        prediction2 = model(reference, audio2)
        self.assertEqual(tuple(prediction1.shape), (2, 3, 64, 64))
        self.assertGreater(float((prediction1 - prediction2).abs().mean()), 1e-7)
        loss = masked_loss(prediction1, torch.rand_like(prediction1))
        loss.backward()
        self.assertTrue(all(p.grad is not None for p in model.audio_encoder.parameters()))
        self.assertTrue(any(float(p.grad.abs().sum()) > 0 for p in model.audio_encoder.parameters()))

    def test_train_validate_save_and_reload_masked_version(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            dataset = root / "dataset"
            for split, phase in [("train", 0), ("val", 2)]:
                clip = dataset / split / f"synthetic-{split}"
                frames = clip / "frames"
                frames.mkdir(parents=True)
                records = []
                # These fixtures are synthetic, never actual RAVDESS/face photographs.
                for i in range(16):
                    image = np.full((96, 96, 3), 120 + phase, np.uint8)
                    cv2.rectangle(image, (32, 66), (64, 70 + i % 5), (30, 40, 50), -1)
                    filename = f"{i:06d}.png"
                    self.assertTrue(cv2.imwrite(str(frames / filename), image))
                    records.append({"file": filename, "seconds": i / 25})
                (clip / "index.json").write_text(json.dumps({
                    "schemaVersion": 2, "split": split, "clipId": f"synthetic-{split}",
                    "frames": records, "consentEvidenceSha256": "test-fixture-only",
                    "consentSubjectId": "synthetic-not-human",
                }))
                mel = np.random.default_rng(phase).random((80, 100)).astype(np.float32)
                np.save(clip / "mel.npy", mel, allow_pickle=False)
            checkpoint = root / "masked-research.pt"
            report = masked_retrain(dataset, checkpoint, epochs=1, batch_size=8, seed=17)
            self.assertEqual(report["modelVersion"], MASKED_MODEL_VERSION)
            self.assertEqual(report["trainFrames"], 16)
            self.assertEqual(report["valFrames"], 16)
            self.assertFalse(report["canAcceptPaidJobs"])
            self.assertIn("correctVsShuffledMAEGain", report["bestMetrics"])
            self.assertTrue(checkpoint.is_file())
            self.assertTrue(checkpoint.with_suffix(".report.json").is_file())
            model = load_masked_model(checkpoint)
            self.assertIsInstance(model, MaskedSingingMouthNet)
            source_bytes = checkpoint.read_bytes()
            with self.assertRaises(FileExistsError):
                masked_retrain(dataset, checkpoint, epochs=1, batch_size=8, seed=17)
            next_checkpoint = root / "warm-start-research.pt"
            warm_report = masked_retrain(
                dataset, next_checkpoint, epochs=1, batch_size=8,
                seed=17, init_checkpoint=checkpoint)
            self.assertTrue(warm_report["warmStartedFromPriorWeights"])
            self.assertFalse(warm_report["optimizerStateRestored"])
            self.assertTrue(next_checkpoint.is_file())
            self.assertEqual(checkpoint.read_bytes(), source_bytes)
            self.assertIsInstance(load_masked_model(next_checkpoint),
                                  MaskedSingingMouthNet)


if __name__ == "__main__":
    unittest.main()
