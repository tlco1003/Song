"""SONG v39 real stage contracts with explicit fixture-only AV video.

These tests do not claim that the private Nara song was rendered or that the
owner's hidden tongue was recovered. Public CI may run them without private
assets, private credentials or any pretrained face/muscle models.
"""
from __future__ import annotations
import argparse
import dataclasses
import json
import math
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import soundfile as sf
from song_v39_alignment import (AlignmentError, hangul_parts, sha256_text,
    validate_phone_alignment, verified_to_v38_syllables, read_mfa_json,
    mfa_to_preview_timeline, phone_at)
from song_v39_phone_rig import update_controls
from song_v39_pipeline import run_pipeline, PipelineError
from song_v39_validator import validate_render, VideoValidationError


LYRICS="나라"


def good_alignment(source="human_verified"):
    def ph(a,b,slot,symbol):
        return {"start":a,"end":b,"slot":slot,"symbol":symbol,"source":source}
    return {"schema":"SONG_AI_PHONE_ALIGNMENT_V39","source":source,
      "lyricsSHA256":sha256_text(LYRICS),"reviewedByHuman":source=="human_verified",
      "syllables":[
        {"glyph":"나","start":.1,"end":.75,"source":source,
         "phones":[ph(.1,.22,"onset","ㄴ"),ph(.22,.75,"vowel","ㅏ")]},
        {"glyph":"라","start":.75,"end":1.5,"source":source,
         "phones":[ph(.75,.90,"onset","ㄹ"),ph(.90,1.5,"vowel","ㅏ")]},
      ]}


@dataclasses.dataclass(frozen=True)
class FixtureRig:
    jaw_rad:float=.07
    tip_z:float=.2;blade_z:float=.25;body_z:float=.3;dorsum_z:float=.3;root_z:float=.12
    lip_width:float=.35;lip_open:float=.2;lip_protrusion:float=.06
    velum_open:float=0.;glottal_aspiration:float=0.;laryngeal_tense:float=0.
    tongue_groove:float=0.;oral_closure:str="none";oral_stricture:float=0.
    def validate(self):
        if not 0<=self.jaw_rad<=.39 or not 0<=self.lip_open<=.4:
            raise ValueError("bad rig")
        return self


def fake_vowel(value, progress=1):
    if value=="ㅜ":return dataclasses.replace(FixtureRig(),dorsum_z=.45,lip_protrusion=.4,lip_open=.05)
    return dataclasses.replace(FixtureRig(),tip_z=.1,lip_open=.29)


def fake_consonant(value, vowel):
    base=fake_vowel(vowel)
    if value=="ㅁ":return dataclasses.replace(base,oral_closure="bilabial",oral_stricture=1.,velum_open=1.,lip_open=.002)
    if value=="ㄴ":return dataclasses.replace(base,oral_closure="alveolar",oral_stricture=1.,velum_open=1.,tip_z=.56)
    if value=="ㄱ":return dataclasses.replace(base,oral_closure="velar",oral_stricture=1.,dorsum_z=.59)
    return dataclasses.replace(base,oral_closure="alveolar",oral_stricture=1.)


def encode_fixture_video(folder:Path, name="fake.mp4", seconds=1.2, fps=20):
    """Real codec test, unmistakably a computer-generated CI fixture."""
    w=h=256;frames=round(seconds*fps)
    raw=folder/"fixture_unencoded.mp4"
    wr=cv2.VideoWriter(str(raw),cv2.VideoWriter_fourcc(*"mp4v"),fps,(w,h))
    if not wr.isOpened():raise RuntimeError("Fixture video writer unavailable")
    for k in range(frames):
        img=np.full((h,w,3),90,np.uint8)
        cv2.circle(img,(128,107),67,(164,162,181),-1)
        cv2.ellipse(img,(128,171),(35,5+k%9),0,0,360,(24,20,30),-1)
        wr.write(img)
    wr.release()
    sr=16000;t=np.arange(round(seconds*sr))/sr
    wav=folder/"fixture.wav"
    sf.write(wav,.02*np.sin(2*np.pi*210*t),sr)
    output=folder/name
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
        "-i",str(raw),"-i",str(wav),"-map","0:v:0","-map","1:a:0",
        "-c:v","libx264","-crf","23","-pix_fmt","yuv420p","-c:a","aac",
        "-shortest","-movflags","+faststart",str(output)],check=True)
    return output


class AlignmentContracts(unittest.TestCase):
    def test_399_jamo_inventory_and_normalized_lyrics(self):
        self.assertEqual((len(hangul_parts("나라")),len(hangul_parts("나라"))), (2,2))
        from song_v39_alignment import ONSETS,VOWELS
        self.assertEqual(len(ONSETS)*len(VOWELS),399)

    def test_good_human_phone_alignment_and_phone_selection(self):
        a=good_alignment()
        r=validate_phone_alignment(a,LYRICS,2,require_verified=True)
        self.assertTrue(r["humanVerifiedPhonemeTiming"])
        self.assertEqual(r["phones"],4)
        self.assertEqual(phone_at(a,.12)["symbol"],"ㄴ")
        self.assertEqual(phone_at(a,.65)["slot"],"vowel")
        self.assertEqual(phone_at(a,.77)["symbol"],"ㄹ")
        self.assertIsNone(phone_at(a,1.9))
        row=verified_to_v38_syllables(a,LYRICS,2)
        self.assertEqual(row["syllables"][1]["start"],.75)

    def test_mfa_cannot_masquerade_as_reviewed(self):
        p=good_alignment("mfa_candidate")
        with self.assertRaisesRegex(AlignmentError,"Unreviewed MFA"):
            validate_phone_alignment(p,LYRICS,2,require_verified=True)
        self.assertFalse(validate_phone_alignment(p,LYRICS,2)["reviewed"])

    def test_reject_invalid_word_or_overlaps_or_hash(self):
        p=good_alignment();p["lyricsSHA256"]="000"
        with self.assertRaises(AlignmentError):validate_phone_alignment(p,LYRICS,2)
        p=good_alignment();p["syllables"][1]["start"] = .5
        with self.assertRaises(AlignmentError):validate_phone_alignment(p,LYRICS,2)
        p=good_alignment();p["syllables"][0]["phones"][1]["symbol"] = "FAKE"
        with self.assertRaises(AlignmentError):validate_phone_alignment(p,LYRICS,2,require_verified=True)

    def test_real_mfa_json_schema_candidate_can_project_phones_without_gold_claim(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"song.json"
            f.write_text(json.dumps({"start":0,"end":2.,"tiers":{
                "words":{"type":"interval","entries":[[.1,1.5,"나라"]]},
                "phones":{"type":"interval","entries":[[.1,.22,"n"],[.22,.73,"ɐ"],[.73,.90,"ɾ"],[.90,1.5,"ɐ"]]}}}))
            candidate=read_mfa_json(f,duration=2)
            timeline=mfa_to_preview_timeline(candidate,LYRICS,2)
            self.assertEqual([r["glyph"] for r in timeline["syllables"]],list(LYRICS))
            self.assertEqual(timeline["syllables"][0]["phones"][0]["symbol"],"ㄴ")
            self.assertEqual(timeline["source"],"mfa_candidate")
            self.assertFalse(validate_phone_alignment(timeline,LYRICS,2)["reviewed"])

    def test_mfa_wrong_word_fails_closed(self):
        c={"words":[{"start":.1,"end":1.5,"symbol":"다라"}],"phones":[]}
        with self.assertRaises(AlignmentError):mfa_to_preview_timeline(c,LYRICS,2)


class ArticulatoryTimingContracts(unittest.TestCase):
    def test_bilabial_closure_lowers_opening_and_velum_opens_for_m(self):
        base=FixtureRig();p={"slot":"onset","symbol":"ㅁ","start":0,"end":.3}
        new=update_controls(base,p,.10,vowel_pose=fake_vowel,consonant_pose=fake_consonant)
        self.assertLess(new.lip_open,.005)
        self.assertGreater(new.velum_open,.9)
        self.assertEqual(new.oral_closure,"bilabial")
    def test_alveolar_and_velar_tongue_controls_differ(self):
        base=FixtureRig()
        n=update_controls(base,{"slot":"onset","symbol":"ㄴ","start":0,"end":.3},.1,
                          vowel_pose=fake_vowel,consonant_pose=fake_consonant)
        k=update_controls(base,{"slot":"onset","symbol":"ㄱ","start":0,"end":.3},.1,
                          vowel_pose=fake_vowel,consonant_pose=fake_consonant)
        self.assertGreater(n.tip_z,base.tip_z)
        self.assertGreater(k.dorsum_z,base.dorsum_z)
    def test_unknown_phone_does_not_create_3d_ground_truth(self):
        base=FixtureRig()
        result=update_controls(base,{"slot":"unknown","symbol":"j","start":0,"end":.2},.1,
                               vowel_pose=fake_vowel,consonant_pose=fake_consonant)
        self.assertEqual(result,base)
    def test_silent_gap_is_not_fake_active_phone(self):
        state=update_controls(FixtureRig(),None,.5,vowel_pose=fake_vowel,consonant_pose=fake_consonant)
        self.assertLess(state.lip_open,.02)


class EndToEndFixtureContracts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.d=Path(self.temp.name)
        (self.d/"lyrics.tex").write_text(LYRICS,encoding="utf-8")
        sf.write(self.d/"music.wav",.04*np.sin(2*np.pi*220*np.arange(16000*2)/16000),16000)
        cv2.imwrite(str(self.d/"photo.png"),np.full((256,256,3),130,np.uint8))
        np.savez_compressed(self.d/"private_weights.npz",modelVersion=np.array(["v37_owner_actual_audio_video"]))
        (self.d/"mapping.json").write_text('{"anatomicalTmjAngleMeasured":false}')
        (self.d/"training.json").write_text('{"trainedFromUserVoiceAndVideo":true,"featureRows":169,"observed3DTongue":false}')
        (self.d/"phones.json").write_text(json.dumps(good_alignment()))

    def args(self,**updates):
        p={"workdir":self.d/"run","lyrics":self.d/"lyrics.tex","audio":self.d/"music.wav",
           "portrait":self.d/"photo.png","weights":self.d/"private_weights.npz",
           "mapping":self.d/"mapping.json","training_report":self.d/"training.json",
           "train_video":None,"reviewed_phones":self.d/"phones.json","mfa_json":None,
           "run_mfa":False,"mfa_dictionary":"korean_mfa","mfa_model":"korean_mfa",
           "vocals_stem":None,"preview":False,"start":0,"seconds":1.2,"fps":20,
           "width":256,"height":256,"output":self.d/"run"/"engine_output.mp4",
           "reference_annotations":None}
        p.update(updates)
        return SimpleNamespace(**p)

    def fixture_renderer(self,**kwargs):
        # Fake *CI fixture* renderer that physically encodes MP4. The real
        # production entrypoint imports v38.create_mp4, never this fixture.
        output=kwargs["output"]
        output.parent.mkdir(parents=True,exist_ok=True)
        encode_fixture_video(output.parent,name=output.name,seconds=kwargs["seconds"],fps=kwargs["fps"])
        assert kwargs["phone_alignment_path"] and (kwargs["alignment_path"] or kwargs["draft_preview"])
        metadata={"seconds":kwargs["seconds"],"fps":kwargs["fps"],"videoWidth":256,
                  "videoHeight":256,"frameCount":round(kwargs["seconds"]*kwargs["fps"]),
                  "mp4CreatedBySongEngine":True,"ownerRealAudioToVisibleFaceWeightsUsed":True,
                  "hidden3DTongueMeshEvaluatedEveryFrame":True,
                  "perPhonemeLipSyncValidated":False,
                  "fixtureOnly":True}
        return metadata

    def test_reviewed_phone_to_mp4_and_qa_pipeline(self):
        run=run_pipeline(self.args(),render_callable=self.fixture_renderer)
        self.assertTrue(run["stages"]["validation"]["passEncoding"])
        self.assertTrue(run["stages"]["validation"]["phoneTimingHumanReviewed"])
        self.assertEqual(run["stages"]["validation"]["generatedVideoLipSyncAccuracy"]["status"],"not_measured")
        self.assertEqual(run["status"],"completed_with_human_phone_labels_requires_visual_review")
        self.assertTrue((self.d/"run"/"SONG_V39_RUN_MANIFEST.json").exists())

    def test_unverified_cannot_enter_production_render(self):
        a=self.args(reviewed_phones=None,preview=False)
        with self.assertRaises(PipelineError):run_pipeline(a,render_callable=self.fixture_renderer)

    def test_mfa_preview_only_with_candidate_timing(self):
        mfa=self.d/"mfa.json"
        mfa.write_text(json.dumps({"start":0,"end":2,"tiers":{
            "words":{"entries":[[.1,1.5,"나라"]]},
            "phones":{"entries":[[.1,.22,"n"],[.22,.73,"ɐ"],[.73,.90,"ɾ"],[.90,1.5,"ɐ"]]}}}))
        report=run_pipeline(self.args(reviewed_phones=None,mfa_json=mfa,preview=True),render_callable=self.fixture_renderer)
        self.assertEqual(report["stages"]["alignment"]["status"],"mfa_candidate_not_verified")
        self.assertFalse(report["stages"]["validation"]["phoneTimingHumanReviewed"])

    def test_validation_rejects_static_video(self):
        output=self.d/"static.mp4"
        # Frames with only a static face but valid audio must be rejected.
        cv2file=self.d/"static_raw.mp4"
        w=cv2.VideoWriter(str(cv2file),cv2.VideoWriter_fourcc(*"mp4v"),20,(256,256))
        frame=np.full((256,256,3),100,np.uint8)
        for _ in range(24):w.write(frame)
        w.release()
        subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-nostdin","-i",str(cv2file),
            "-i",str(self.d/"music.wav"),"-map","0:v:0","-map","1:a:0","-t","1.2",
            "-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",str(output)],check=True)
        with self.assertRaises(VideoValidationError):validate_render(output,{"seconds":1.2,"fps":20,
            "videoWidth":256,"videoHeight":256,"frameCount":24,
            "ownerRealAudioToVisibleFaceWeightsUsed":True,
            "hidden3DTongueMeshEvaluatedEveryFrame":True})


if __name__=="__main__":unittest.main(verbosity=2)
