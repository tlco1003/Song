"""SONG v14 full-face renderer and same-source-audio comparisons.

All faces are synthetic circles on a grey background. The real-data
training workflow separately checks authentic untouched heldout actor A/V.
"""
import hashlib
import json
import tempfile
import unittest
import wave
from pathlib import Path

import cv2
import numpy as np
import torch

from song_vision.full_face_renderer_v14 import (
    FullFaceVocalRenderer, FullFaceVideoFrames,
    MODEL_VERSION, dynamic_region_masks,region_mae,
    face_region_loss, train_full_face,
)
from song_vision.paired_face_audit_v14 import audit_same_audio_video
from song_vision.staged_face_v13 import train_staged
from song_vision.test_staged_face_v13 import SongV13Tests
from song_vision.core import audio_features
from song_vision.vocal_acoustics import analyze_vocal_cues


class SingingFullFaceResearchTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    @staticmethod
    def make_genuine_test_wav(root: Path, dataset: Path):
        samplerate=16000
        t=np.arange(samplerate,dtype=np.float32)/samplerate
        sound=(np.sin(2*np.pi*210*t)*.4).astype(np.float32)
        samples=(sound*32767).astype("<i2")
        wav=root/"same-source-voice.wav"
        with wave.open(str(wav),"wb") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(samplerate)
            file.writeframes(samples.tobytes())
        full_wave=samples.astype(np.float32)/32768
        mel=audio_features(full_wave)
        cues=analyze_vocal_cues(full_wave)
        sha=hashlib.sha256(wav.read_bytes()).hexdigest()
        for split in ("train","val"):
            clip=dataset/split/f"research-{split}"
            np.save(clip/"mel.npy",mel,allow_pickle=False)
            np.save(clip/"vocal-cues-v1.npy",cues,allow_pickle=False)
            metadata=json.loads((clip/"index.json").read_text())
            metadata["sourceVocalsSha256"]=sha
            (clip/"index.json").write_text(json.dumps(metadata))
        return wav

    def test_full_face_renderer_shapes_regions_gradients_and_audio(self):
        renderer=FullFaceVocalRenderer()
        reference=torch.rand(2,3,96,96)
        mel=torch.rand(2,80,21)
        cues=torch.rand(2,8,61)
        motion=torch.rand(2,38)
        iris=torch.rand(2,4)
        output=renderer(reference,mel,cues,motion,iris)
        zone,parts=dynamic_region_masks()
        self.assertEqual(output.shape,reference.shape)
        self.assertEqual(parts.shape,(3,1,96,96))
        self.assertEqual(output[0,0,0,0],reference[0,0,0,0])
        target=torch.rand_like(reference)
        loss=face_region_loss(output,target)
        self.assertTrue(torch.isfinite(loss))
        loss.backward()
        self.assertGreater(float(renderer.condition[0].weight.grad.abs().sum()),0.)
        self.assertGreater(float(renderer.image_encoder[0].weight.grad.abs().sum()),0.)
        with self.assertRaises(ValueError):
            region_mae(reference,target,torch.zeros(1,1,96,96))
        with self.assertRaises(ValueError):
            renderer(reference,mel,torch.rand(2,8,10),motion,iris)

    def test_train_fullface_reconstruction_and_same_original_audio_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            ds=root/"private-synthetic-video"
            SongV13Tests.fixture_data(ds,review=False)
            original_wav=self.make_genuine_test_wav(root,ds)
            motion=root/"research-motion-v13.pt"
            train_staged(ds,motion,epochs_per_stage=(1,1,1,1),
                         batch_size=8)
            renderer_path=root/"study-whole-face-v14.pt"
            report=train_full_face(ds,motion,renderer_path,epochs=1,batch_size=8)
            self.assertEqual(report["modelVersion"],MODEL_VERSION)
            self.assertEqual(report["heldoutFrames"],15)
            self.assertFalse(report["commercialUseAllowed"])
            for field in ("fullFaceDynamicROI_MAE","staticReferenceDynamicROI_MAE",
                          "cheekZygomaticRegionMAE","eyeBrowRegionMAE",
                          "sameAudioBetterThanShiftedGain"):
                self.assertIn(field,report["bestValidation"])
            video=FullFaceVideoFrames(ds/"val")
            self.assertEqual(len(video),15)
            self.assertEqual(video[0][3].shape,(3,96,96))
            weights=torch.load(renderer_path,map_location="cpu",weights_only=True)
            self.assertEqual(weights["modelVersion"],MODEL_VERSION)
            audit=audit_same_audio_video(
                ds/"val"/"research-val",original_wav,
                motion,renderer_path,
                root/"PRIVATE_TEST_COMPARISON",max_frames=12)
            self.assertTrue(audit["sourceAudioIdenticalByteForByteInSidecar"])
            self.assertTrue(audit["losslessMuxedAudioIdenticalToOriginalPrefix"])
            self.assertEqual(audit["videoComparedFrames"],12)
            self.assertEqual(audit["metrics"]["frameCount"],11)
            self.assertFalse(audit["photorealisticVideoValidated"])
            self.assertTrue((root/"PRIVATE_TEST_COMPARISON"/
                             "side-by-side-with-original-vocal.mkv").is_file())
            with self.assertRaises(FileExistsError):
                train_full_face(ds,motion,renderer_path,epochs=1,batch_size=8)


if __name__=="__main__":
    unittest.main()
