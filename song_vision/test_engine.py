import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from song_vision.core import (
    SAMPLE_RATE, SingingMouthNet, assert_consent, audio_features,
    blend_mouth, mel_window, mouth_patch, tensor_patch
)


class SongVisionUnitTests(unittest.TestCase):
    def test_features_and_padding(self):
        samples = np.zeros(SAMPLE_RATE, dtype=np.float32)
        samples[100:200] = 0.4
        mel = audio_features(samples)
        self.assertEqual(mel.shape[0], 80)
        self.assertEqual(mel_window(mel, 0).shape, (80, 21))
        self.assertTrue(np.isfinite(mel).all())

    def test_model_forward_and_backward(self):
        model = SingingMouthNet()
        src = torch.rand(2, 3, 64, 64)
        audio = torch.rand(2, 80, 21)
        target = torch.rand(2, 3, 64, 64)
        output = model(src, audio)
        self.assertEqual(output.shape, target.shape)
        self.assertTrue(torch.isfinite(output).all())
        torch.nn.functional.l1_loss(output, target).backward()
        self.assertTrue(any(p.grad is not None for p in model.parameters()))

    def test_overlay_only_changes_mouth(self):
        frame = np.zeros((200, 200, 3), dtype=np.uint8)
        patch = np.full((64, 64, 3), 255, dtype=np.uint8)
        result = blend_mouth(frame, (50, 50, 100, 100), patch)
        self.assertTrue((result[:80, :30] == 0).all())
        self.assertGreater(int(result[125, 100, 0]), 0)
        self.assertEqual(mouth_patch(np.zeros((96, 96, 3), dtype=np.uint8)).shape, (64, 64, 3))
        self.assertEqual(tensor_patch(patch).shape, (3, 64, 64))

    def test_training_and_face_consent_required(self):
        with self.assertRaises(ValueError):
            assert_consent(None, "train_singing")
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "consent.json"
            file.write_text(json.dumps({"approved": False, "scope": "face_swap_prototype", "subjectId": "x"}))
            with self.assertRaises(ValueError):
                assert_consent(file)
            file.write_text(json.dumps({"approved": True, "scope": "face_swap_prototype", "subjectId": "x"}))
            assert_consent(file)


if __name__ == "__main__":
    unittest.main()
