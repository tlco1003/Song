"""v15 experiments: Korean word meaning + sentence context + projected jaw/muscle/skin.

All media, word norms and faces in these unit tests are SYNTHETIC, not
evidence that a real Korean singer's emotions or facial muscles are solved.
"""
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from song_vision.word_feelings_v15 import (
    VERSION as WORD_VERSION, LearnedWordFeeling,
    read_norms_csv,train_word_meanings,encode_phrase
)
from song_vision.lyric_intent_v15 import (
    load_reviewed_song_words,reviewed_context_at_time
)
from song_vision.learned_face_body_v15 import (
    TrainableProjectedFaceRig,RecordedFaceSkinSamples,train_skin_projection,
    soft_skin_smoothness,projected_tissue_warp,VERSION as RIG_VERSION,
)
from song_vision.test_staged_face_v13 import SongV13Tests
from song_vision.staged_face_v13 import train_staged


class WordEmotionFaceBodyUnitTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    @staticmethod
    def synthetic_word_csv(count=360):
        # The values are random MOCK raters; only syntax and training route.
        records=["lexicon,representative,prototypicality,familiarity,valence,arousal"]
        for i in range(count):
            word="감정"+chr(0xAC00+i)
            val=1.+((i*17)%300)/100.
            act=1.+((i*29)%320)/100.
            records.append(f"{word},False,2.50,2.00,{val:.2f},{act:.2f}")
        return ("\n".join(records)+"\n").encode()

    def test_real_structure_word_norm_train_and_phrase_encoder(self):
        raw=self.synthetic_word_csv()
        data,meta=read_norms_csv(raw)
        self.assertEqual(len(data),360)
        self.assertTrue(np.isfinite(data[0][1]).all())
        words=torch.stack([encode_phrase("너를 보고 싶었어")[0],
                           encode_phrase("너를 떠나고 싶었어")[0]])
        flags=torch.stack([encode_phrase("너를 보고 싶었어")[1],
                           encode_phrase("너를 떠나고 싶었어")[1]])
        net=LearnedWordFeeling()
        out=net(words,flags)
        self.assertEqual(out["wordFeatures"].shape,(2,32,64))
        self.assertEqual(out["wordNormEstimates"].shape,(2,32,2))
        self.assertGreater(float((out["phraseFeature"][0]-
                                  out["phraseFeature"][1]).abs().sum()),0.)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            checkpoint=root/"word-research-v15.pt"
            report=train_word_meanings(raw,checkpoint,epochs=1)
            self.assertEqual(report["modelVersion"],WORD_VERSION)
            self.assertFalse(report["wordNormsNotActualSingerEmotion"] is False)
            self.assertFalse(report["canAcceptPaidJobs"])
            state=torch.load(checkpoint,map_location="cpu",weights_only=True)
            self.assertEqual(state["modelVersion"],WORD_VERSION)
            with self.assertRaises(ValueError):
                train_word_meanings(raw,checkpoint,epochs=1)

    def test_same_word_has_different_context_and_singer_intent(self):
        sha=hashlib.sha256(b"exact-singer-audio").hexdigest()
        lyric="보고싶어 이제 널 보고싶어 너를 원망해"
        payload={
            "schemaVersion":1,"reviewStatus":"human_verified",
            "verifiedBy":"synthetic-human-annotation-fixture",
            "sourceVocalSha256":sha,"title":"synthetic-test-not-real-song",
            "fullLyrics":lyric,
            "lyricsSha256":hashlib.sha256(lyric.encode()).hexdigest(),
            "words":[
                {"word":"보고싶어","startSeconds":0,"endSeconds":.5,
                 "expressiveIntent":{"valence":.8,"arousal":.4,"tension":-.2,"warmth":.9}},
                {"word":"이제","startSeconds":.5,"endSeconds":.8},
                {"word":"널","startSeconds":.8,"endSeconds":1.1},
                {"word":"보고싶어","startSeconds":1.1,"endSeconds":1.6,
                 "expressiveIntent":{"valence":-.6,"arousal":.4,"tension":.8,"warmth":-.7}},
            ],
        }
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/"lyrics-reviewed-v15.json"
            file.write_text(json.dumps(payload,ensure_ascii=False),encoding="utf-8")
            checked=load_reviewed_song_words(file,sha)
            first=reviewed_context_at_time(checked,.2,radius=1)
            last=reviewed_context_at_time(checked,1.2,radius=1)
            self.assertEqual(first["activeWord"],last["activeWord"])
            self.assertTrue(first["intentValid"])
            self.assertTrue(last["intentValid"])
            self.assertNotEqual(first["intent"].tolist(),last["intent"].tolist())
            self.assertNotEqual(first["codes"].tolist(),last["codes"].tolist())
            absent=reviewed_context_at_time(checked,2.)
            self.assertFalse(absent["reviewedWordPresent"])
            self.assertFalse(reviewed_context_at_time(None,.2)["reviewedWordPresent"])
            payload["sourceVocalSha256"]="0"*64
            file.write_text(json.dumps(payload,ensure_ascii=False),encoding="utf-8")
            with self.assertRaisesRegex(ValueError,"Verified original singer"):
                load_reviewed_song_words(file,sha)

    @staticmethod
    def fake_projected_landmarks(n=2):
        rng=np.random.default_rng(11)
        xy=rng.uniform(.20,.80,(n,478,2)).astype(np.float32)
        points=np.concatenate((xy,np.zeros((n,478,1),dtype=np.float32)),axis=2)
        points[:,4,:2]=[.50,.43]
        points[:,152,:2]=[.50,.85]
        points[:,33,:2]=[.32,.36]
        points[:,263,:2]=[.68,.36]
        return torch.from_numpy(points)

    def test_differentiable_face_rig_muscles_jaw_and_skin_are_proxies(self):
        rig=TrainableProjectedFaceRig()
        reference=self.fake_projected_landmarks()
        motion=torch.randn(2,38)*.15
        gaze=torch.randn(2,4)*.02
        acoustic=torch.randn(2,8,61)
        meaning=torch.randn(2,64)
        word_emotion=torch.tensor([[.8,.5,-.4,.9],[-.7,.6,.5,-.6]])
        prediction=rig(reference,motion,gaze,acoustic,meaning,
                       word_emotion,torch.ones(2,1))
        self.assertEqual(prediction["predictedSurfacePoints"].shape,(2,478,3))
        self.assertEqual(prediction["estimatedFacialActivationProxy"].shape,(2,14))
        self.assertTrue(torch.isfinite(prediction["predictedSurfacePoints"]).all())
        zero=rig(reference,motion,gaze,acoustic,meaning,
                 word_emotion,torch.zeros(2,1))
        self.assertGreater(float((zero["predictedSurfacePoints"]-
                                  prediction["predictedSurfacePoints"]).abs().sum()),1e-7)
        # The *source image* is warped using projected skin, not regenerated audio.
        image=torch.rand(2,3,96,96)
        visual=projected_tissue_warp(
            image,reference,prediction["predictedSurfacePoints"])
        self.assertEqual(visual.shape,image.shape)
        self.assertTrue(torch.isfinite(visual).all())
        target=reference.clone()
        target[:,152,1]+=.02
        loss=(prediction["predictedSurfacePoints"][:,:,:2]-target[:,:,:2]).abs().mean()
        loss+=.1*soft_skin_smoothness(
            reference,prediction["predictedSurfacePoints"])
        loss.backward()
        self.assertGreater(float(rig.expression_motion[-1].weight.grad.abs().sum()),0.)
        with self.assertRaises(ValueError):
            projected_tissue_warp(image,reference[:,:20],prediction["predictedSurfacePoints"])

    def test_actual_four_stage_train_then_skin_tissue_train_synthetic_fixture(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            dataset=root/"prepared"
            SongV13Tests.fixture_data(dataset,review=False)
            motion=root/"new-v13-motion.pt"
            train_staged(dataset,motion,epochs_per_stage=(1,1,1,1),
                         batch_size=8)
            lexicon=root/"word-v15.pt"
            train_word_meanings(self.synthetic_word_csv(),lexicon,epochs=1)
            stored=root/"new-skin-physics-v15.pt"
            report=train_skin_projection(dataset,motion,lexicon,
                                         stored,epochs=1,batch_size=8)
            self.assertEqual(report["modelVersion"],RIG_VERSION)
            self.assertGreater(report["trainingFrames"],0)
            self.assertEqual(report["bestValidation"]["semanticReviewedFrameCount"],0)
            self.assertIn("NO_WORD_TIMED_FACIAL_SEMANTIC_TRAINING_DATA",
                          report["diagnosticFlags"])
            self.assertTrue(stored.is_file())
            with self.assertRaises(ValueError):
                train_skin_projection(dataset,motion,lexicon,
                                      stored,epochs=1,batch_size=8)


if __name__=="__main__":
    unittest.main()
