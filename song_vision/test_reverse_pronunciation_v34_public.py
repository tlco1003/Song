import unittest
import numpy as np
from reverse_pronunciation_v34 import VOWELS, triangular_mel, audio_features, visual_features

class PublicSyntheticTests(unittest.TestCase):
    def test_inventory(self):
        self.assertEqual(len(VOWELS),10)
        self.assertEqual(len(set(VOWELS)),10)
    def test_mel_nonnegative(self):
        m=triangular_mel(16000,512)
        self.assertEqual(m.shape,(28,257))
        self.assertTrue(np.isfinite(m).all())
        self.assertGreaterEqual(float(m.min()),0)
    def test_audio_features(self):
        sr=16000
        t=np.arange(sr)/sr
        wave=np.sin(t*2*np.pi*200)+0.15*np.sin(t*2*np.pi*1100)
        x=audio_features(wave,sr,.1,.6)
        self.assertEqual(x.shape,(54,))
        self.assertTrue(np.isfinite(x).all())
    def test_video_proxies(self):
        r=dict(oralDarkCandidateAreaPx='200',oralCandidateWidthPx='30',oralCandidateHeightPx='12',lipRedCandidateWidthPx='80',lipRedCandidateHeightPx='35')
        x=visual_features(r)
        self.assertEqual(x.shape,(10,))
        self.assertTrue(np.isfinite(x).all())

if __name__=='__main__':unittest.main()
