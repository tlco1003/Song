"""v37 reproducible public geometry/phoneme gates and private model tests."""
from __future__ import annotations
import tempfile,unittest,json
from pathlib import Path
import numpy as np
from owner_v35_articulatory_3d import (ONSETS,VOWELS,CONSONANTS,vowel_pose,consonant_pose,
                                       jaw_lines,teeth_points,tongue_mesh,palate_mesh)
from owner_v37_train_real_av import (acoustic_features,candidate_mouth_observations,TARGETS)
from owner_v37_runtime_3d import LearnedOwnerArticulator

class V37SyntheticContracts(unittest.TestCase):
    def test_every_399_onset_vowel_3d_state(self):
        for onset in ONSETS:
            for vowel in VOWELS:
                self.assertIsNotNone(consonant_pose(onset,vowel).validate())
                self.assertIsNotNone(vowel_pose(vowel).validate())
        self.assertEqual(len(ONSETS)*len(VOWELS),399)

    def test_jaw_hinge_changes_mandible_not_maxilla(self):
        a=vowel_pose('ㅏ');u=vowel_pose('ㅜ')
        upper_a,lower_a=teeth_points(a);upper_u,lower_u=teeth_points(u)
        self.assertTrue(np.allclose(upper_a,upper_u))
        self.assertFalse(np.allclose(lower_a,lower_u))
        self.assertGreater(a.jaw_rad,u.jaw_rad)

    def test_research_tongue_does_not_penetrate_palate(self):
        for vowel in VOWELS:
            v=vowel_pose(vowel)
            verts,faces,quality=tongue_mesh(v)
            self.assertTrue(np.isfinite(verts).all())
            self.assertGreaterEqual(quality['minPostClampPalateClearance'],-1e-9)

    def test_audio_feature_robustness(self):
        sr=16000;t=np.arange(sr)/sr;y=.07*np.sin(2*np.pi*220*t)
        a=acoustic_features(y,sr,.1,.7)
        self.assertEqual(a.shape,(35,))
        self.assertTrue(np.isfinite(a).all())

    def test_no_groundtruth_from_video_pixel_proxy(self):
        import cv2
        face=np.full((256,256,3),(175,165,183),dtype=np.uint8)
        cv2.ellipse(face,(130,188),(31,9),0,0,360,(38,37,51),-1)
        obs,texture,roi=candidate_mouth_observations(face)
        self.assertEqual(set(obs.keys()),set(TARGETS))
        self.assertEqual(texture.size,40*24)
        self.assertGreaterEqual(obs['oralDarkAreaRatio'],0)

    def test_runtime_refuses_unknown_3d_tongue(self):
        # Fixture pack: deliberately simple, never masquerades as trained owner model.
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p=Path(tmp.name);prefix={ 'inputMean':np.zeros(35), 'inputStd':np.ones(35),
            'weakVowelCoef':np.zeros((10,35)),'weakVowelBias':np.zeros(10),
            'weakVowelClasses':np.arange(10)}
        for name in TARGETS:
            prefix[name+'_coef']=np.zeros(35)
            prefix[name+'_intercept']=np.array([0.])
            prefix[name+'_mean']=np.array([.23])
            prefix[name+'_std']=np.array([.01])
            prefix[name+'_enabled']=np.array([True])
        np.savez(p/'fixture.npz',**prefix)
        (p/'mapping.json').write_text(json.dumps({'anatomicalTmjAngleMeasured':False,
           'apertureHeightRatioP10':.1,'apertureHeightRatioP90':.4,'minJawRad':.015,'maxJawRad':.245}))
        r=LearnedOwnerArticulator(p/'fixture.npz',p/'mapping.json')
        audio=.02*np.sin(np.linspace(0,100,16000))
        unknown=r.predict_rig(audio,16000,.1,.4)
        self.assertIsNone(unknown['tonguePose'])
        self.assertTrue(unknown['noUnverifiedTongueReconstruction'])
        actual=r.predict_rig(audio,16000,.1,.4,vowel='ㅏ',onset='ㄱ')
        self.assertFalse(actual['actualOwnerTongueMeasured'])
        self.assertFalse(actual['phonemeIdentityHumanVerified'])

    def test_vowel_u_less_jaw_than_a_with_owner_audio_proxy(self):
        # A morphological prior constraint only, independent of user bone angles.
        self.assertLess(vowel_pose('ㅜ').jaw_rad,vowel_pose('ㅏ').jaw_rad)
        self.assertGreater(vowel_pose('ㅜ').lip_protrusion,vowel_pose('ㅗ').lip_protrusion)


class V37RealArtifactChecks(unittest.TestCase):
    def test_trained_owner_not_synthetic_only(self):
        root=Path(__file__).resolve().parent/'results'
        report=root/'OWNER_V37_TRAINING_REPORT.json'
        if not report.exists():self.skipTest('private owner model not mounted')
        data=json.loads(report.read_text())
        self.assertTrue(data['trainedFromUserVoiceAndVideo'])
        self.assertEqual(data['featureRows'],169)
        self.assertEqual(data['trainingWithMeasuredPixels'],128)
        self.assertEqual(data['groupHoldoutEvents'],41)
        self.assertEqual(data['verifiedPhoneLabels'],0)
        self.assertFalse(data['observed3DTongue'])
        self.assertFalse(data['observedJawBoneAngle'])
        self.assertEqual(data['audioToOwnerVisible2DTargets']['chinEdgeYRatio']['status'],'passed')
        self.assertTrue((root/'OWNER_V37_AV_MODEL_PRIVATE.npz').exists())

if __name__=='__main__':unittest.main(verbosity=2)
