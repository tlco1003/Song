import unittest
import numpy as np
from owner_v21_audio_loudness import rms_envelope,audio_conditioned_text_pose
from owner_v21_text_viseme import preview_intervals

class TextAudioSeparation(unittest.TestCase):
 def test_strong_and_soft_sections_do_not_change_vowel(self):
  sample=np.r_[np.ones(16000,dtype=np.float32)*.02,np.ones(16000,dtype=np.float32)*.6]
  env=rms_envelope(sample)
  self.assertGreater(env.at(1.2),env.at(.5)+.4)
  rows=preview_intervals('ㅏ ㅗ',1.0)
  p1,meta1=audio_conditioned_text_pose(rows,.5,env)
  p2,meta2=audio_conditioned_text_pose(rows,1.5,env)
  self.assertEqual(meta1['vowel'],'ㅏ');self.assertEqual(meta2['vowel'],'ㅗ')
  self.assertEqual(meta2['status'],'PREVIEW_UNALIGNED')
  self.assertEqual(meta1['energySource'],'RMS_20MS_NORMALIZED_NOT_PHONEME_ALIGNMENT')
 def test_silence_and_invalid_input(self):
  a=rms_envelope(np.zeros(16000,dtype=np.float32));self.assertEqual(a.at(.5),0.)
  with self.assertRaises(ValueError):rms_envelope(np.array([1.,2.,3.],np.float32))
  with self.assertRaises(ValueError):a.at(-1.)

if __name__=='__main__':unittest.main()