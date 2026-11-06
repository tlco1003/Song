"""Synthetic-only integration test: train and reload a tiny checkpoint, no real faces."""
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from song_vision.core import load_model, train


class LocalTrainingTests(unittest.TestCase):
    def test_synthetic_training_checkpoint_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            singer = root / 'training' / 'synthetic'
            folder = singer / 'frames'
            folder.mkdir(parents=True)
            records = []
            for i in range(16):
                image = np.full((96, 96, 3), 128, dtype=np.uint8)
                cv2.circle(image, (48, 68), 5 + (i % 5), (40, 40, 40), -1)
                filename = f'{i:06d}.png'
                self.assertTrue(cv2.imwrite(str(folder / filename), image))
                records.append({'file': filename, 'seconds': i / 25})
            (singer / 'index.json').write_text(json.dumps({'frames': records}), encoding='utf-8')
            np.save(singer / 'mel.npy', np.zeros((80, 100), dtype=np.float32), allow_pickle=False)
            checkpoint = root / 'checkpoints' / 'model.pt'
            train(root / 'training', checkpoint, epochs=1, batch_size=4,
                  learning_rate=.0003, device='cpu')
            self.assertTrue(checkpoint.exists())
            self.assertIsNotNone(load_model(checkpoint, 'cpu'))


if __name__ == '__main__':
    unittest.main()
