"""Synthetic executable integration tests; never evidence of semantic quality."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import torch
from torch.utils.data import DataLoader
from song_vision import test_staged_face_v13 as fixtures
from song_vision.lyric_context_v16 import encode_text, read_lyrics, text_at_times, LyricContextEncoder
from song_vision.contextual_face_v16 import ContextualSingingFaceNet
from song_vision.contextual_training_v16 import (ContextualFaceSequences,collate_sequences,
    forward_batch,supervised_loss,train_contextual,load_contextual)


def fixture(root):
    fixtures.SongV13Tests.fixture_data(root,review=False)
    for split,text in (('train','너를 위로하며 괜찮아'),('val','울음을 참으며 괜찮아')):
        folder=root/split/f'research-{split}'
        path=folder/'index.json'; meta=json.loads(path.read_text())
        sha=hashlib.sha256(f'synthetic-{split}'.encode()).hexdigest()
        meta.update(sourceVocalsSha256=sha,consentSubjectId=f'synthetic-{split}')
        path.write_text(json.dumps(meta))
        begin=text.index('괜찮아')
        doc=dict(schemaVersion=1,vocalSha256=sha,timeBase='vocal_file_seconds',durationSeconds=1.,
                 transcriptSource='human_reviewed',source='synthetic integration fixture',text=text,
                 alignmentMethod='human_reviewed_word_intervals',
                 words=[dict(text='괜찮아',charStart=begin,charEnd=len(text),startSeconds=.2,endSeconds=.6)],
                 expressionSource='human_reviewed_context',
                 expressionIntervals=[dict(startSeconds=0.,endSeconds=1.,values=[.2,.1,-.1,.4])])
        (folder/'lyrics-context-v16.json').write_text(json.dumps(doc,ensure_ascii=False))


class ContextualFaceTests(unittest.TestCase):
    def setUp(self): torch.manual_seed(3); torch.set_num_threads(2)

    def test_lossless_korean_tokens_and_no_silent_truncation(self):
        self.assertEqual(bytes((encode_text('괜찮아')-1).tolist()).decode(),'괜찮아')
        self.assertTrue(torch.equal(encode_text('가'),encode_text('\u1100\u1161')))
        with self.assertRaises(ValueError): encode_text('가'*400)

    def test_same_word_changes_with_sentence_context(self):
        encoder=LyricContextEncoder().eval()
        a=encode_text('널 위로하며 괜찮아'); b=encode_text('울음을 참으며 괜찮아')
        audio=torch.rand(1,2,64)
        def get(tokens):
            active=torch.zeros(1,2,len(tokens),dtype=torch.bool); active[:,:,-len('괜찮아'.encode()):]=True
            return encoder(tokens[None],active,audio)[0]
        self.assertGreater(float((get(a)-get(b)).abs().sum().detach()),.001)
        with self.assertRaises(ValueError): encoder(torch.zeros(1,4,dtype=torch.long),torch.zeros(1,2,4,dtype=torch.bool),audio)

    def test_source_clock_hash_word_and_expression_guards(self):
        with tempfile.TemporaryDirectory() as tmp:
            ds=Path(tmp)/'ds'; fixture(ds); folder=ds/'train/research-train'
            path=folder/'lyrics-context-v16.json'; doc=json.loads(path.read_text())
            verified=read_lyrics(path,doc['vocalSha256'],.6)
            _,active,_,_=text_at_times(verified,[.1,.3])
            self.assertFalse(active[0].any()); self.assertTrue(active[1].any())
            with self.assertRaises(ValueError): read_lyrics(path,'0'*64,.6)
            doc['alignmentMethod']='equal_word_split'; path.write_text(json.dumps(doc))
            with self.assertRaises(ValueError): read_lyrics(path,doc['vocalSha256'],.6)

    def test_pixels_receive_lyrics_rig_and_audio_gradients(self):
        with tempfile.TemporaryDirectory() as tmp:
            ds=Path(tmp)/'ds'; fixture(ds)
            data=ContextualFaceSequences(ds/'train')
            batch=collate_sequences([data[0]])
            model=ContextualSingingFaceNet()
            out=forward_batch(model,batch)
            self.assertEqual(out['frames'].shape,(1,4,3,96,96))
            # Verify the actual renderer output, not just an auxiliary label head.
            out['frames'].mean().backward()
            for name,param in (('text',model.lyrics.embedding.weight),('jaw',model.rig.jaw.weight),
                               ('skin',model.rig.skin_basis),('renderer',model.renderer.condition[0].weight),
                               ('audio',model.audio_face.articulation_encoder[0].weight)):
                self.assertIsNotNone(param.grad,name)
                self.assertGreater(float(param.grad.abs().sum()),0.,name)
            # Semantic branch cannot directly overwrite phonetic articulation coefficients.
            from song_vision.staged_face_v13 import ART_IDS
            self.assertTrue(torch.equal(out['motion'][...,list(ART_IDS)],out['baseMotion'][...,list(ART_IDS)]))
            self.assertTrue(torch.isfinite(supervised_loss(out,batch)))
            model.eval()
            with torch.no_grad():
                normal=forward_batch(model,batch)['frames']
                no_text=forward_batch(model,batch,disable_lyrics=True)['frames']
            self.assertGreater(float((normal-no_text).abs().sum()),0.)

    def test_performer_leakage_blocks_training(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); ds=root/'ds'; fixture(ds)
            path=ds/'val/research-val/index.json'; data=json.loads(path.read_text())
            data['consentSubjectId']='synthetic-train'; path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'performers overlap'):
                train_contextual(ds,root/'never.pt',epochs=1)
            self.assertFalse((root/'never.pt').exists())

    def test_train_checkpoint_reload_and_honest_ablations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); ds=root/'ds'; fixture(ds); ckpt=root/'new-v16.pt'
            report=train_contextual(ds,ckpt,epochs=1,batch_size=1)
            self.assertFalse(report['semanticGeneralizationValidated'])
            self.assertFalse(report['physicalMuscleForceInferred'])
            self.assertEqual(report['trainSequences'],3)
            self.assertIsNone(report['finalValidation']['wrongLyricsGain'])
            self.assertIn('CORRECT_LYRICS_ADVANTAGE_NOT_SHOWN',report['diagnosticFlags'])
            self.assertEqual(report['finalValidation']['reviewedContextAffectFrames'],12)
            model,payload=load_contextual(ckpt)
            batch=collate_sequences([ContextualFaceSequences(ds/'val')[0]])
            with torch.no_grad():
                one=forward_batch(model,batch)['frames']; two=forward_batch(model,batch)['frames']
            self.assertTrue(torch.equal(one,two))
            with self.assertRaises(FileExistsError): train_contextual(ds,ckpt,epochs=1)

    def test_same_source_audio_audit_keeps_source_timestamps(self):
        from song_vision.contextual_audit_v16 import audit_contextual
        from song_vision import test_full_face_v14 as face_fixtures
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); ds=root/'ds'; fixture(ds)
            wav=face_fixtures.SingingFullFaceResearchTests.make_genuine_test_wav(root,ds)
            for split in ('train','val'):
                folder=ds/split/f'research-{split}'
                path=folder/'index.json'; meta=json.loads(path.read_text())
                if split=='train':
                    # Synthetic training samples have a distinct simulated source.
                    meta['sourceVocalsSha256']=hashlib.sha256(b'other-synthetic-training').hexdigest()
                    path.write_text(json.dumps(meta))
                path=folder/'lyrics-context-v16.json'; doc=json.loads(path.read_text())
                doc['vocalSha256']=meta['sourceVocalsSha256']; path.write_text(json.dumps(doc))
            ckpt=root/'audit-model.pt'; train_contextual(ds,ckpt,epochs=1,batch_size=1)
            report=audit_contextual(ds,'research-val',wav,ckpt,root/'private-audit')
            self.assertEqual(report['audioStartSample'],640)
            self.assertEqual(report['sourceSamplesCompared'],12*640)
            self.assertTrue(report['sourceSamplesIdentical'])
            self.assertTrue((root/'private-audit/paired-same-source-audio.mkv').is_file())
            self.assertFalse(report['semanticUnderstandingValidated'])


if __name__=='__main__': unittest.main()
