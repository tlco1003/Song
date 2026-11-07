"""Synthetic timing tests; no claim of real singing alignment/face accuracy."""
import tempfile
import unittest
from pathlib import Path
import numpy as np
import torch
from song_vision.text_audio_plan_v17 import (UNITS,UNIT_TO_ID,LyricUnits,units_from_given_text,
    LyricsAcousticAligner,forced_align_units,plan_at_video_times)
from song_vision.text_timed_face_v17 import TextTimedSingingFaceNet,conditioned_training_loss,bind_timed_word_context
from song_vision import test_contextual_face_v16 as fixtures
from song_vision.contextual_training_v16 import ContextualFaceSequences,collate_sequences


class GivenTextTimingTests(unittest.TestCase):
    def setUp(self): torch.manual_seed(8); torch.set_num_threads(2)

    def test_given_korean_text_keeps_word_identity_and_truth_status(self):
        units=units_from_given_text('엄마 사랑해')
        self.assertEqual(units.words,('엄마','사랑해'))
        self.assertEqual(set(units.word_indices),{0,1})
        self.assertIn('not_pronunciation_ground_truth',units.source)
        latin=units_from_given_text('Kids are singing')
        self.assertIn('latin_not_phoneme_ground_truth',latin.source)
        self.assertEqual(latin.words,('Kids','are','singing'))
        self.assertEqual(len(latin.unit_ids),len('Kidsaresinging'))
        with self.assertRaises(ValueError): units_from_given_text('1234')

    def test_long_vowel_and_repeated_units_follow_audio_not_equal_split(self):
        a=UNIT_TO_ID['ㅏ']; m=UNIT_TO_ID['ㅁ']
        units=LyricUnits('아 아 마',(a,a,m),(0,1,2),('아','아','마'),'synthetic')
        labels=[0,a,a,a,a,a,0,a,a,0,m,m,0]
        logits=torch.full((len(labels),len(UNITS)),-12.)
        logits[torch.arange(len(labels)),torch.tensor(labels)]=12.
        alignment=forced_align_units(logits.log_softmax(-1),units,source_offset_seconds=2.)
        spans=alignment['segments']
        self.assertAlmostEqual(spans[0]['endSeconds']-spans[0]['startSeconds'],.05)
        self.assertAlmostEqual(spans[1]['endSeconds']-spans[1]['startSeconds'],.02)
        self.assertFalse(alignment['humanReviewed'])
        cues=np.zeros((8,len(labels)),dtype=np.float32); cues[0]=.3; cues[1,1]=.5; cues[1,10]=-.4
        plan=plan_at_video_times(alignment,cues,[2.01,2.07,2.10])
        self.assertEqual(plan['unitIds'].tolist(),[a,a,m])
        self.assertEqual(plan['wordIndices'].tolist(),[0,1,2])
        self.assertAlmostEqual(float(plan['prosody'][0,1]),.5)
        self.assertAlmostEqual(float(plan['prosody'][2,2]),.4,places=6)
        with self.assertRaises(ValueError): plan_at_video_times(alignment,cues,[0.])
        with self.assertRaisesRegex(ValueError,'Low-confidence'):
            forced_align_units(torch.zeros(len(labels),len(UNITS)).log_softmax(-1),units,minimum_confidence=.5)

    def test_ctc_head_learns_from_given_transcript_and_rejects_impossible_repeats(self):
        model=LyricsAcousticAligner(); features=torch.randn(2,88,16)
        a=UNIT_TO_ID['ㅏ']; m=UNIT_TO_ID['ㅁ']
        targets=torch.tensor([a,m,a,a])
        loss=model.transcript_loss(features,torch.tensor([16,12]),targets,torch.tensor([2,2]))
        self.assertTrue(torch.isfinite(loss)); loss.backward()
        self.assertGreater(float(model.features[0].weight.grad.abs().sum()),0.)
        with self.assertRaisesRegex(ValueError,'too short'):
            model.transcript_loss(features[:1,:,:2],torch.tensor([2]),torch.tensor([a,a]),torch.tensor([2]))

    def test_timed_units_and_dynamics_reach_face_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); fixtures.fixture(root/'ds')
            batch=collate_sequences([ContextualFaceSequences(root/'ds/train')[0]])
            timing=dict(unitIds=torch.tensor([[UNIT_TO_ID['ㅁ'],UNIT_TO_ID['ㅏ'],UNIT_TO_ID['ㅜ'],0]]),
                        prosody=torch.rand(1,4,8),confidence=torch.ones(1,4))
            model=TextTimedSingingFaceNet()
            out=model(batch,timing); self.assertEqual(out['frames'].shape,(1,4,3,96,96))
            out['frames'].mean().backward()
            for p in (model.units.weight,model.dynamics[0].weight,model.rig.skin_basis):
                self.assertIsNotNone(p.grad); self.assertGreater(float(p.grad.abs().sum()),0.)
            self.assertTrue(torch.isfinite(conditioned_training_loss(out,batch)))
            model.eval()
            with torch.no_grad():
                one=model(batch,timing)['frames']
                changed=model(batch,{**timing,'prosody':timing['prosody']*.2})['frames']
                other=model(batch,{**timing,'unitIds':torch.full_like(timing['unitIds'],UNIT_TO_ID['ㅗ'])})['frames']
            self.assertGreater(float((one-changed).abs().sum()),0.)
            self.assertGreater(float((one-other).abs().sum()),0.)
            self.assertFalse(out['alignmentIsReviewedTruth'])

    def test_aligned_word_context_and_source_transcript_mismatch_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); fixtures.fixture(root/'ds')
            batch=collate_sequences([ContextualFaceSequences(root/'ds/train')[0]])
            timing=dict(lyricsText='너를 위로하며 괜찮아',wordIndices=torch.tensor([[0,1,2,-1]]))
            bound=bind_timed_word_context(batch,timing)
            self.assertEqual(bound['active'].any(-1).tolist(),[[True,True,True,False]])
            with self.assertRaisesRegex(ValueError,'differ'):
                bind_timed_word_context(batch,{**timing,'lyricsText':'가사가 달라'})

    def test_aligner_train_save_reload_with_synthetic_sound_not_accuracy_claim(self):
        import wave
        from song_vision.text_audio_plan_v17 import train_given_text_aligner,plan_given_text_vocal
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); wav=root/'synthetic.wav'; checkpoint=root/'ctc.pt'
            t=np.arange(4800)/16000.; samples=(np.sin(2*np.pi*200*t)*8000).astype('<i2')
            with wave.open(str(wav),'wb') as file:
                file.setnchannels(1); file.setsampwidth(2); file.setframerate(16000); file.writeframes(samples.tobytes())
            report=train_given_text_aligner([(wav,'아')],checkpoint,epochs=1)
            self.assertEqual(report['trainingSteps'],1)
            self.assertFalse(report['wordTimingAccuracyValidated'])
            # Zero threshold ONLY exercises the synthetic path, not timing quality.
            plan=plan_given_text_vocal(wav,'아',[.04,.08],checkpoint,minimum_confidence=0.)
            self.assertEqual(plan['prosody'].shape,(2,8))
            self.assertFalse(plan['alignmentAccuracyValidated'])
            self.assertEqual(len(plan['vocalSha256']),64)
            with self.assertRaises(FileExistsError): train_given_text_aligner([(wav,'아')],checkpoint)

if __name__=='__main__': unittest.main()
