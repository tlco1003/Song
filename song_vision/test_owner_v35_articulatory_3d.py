import math,unittest,tempfile
import numpy as np
from pathlib import Path
from owner_v35_articulatory_3d import (
 ONSETS,VOWELS,CODAS,BASE_VOWELS,GLIDES,CONSONANTS,SIMPLE_CODA,
 vowel_pose,consonant_pose,syllable_motion,blend_controls,apply_jaw_hinge,
 tongue_mesh,observed_geometry,export_gltf,anatomical_status
)
class ArticulatoryRigTests(unittest.TestCase):
 def test_full_modern_onset_vowel_inventory(self):
  self.assertEqual(len(ONSETS),19)
  self.assertEqual(len(VOWELS),21)
  self.assertEqual(len(CODAS),28)
  self.assertEqual(len(ONSETS)*len(VOWELS),399)
  for onset in ONSETS:
   for v in VOWELS:
    seq=list(syllable_motion(onset,v,frames=7))
    self.assertEqual(len(seq),7)
    for state in seq:state.validate()
 def test_all_vowel_meshes_never_cross_palate(self):
  for v in VOWELS:
   st=vowel_pose(v)
   geo=observed_geometry(st)
   verts,faces=geo['tongue']
   self.assertTrue(np.all(np.isfinite(verts)))
   self.assertGreater(len(faces),100)
   self.assertGreaterEqual(geo['diagnostics']['minPostClampPalateClearance'],-1e-9)
 def test_correct_korean_contact_places(self):
  for consonant,place in [('ㄱ','velar'),('ㄴ','alveolar'),('ㄷ','alveolar'),('ㅈ','post_alveolar'),('ㅁ','bilabial'),('ㅂ','bilabial'),('ㅎ','none')]:
   st=consonant_pose(consonant,'ㅏ')
   self.assertEqual(st.oral_closure,place)
  for c in ['ㄱ','ㄴ','ㄷ','ㅈ','ㅋ','ㅌ','ㅊ']:
   diag=observed_geometry(consonant_pose(c,'ㅏ'))['diagnostics']
   self.assertIsNotNone(diag['targetContactGap'])
   self.assertLess(diag['targetContactGap'],.025)
 def test_s_fricative_not_full_stop(self):
  fric=consonant_pose('ㅅ','ㅣ');stop=consonant_pose('ㄷ','ㅣ')
  self.assertGreater(fric.tongue_groove,0)
  self.assertGreater(observed_geometry(fric)['diagnostics']['targetContactGap'],observed_geometry(stop)['diagnostics']['targetContactGap'])
 def test_nasals_open_velum_not_all_vowels(self):
  for c in ('ㅁ','ㄴ'):
   self.assertEqual(consonant_pose(c,'ㅏ').velum_open,1.)
  for c in ('ㅂ','ㄷ','ㅅ','ㅇ'):
   self.assertEqual(consonant_pose(c,'ㅏ').velum_open,0.)
 def test_o_u_lips_and_jaw_contrast(self):
  o=vowel_pose('ㅗ');u=vowel_pose('ㅜ');a=vowel_pose('ㅏ')
  self.assertLess(u.jaw_rad,o.jaw_rad)
  self.assertLess(u.lip_width,o.lip_width)
  self.assertGreater(u.lip_protrusion,o.lip_protrusion)
  self.assertGreater(a.jaw_rad,3*u.jaw_rad)
  self.assertGreater(a.lip_open,2*u.lip_open)
 def test_palatalization_glide_is_not_one_pose(self):
  y0=vowel_pose('ㅑ',0);y1=vowel_pose('ㅑ',1)
  self.assertNotEqual(y0.jaw_rad,y1.jaw_rad)
  self.assertNotEqual(y0.tip_z,y1.tip_z)
 def test_jaw_rigid_upper_skull(self):
  st=vowel_pose('ㅏ');geo=observed_geometry(st)
  upper0=observed_geometry(vowel_pose('ㅜ'))['palate'][0]
  upper1=geo['palate'][0]
  self.assertTrue(np.array_equal(upper0,upper1))
  j0=observed_geometry(vowel_pose('ㅜ'))['jawLine']
  j1=geo['jawLine']
  self.assertFalse(np.allclose(j0,j1))
  p=np.array([[-.76,0.,-.40],[.6,0.,-.45]])
  rotated=apply_jaw_hinge(p,.18)
  self.assertTrue(np.allclose(rotated[0],p[0]))
  self.assertLess(rotated[1,2],p[1,2])
 def test_no_personal_3d_or_acoustic_truth_claim(self):
  x=anatomical_status()
  self.assertTrue(x['rigHasTongueTipBladeBodyDorsumRoot'])
  self.assertFalse(x['personSpecificTongueFit'])
  self.assertFalse(x['phonemeTimingValidated'])
  self.assertFalse(x['audioSynthesisFromShape'])
 def test_mesh_export_has_valid_glb(self):
  with tempfile.TemporaryDirectory() as d:
   p=export_gltf(vowel_pose('ㅏ'),Path(d)/'a.glb')
   self.assertGreater(p.stat().st_size,10_000)
   self.assertEqual(p.read_bytes()[:4],b'glTF')
if __name__=='__main__':unittest.main(verbosity=2)

# Run this test class under unittest discovery; appended after main guard is fine.
class TextToArticulatoryTests(unittest.TestCase):
 def test_ee_onset_is_silent_but_final_is_nasal(self):
  from owner_v35_text_to_3d import split_syllables,coda_pose
  s=list(split_syllables('앙'))[0]
  self.assertEqual((s['onset'],s['vowel'],s['coda']),('ㅇ','ㅏ','ㅇ'))
  onset=consonant_pose('ㅇ','ㅏ')
  coda=coda_pose('ㅇ','ㅏ')
  self.assertEqual(onset.oral_closure,'none')
  self.assertEqual(coda.oral_closure,'velar')
  self.assertEqual(coda.velum_open,1.)
 def test_orthography_is_not_phonological_truth(self):
  from owner_v35_text_to_3d import timeline_from_text,SurfacePronunciationRequired
  timeline=timeline_from_text('엄마',frames_per_syllable=12)
  self.assertEqual(len(timeline['frames']),24)
  self.assertFalse(timeline['synchronizedToRealAudio'])
  with self.assertRaises(SurfacePronunciationRequired):timeline_from_text('닭')

class ExtraGeometryTests(unittest.TestCase):
 def test_muscle_commands_are_proxy_not_emg(self):
  from owner_v35_articulatory_3d import muscle_control_proxies
  u=muscle_control_proxies(vowel_pose('ㅜ'))
  a=muscle_control_proxies(vowel_pose('ㅏ'))
  self.assertGreater(u['orbicularis_oris_pursing_proxy'],a['orbicularis_oris_pursing_proxy'])
  self.assertGreater(a['digastric_jaw_opening_proxy'],u['digastric_jaw_opening_proxy'])
  self.assertFalse(u['femMuscleForcesSolved'])
 def test_3d_jaw_and_upper_lower_teeth_are_independent_meshes(self):
  from owner_v35_articulatory_3d import bone_and_teeth_meshes
  a=bone_and_teeth_meshes(vowel_pose('ㅏ'))
  u=bone_and_teeth_meshes(vowel_pose('ㅜ'))
  self.assertIn('mandible',a)
  self.assertEqual(len(a['maxillaryTeeth']),12)
  self.assertTrue(np.array_equal(a['maxillaryTeeth'][0][0],u['maxillaryTeeth'][0][0]))
  self.assertFalse(np.array_equal(a['mandibularTeeth'][0][0],u['mandibularTeeth'][0][0]))
