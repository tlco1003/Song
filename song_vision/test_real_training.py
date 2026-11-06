"""Synthetic integration: videos and vocals -> prepared split -> trained checkpoint.

No real faces, commercial vocals, or user media are used in this test.
"""
import json
import tempfile
import unittest
import wave
from pathlib import Path

import cv2
import numpy as np

from song_vision.core import load_model, render
from song_vision.real_training import read_manifest, prepare_manifest, train_validated, validate_prepared


class RealDataTrainingPipelineTests(unittest.TestCase):
    def make_video(self, path, phase):
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 25, (160, 160))
        self.assertTrue(writer.isOpened())
        for i in range(20):
            frame = np.full((160, 160, 3), 174, np.uint8)
            cv2.ellipse(frame, (80, 80), (48, 56), 0, 0, 360, (190, 210, 235), -1)
            cv2.circle(frame, (62, 64), 4, (10, 10, 10), -1)
            cv2.circle(frame, (98, 64), 4, (10, 10, 10), -1)
            cv2.ellipse(frame, (80, 105), (17, 3 + (i + phase) % 7), 0, 0, 180, (20, 20, 20), -1)
            writer.write(frame)
        writer.release()

    def make_audio(self, path, frequency):
        sample_rate = 16000
        samples = np.arange(sample_rate, dtype=np.float32)
        tone = .2 * np.sin(2 * np.pi * frequency * samples / sample_rate)
        with wave.open(str(path), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes((tone * 32767).astype('<i2').tobytes())

    def test_consent_and_alignment_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for i in (0, 1):
                self.make_video(root / f'{i}.mp4', i)
                self.make_audio(root / f'{i}.wav', 220 + 100 * i)
            (root / 'consent.json').write_text(json.dumps({'approved':False,'scope':'train_singing','subjectId':'synthetic'}))
            specs = [{'id':f's{i}', 'split': 'train' if i == 0 else 'val',
                      'video':f'{i}.mp4', 'vocals':f'{i}.wav','consent':'consent.json',
                      'faceBox':[32,22,96,116], 'audioOffsetMs':0, 'maxSeconds':.8} for i in (0, 1)]
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'schemaVersion':1,'clips':specs}))
            with self.assertRaises(ValueError):
                read_manifest(manifest)
            (root / 'consent.json').write_text(json.dumps({'approved':True,'scope':'train_singing','subjectId':'synthetic'}))
            specs[1]['audioOffsetMs'] = 500
            manifest.write_text(json.dumps({'schemaVersion':1,'clips':specs}))
            with self.assertRaisesRegex(ValueError, 'timeline'):
                prepare_manifest(manifest, root / 'reject')

    def test_video_vocal_prepare_train_reload(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root/'consent.json').write_text(json.dumps({'approved':True,'scope':'train_singing','subjectId':'synthetic'}))
            specs = []
            for i in (0, 1):
                self.make_video(root / f'{i}.mp4', i)
                self.make_audio(root / f'{i}.wav', 230 + i * 110)
                specs.append({'id':f's{i}', 'split':'train' if i == 0 else 'val',
                              'video':f'{i}.mp4', 'vocals':f'{i}.wav','consent':'consent.json',
                              'faceBox':[32,22,96,116], 'audioOffsetMs':0, 'maxSeconds':.8})
            manifest = root/'manifest.json'
            manifest.write_text(json.dumps({'schemaVersion':1,'clips':specs}))
            prepared = prepare_manifest(manifest, root/'dataset')
            self.assertEqual(len(prepared), 2)
            self.assertEqual(prepared[0]['frames'], 20)
            self.assertEqual(validate_prepared(root/'dataset'), {'train':['s0'], 'val':['s1']})
            checkpoint = root/'checkpoints'/'model.pt'
            report = train_validated(root/'dataset', checkpoint, epochs=1, batch_size=10, lr=.0003)
            self.assertEqual(report['status'], 'research_only_not_lipsync_validated')
            self.assertTrue(checkpoint.exists())
            self.assertEqual(report['trainFrames'], 20)
            self.assertTrue(checkpoint.with_suffix('.training-report.json').exists())
            self.assertIsNotNone(load_model(checkpoint, 'cpu'))
            output = root / 'research-demo.mp4'
            quality = render(root / '0.mp4', root / '0.wav', root / '0.wav',
                             checkpoint, output, 1.0, 0.0, 'cpu', None, None,
                             face_box=(32, 22, 96, 116))
            self.assertTrue(output.exists())
            self.assertEqual(quality['status'], 'research_only_not_commercially_validated')


if __name__ == '__main__':
    unittest.main()
