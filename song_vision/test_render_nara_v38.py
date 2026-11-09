"""SONG v38 integration/contract tests (no private checkpoint or user photo).

The fixture does not claim learning or phonetic fidelity; production strictly
requires the real private v37 model and provenance report.
"""
from __future__ import annotations

import dataclasses
import importlib
import json
import math
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import cv2
import numpy as np
import soundfile as sf


def _install_local_only_3d_test_stubs():
    """Only for developer off-repo tests; GitHub has actual SONG AI v35/v37."""
    fake=types.ModuleType('owner_v35_articulatory_3d')
    @dataclasses.dataclass(frozen=True)
    class RigControls:
        jaw_rad:float=.07;tip_z:float=.2;blade_z:float=.2;body_z:float=.3
        dorsum_z:float=.2;root_z:float=.2;lip_width:float=.35
        lip_open:float=.09;lip_protrusion:float=.1;velum_open:float=0.
        glottal_aspiration:float=0.;laryngeal_tense:float=0.
        oral_closure:str='none';oral_stricture:float=0.
        tongue_groove:float=0.;phase:str='vowel';target_grapheme:str=''
        observed_owner_tongue:bool=False
        def validate(self):
            if not (0<=self.jaw_rad<=.39 and 0<=self.lip_open<=.4):raise ValueError('control bounds')
            return self
    def vowel_pose(v):
        if v=='ㅏ':return RigControls(.25,lip_open=.3,lip_width=.44,lip_protrusion=.02)
        if v=='ㅜ':return RigControls(.04,lip_open=.08,lip_width=.20,lip_protrusion=.44)
        return RigControls()
    def consonant_pose(c,v):
        pose=vowel_pose(v)
        return dataclasses.replace(pose,oral_closure='bilabial' if c in 'ㅁㅂㅍ' else 'alveolar',oral_stricture=1.)
    def lips_mesh(pose,sections=48):
        theta=np.linspace(0,2*np.pi,sections,endpoint=False)
        ring=np.stack([np.full_like(theta,.96),pose.lip_width*np.cos(theta),
                       -.06-.25*pose.jaw_rad+pose.lip_open*np.sin(theta)],axis=1)
        return ring,np.zeros((0,3),np.int32),ring
    def teeth_points(p):
        y=np.linspace(-.25,.25,12)
        return np.stack([np.full_like(y,.8),y,np.full_like(y,.14)],axis=1),np.stack([np.full_like(y,.8),y,np.full_like(y,-.2-p.jaw_rad)],axis=1)
    for k,val in locals().copy().items():
        if k in ('RigControls','vowel_pose','consonant_pose','lips_mesh','teeth_points'):setattr(fake,k,val)
    fake.tongue_mesh=lambda *args,**kwargs:(np.zeros((400,3)),np.zeros((100,3),dtype=np.int32),{'minPostClampPalateClearance':0.008})
    sys.modules[fake.__name__]=fake
    fake2=types.ModuleType('owner_v37_runtime_3d')
    class LearnedOwnerArticulator:
        def __init__(self,weights,mapping):self.weights=weights;self.mapping=mapping
        def predict_rig(self,wave,sr,start,end,*,vowel,onset=None,explicit_prompt=False):
            pos=float(np.sqrt(np.mean(wave[int(start*sr):int(end*sr)]**2)))
            p=vowel_pose(vowel)
            return {'rigControls':dataclasses.asdict(dataclasses.replace(p,jaw_rad=float(min(.39,p.jaw_rad+pos*.25)))),
                    'owner2DAudioVisualModelUsed':True}
    fake2.LearnedOwnerArticulator=LearnedOwnerArticulator
    sys.modules[fake2.__name__]=fake2


try:
    import render_nara_v38 as engine
except ImportError:
    _install_local_only_3d_test_stubs()
    import render_nara_v38 as engine


class V38TextAndSafety(unittest.TestCase):
    def test_hangul_identity_and_no_fake_timing(self):
        rows=engine.lyric_syllables('나라\n사람')
        self.assertEqual([x['glyph'] for x in rows],list('나라사람'))
        self.assertEqual(rows[0]['onset'],'ㄴ')
        with self.assertRaisesRegex(ValueError,'No human-verified syllable alignment'):
            engine.timing_contract(rows,11.,None,False)
        timing,status=engine.timing_contract(rows,11.,None,True)
        self.assertEqual(status,'draft_NOT_aligned')
        self.assertEqual(len(timing),4)

    def test_rejects_false_verified_lyrics_alignment(self):
        parts=engine.lyric_syllables('나라')
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'wrong.json'
            path.write_text(json.dumps({'schema':'SONG_AI_VERIFIED_SYLLABLES_V1','syllables':[
                {'glyph':'나','start':0,'end':1,'source':'auto_generated'},
                {'glyph':'라','start':1,'end':2,'source':'human_verified'}]}))
            with self.assertRaisesRegex(ValueError,'lacks human verification'):
                engine.timing_contract(parts,11,path,False)
            path.write_text(json.dumps({'schema':'SONG_AI_VERIFIED_SYLLABLES_V1','syllables':[
                {'glyph':'나','start':1,'end':2,'source':'human_verified'},
                {'glyph':'라','start':2,'end':3,'source':'human_verified'}]}))
            rows,status=engine.timing_contract(parts,11,path,False)
            self.assertEqual(status,'human_verified')
            self.assertEqual(rows,[(1.,2.),(2.,3.)])

    def test_no_missing_private_weights_fallback(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)
            with self.assertRaises(FileNotFoundError):
                engine.create_mp4(audio_path=p/'audio.mp3',lyrics_path=p/'Nara.tex',image_path=p/'photo.png',
                    weights_path=p/'not-present.npz',mapping_path=p/'mapping.json',training_report=p/'r.json',
                    output=p/'video.mp4',start=1,seconds=2,draft_preview=True)

    def test_face_background_boundary_locked_and_jaw_dynamic(self):
        photo=np.full((256,256,3),140,np.uint8)
        cv2.circle(photo,(128,145),52,(166,175,200),-1)
        face_box=np.array([49,57,156,156],dtype=np.float32)
        renderer=engine.Visible3DFaceRenderer(photo,face_box)
        base=engine.vowel_pose('ㅡ')
        large=engine.vowel_pose('ㅏ')
        a=renderer.render(base);b=renderer.render(large)
        self.assertTrue(np.array_equal(a[:25],photo[:25]))
        self.assertTrue(np.array_equal(b[:25],photo[:25]))
        self.assertGreater(float(np.mean(np.abs(a.astype(np.float32)-b.astype(np.float32)))),.02)

    def test_generated_mp4_is_actual_engine_output_with_fixture_only(self):
        # TEST audio/weights never represent the owner! This strictly tests that
        # native MP4 frames are created from the *program's* renderer API.
        with tempfile.TemporaryDirectory() as td:
            p=Path(td);sr=16000;t=np.arange(sr*12,dtype=np.float32)/sr
            wave=(.04*np.sin(2*np.pi*200*t)*(0.6+0.4*np.sin(2*np.pi*.7*t))).astype(np.float32)
            sf.write(p/'fixture.wav',wave,sr)
            (p/'Nara.tex').write_text('나라는 사람\n사랑을 배우고',encoding='utf-8')
            cv2.imwrite(str(p/'photo.png'),np.full((256,256,3),135,np.uint8))
            np.savez_compressed(p/'weights.npz',modelVersion=np.array(['v37_owner_actual_audio_video']))
            (p/'mapping.json').write_text('{}')
            (p/'report.json').write_text(json.dumps({'trainedFromUserVoiceAndVideo':True,
                 'featureRows':169,'observed3DTongue':False}))
            # No photos or private personal weights published from this test.
            fakebox=np.array([51,40,150,173],dtype=np.float32)
            class FixtureArticulator:
                def __init__(self,*args,**kwargs):pass
                def predict_rig(self,wave,sr,start,end,*,vowel,onset=None,explicit_prompt=False):
                    z=engine.vowel_pose(vowel)
                    a=float(np.sqrt(np.mean(wave[int(start*sr):int(end*sr)]**2)))
                    z=dataclasses.replace(z,jaw_rad=float(min(.38,z.jaw_rad+a*.4)))
                    return {'rigControls':dataclasses.asdict(z),'owner2DAudioVisualModelUsed':True}
            with mock.patch.object(engine,'load_portrait',return_value=(np.full((256,256,3),135,np.uint8),fakebox)), \
                 mock.patch.object(engine,'LearnedOwnerArticulator',FixtureArticulator):
                out=engine.create_mp4(audio_path=p/'fixture.wav',lyrics_path=p/'Nara.tex',image_path=p/'photo.png',
                    weights_path=p/'weights.npz',mapping_path=p/'mapping.json',training_report=p/'report.json',
                    output=p/'output.mp4',start=2.,seconds=2.5,fps=20,width=256,height=256,draft_preview=True)
            self.assertTrue((p/'output.mp4').exists())
            self.assertGreater(out['frameCount'],30)
            self.assertEqual(out['lyricsAlignmentStatus'],'draft_NOT_aligned')
            self.assertFalse(out['perPhonemeLipSyncValidated'])
            cap=cv2.VideoCapture(str(p/'output.mp4'))
            self.assertGreater(cap.get(cv2.CAP_PROP_FRAME_COUNT),30)
            cap.release()


if __name__=='__main__':
    unittest.main(verbosity=2)
