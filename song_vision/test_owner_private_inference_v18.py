"""Safe public test fixtures only; no biometric media or owner weights checked into GitHub."""
from __future__ import annotations
import tempfile
import unittest
from pathlib import Path
import numpy as np
import torch

from owner_private_inference_v18 import (
    OwnerV18PhotoAudioNet, load_private_owner_v18,
    training_compatible_mel, frame_audio_window,
)


class OwnerExternalV18IntegrationTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(409)
        torch.set_num_threads(2)

    def test_model_load_is_strict_and_deterministic(self):
        raw=OwnerV18PhotoAudioNet().eval()
        a=torch.rand(1,3,96,96)
        b=torch.rand(1,80,31)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'owner_private.pt'
            torch.save({'modelVersion':'SONG-Vision-v18-owner-audio-and-photo-research',
                'soundToFaceStateDict':raw.state_dict(),
                'referencePhotos':[{'filename':'synthetic-owner-photo-1'}],
                'RAVDESSTrainingWeightsUsed':False,
                'AM630LipSyncAccuracyValidated':False},p)
            loaded,meta=load_private_owner_v18(p)
            self.assertEqual(meta['referencePhotoCount'],1)
            self.assertTrue(meta['researchOnly'])
            with torch.no_grad():
                self.assertTrue(torch.equal(raw(a,b),loaded(a,b)))

    def test_fail_closed_on_provenance_or_asserted_quality(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'bad.pt'
            for licensed,validated in ((True,False),(False,True)):
                torch.save({'modelVersion':'SONG-Vision-v18-owner-audio-and-photo-research',
                    'RAVDESSTrainingWeightsUsed':licensed,
                    'AM630LipSyncAccuracyValidated':validated,
                    'soundToFaceStateDict':OwnerV18PhotoAudioNet().state_dict()},p)
                with self.assertRaises(ValueError):
                    load_private_owner_v18(p)

    def test_no_unknown_external_mel_scaling_or_false_word_alignment(self):
        n=np.arange(16000*2,dtype=np.float32)
        wave=.12*np.sin(2*np.pi*225*n/16000)
        features=training_compatible_mel(wave)
        self.assertEqual(features.shape,(80,201))
        self.assertTrue(np.isfinite(features).all())
        v=frame_audio_window(features,1.25)
        self.assertEqual(v.shape,(1,80,31))
        self.assertFalse(torch.equal(v,frame_audio_window(features,0.15)))

    def test_reject_bad_inputs(self):
        m=OwnerV18PhotoAudioNet()
        with self.assertRaises(ValueError):
            m(torch.rand(1,3,96,96),torch.rand(1,80,21))
        with self.assertRaises(ValueError):
            frame_audio_window(np.zeros((80,200),dtype=np.float32),-2.)


if __name__=='__main__': unittest.main()