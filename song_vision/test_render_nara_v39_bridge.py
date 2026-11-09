"""Exercise the REAL v38 face MP4 renderer with v39 phone timing, fixture-only.

This test is intentionally skipped outside the complete SONG AI checkout.
Its fake model parameters and synthetic video are NEVER the owner's trained
checkpoint or the Nara song. This tests the actual phone-to-3D wiring path.
"""
from __future__ import annotations
import dataclasses
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock
import numpy as np
import cv2
import soundfile as sf

try:
    import render_nara_v38 as engine
    from owner_v35_articulatory_3d import vowel_pose
    REAL_ENGINE_AVAILABLE=True
except ImportError:
    REAL_ENGINE_AVAILABLE=False

from song_v39_alignment import sha256_text


@unittest.skipUnless(REAL_ENGINE_AVAILABLE,'Requires complete public SONG AI v35-v38 source checkout')
class NativeRendererPhonePath(unittest.TestCase):
    def test_reviewed_phone_onset_and_vowel_drive_real_mp4_3d_mesh(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);sr=16000;seconds=12.
            t=np.arange(round(sr*seconds))/sr
            # Music-like synthetic fixture with variable energy, not any user song.
            signal=(.04*np.sin(2*np.pi*174*t)*(0.55+0.45*np.sin(2*np.pi*.8*t))).astype(np.float32)
            sf.write(root/'fixture.wav',signal,sr)
            (root/'lyrics.tex').write_text('나라',encoding='utf-8')
            portrait=np.full((256,256,3),128,np.uint8)
            cv2.circle(portrait,(128,131),63,(166,157,199),-1)
            cv2.rectangle(portrait,(98,161),(158,173),(63,45,93),-1)
            cv2.imwrite(str(root/'face.png'),portrait)
            np.savez_compressed(root/'weights.npz',modelVersion=np.array(['v37_owner_actual_audio_video']))
            (root/'mapping.json').write_text('{"anatomicalTmjAngleMeasured":false}')
            (root/'report.json').write_text(json.dumps({'trainedFromUserVoiceAndVideo':True,
                         'featureRows':169,'observed3DTongue':False}))
            def phone(a,b,slot,symbol):
                return {'start':a,'end':b,'slot':slot,'symbol':symbol,'source':'human_verified'}
            data={'schema':'SONG_AI_PHONE_ALIGNMENT_V39','source':'human_verified',
                  'reviewedByHuman':True,'lyricsSHA256':sha256_text('나라'),
                  'syllables':[
                     {'glyph':'나','start':2.,'end':2.65,'source':'human_verified',
                      'phones':[phone(2.,2.2,'onset','ㄴ'),phone(2.2,2.65,'vowel','ㅏ')]},
                     {'glyph':'라','start':2.65,'end':3.55,'source':'human_verified',
                      'phones':[phone(2.65,2.86,'onset','ㄹ'),phone(2.86,3.55,'vowel','ㅏ')]}
                  ]}
            p=root/'phones.json';p.write_text(json.dumps(data),encoding='utf-8')
            class FakeV37ForCI:
                def __init__(self,weights,mapping):
                    pass
                def predict_rig(self,wave,sample_rate,start,end,*,vowel,onset=None,explicit_prompt=False):
                    # Stub only for CI; this test does NOT claim real owner training.
                    frame=vowel_pose(vowel)
                    rms=float(np.sqrt(np.mean(wave[int(start*sample_rate):int(end*sample_rate)]**2)))
                    frame=dataclasses.replace(frame,jaw_rad=float(min(.38,frame.jaw_rad+.4*rms)))
                    return {'rigControls':dataclasses.asdict(frame),'owner2DAudioVisualModelUsed':True}
            facebox=np.array([54,35,150,190],dtype=np.float32)
            out=root/'engine_phone_render.mp4'
            with mock.patch.object(engine,'load_portrait',return_value=(portrait,facebox)), \
                 mock.patch.object(engine,'LearnedOwnerArticulator',FakeV37ForCI):
                report=engine.create_mp4(audio_path=root/'fixture.wav',lyrics_path=root/'lyrics.tex',
                    image_path=root/'face.png',weights_path=root/'weights.npz',mapping_path=root/'mapping.json',
                    training_report=root/'report.json',output=out,start=2.,seconds=2.,fps=20,
                    width=256,height=256,phone_alignment_path=p,draft_preview=False)
            self.assertTrue(out.exists())
            self.assertTrue(report['timedPhoneModelApplied'])
            self.assertEqual(report['timedPhoneEvents'],4)
            self.assertEqual(report['lyricsAlignmentStatus'],'human_verified')
            self.assertTrue(report['phoneIntervalsVerifiedByHuman'])
            self.assertFalse(report['perPhonemeLipSyncValidated'])
            trace=json.loads(out.with_suffix('.controls.json').read_text(encoding='utf-8'))
            self.assertTrue(any(x['phoneSymbol']=='ㄴ' for x in trace))
            self.assertTrue(any(x['phoneSlot']=='vowel' for x in trace))
            self.assertTrue(all(x['trainedOwnerAudioModelUsed'] for x in trace))
            cap=cv2.VideoCapture(str(out))
            self.assertGreater(cap.get(cv2.CAP_PROP_FRAME_COUNT),35)
            cap.release()


if __name__=='__main__':unittest.main(verbosity=2)
