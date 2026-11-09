"""Numerical contract tests: correctness claims are limited to a toy tube.

When run on Github CI there is no access to owner's private audio;
owner data tests run locally with original user recordings only.
"""
import unittest,json
from pathlib import Path
import numpy as np
from dataclasses import replace
from owner_v35_articulatory_3d import ONSETS,VOWELS,BASE_VOWELS,vowel_pose,consonant_pose,GLIDES
from owner_v36_acoustic_articulation import (
 TubeProfile,tube_frequency_response,formant_candidates,phoneme_signature,airway_from_pose)
from synthesize_v36_formant_probes import synthesize

class V36AcousticsTests(unittest.TestCase):
    def test_uniform_tube_quarter_wavelength_reference(self):
        profile=TubeProfile([2.0]*40,.17,False,'none')
        f=formant_candidates(profile)
        self.assertTrue(abs(f[0]-343/(4*.17))<45,f)
        self.assertTrue(abs(f[1]-3*343/(4*.17))<75,f)

    def test_hidden_tongue_position_changes_resonances(self):
        i=vowel_pose('ㅣ');m=replace(i,blade_z=min(.59,i.blade_z+.14))
        self.assertNotEqual(formant_candidates(airway_from_pose(i))[:2],formant_candidates(airway_from_pose(m))[:2])

    def test_o_and_u_different_lip_protrusion_jaw_and_f2(self):
        o=vowel_pose('ㅗ');u=vowel_pose('ㅜ');a=vowel_pose('ㅏ')
        self.assertLess(u.jaw_rad,o.jaw_rad)
        self.assertGreater(u.lip_protrusion,o.lip_protrusion)
        self.assertLess(u.lip_width,o.lip_width)
        self.assertGreater(a.jaw_rad,u.jaw_rad*3)
        self.assertNotEqual(formant_candidates(airway_from_pose(o)),formant_candidates(airway_from_pose(u)))

    def test_all_399_korean_initial_medial_combinations_have_contract(self):
        result=[]
        for c in ONSETS:
            for v in VOWELS:
                sig=phoneme_signature(c,v)
                self.assertFalse(sig['learnedFromOwnerTongueImaging'])
                self.assertFalse(sig['synthesizesFullKoreanSpeech'])
                self.assertTrue(len(sig['vowelTubeResonancesHz'])>=2,(c,v))
                result.append(sig)
        self.assertEqual(len(result),399)

    def test_nasal_bilabial_alveolar_velar_airways_are_separate(self):
        m=phoneme_signature('ㅁ','ㅏ');n=phoneme_signature('ㄴ','ㅏ')
        b=phoneme_signature('ㅂ','ㅏ');g=phoneme_signature('ㄱ','ㅏ')
        self.assertTrue(m['velumOpen'])
        self.assertTrue(n['velumOpen'])
        self.assertFalse(b['velumOpen'])
        self.assertTrue(m['lipSealed'])
        self.assertFalse(n['lipSealed'])
        self.assertEqual(g['onsetPlace'],'velar')
        self.assertEqual(n['onsetPlace'],'alveolar')

    def test_korean_lax_tense_aspirated_glottal_cues_are_not_just_lips(self):
        lax=phoneme_signature('ㄱ','ㅏ');tense=phoneme_signature('ㄲ','ㅏ');asp=phoneme_signature('ㅋ','ㅏ')
        self.assertEqual(lax['onsetPlace'],tense['onsetPlace'])
        self.assertGreater(tense['laryngealTensePreset'],lax['laryngealTensePreset'])
        self.assertGreater(asp['glottalAspirationPreset'],lax['glottalAspirationPreset'])
        self.assertTrue(lax['koreanVOT_F0_currently_only_controls_not_fit'])

    def test_nasal_branch_acoustics_not_claimed(self):
        p=airway_from_pose(consonant_pose('ㄴ','ㅏ'))
        self.assertTrue(p.nasal_port_open)
        self.assertFalse(p.nasal_branch_acoustically_simulated)

    def test_glides_have_distinct_3d_starts_and_ends(self):
        for v in GLIDES:
            p0=airway_from_pose(vowel_pose(v,0));p1=airway_from_pose(vowel_pose(v,1))
            self.assertTrue(np.mean(np.abs(np.array(p0.areas_cm2)-p1.areas_cm2))>.04,v)

    def test_audio_probes_are_not_user_cloned_voice(self):
        samples,sr,report=synthesize(duration=.26)
        self.assertEqual(sr,16000)
        self.assertEqual(len(report),10)
        self.assertTrue(np.any(np.abs(samples)>.1))
        self.assertTrue(np.all(np.isfinite(samples)))
        self.assertTrue(all(not e['voiceIsOwnerCloned'] for e in report))

    def test_acoustic_model_reports_big_owner_f2_mismatch_not_success(self):
        r=Path(__file__).parent/'results'/'SONG_V36_OWNER_AUDIO_COMPARISON_PRIVATE.json'
        if not r.exists():self.skipTest('owner file private and not provided to Github')
        a=json.loads(r.read_text())
        self.assertFalse(a['firstGroupHumanVerifiedTimings'])
        item=next(v for v in a['vowels'] if v['vowel']=='ㅣ')
        actual=item['acoustic']['F2candidateHz']
        pred=item['modelPredictedResonanceCandidatesHz'][1]
        self.assertGreater(abs(actual-pred),600) # flagged, not silently called success

    def test_private_audio_absent_does_not_create_false_transcription(self):
        from owner_v36_audio_inverse import detect_speech_segments
        test=np.zeros(16000,dtype=float)
        self.assertEqual(detect_speech_segments(test,16000),[])

if __name__=='__main__':unittest.main(verbosity=2)
