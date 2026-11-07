"""v23 contracts: geometry is a bounded 2D surrogate, not measured facial anatomy."""
import unittest
from pathlib import Path
import cv2
import numpy as np
from owner_v22_constrained_viseme import TEN_VOWELS, vowel_pose, REST, preview_intervals, pose_at, syllables
from owner_v23_lyrics_safeguarded import (FULL_LYRICS_EXCERPT, make_draft_intervals,
                                        face_warp_safeguarded, classify_displacements, _warp_maps)

CAPS={'boundary':0.35,'rigid':0.65,'semirigid':1.8,'articulated':2.8,
      'mouth':2.6,'jaw':3.0,'leftCheek':1.6,'rightCheek':1.6,
      'leftLowerEye':.95,'rightLowerEye':.95}

class OwnerV23(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        yy,xx=np.mgrid[:384,:384]
        cls.image=np.stack(((xx*7+yy*3)%256,(xx*13+yy*5)%256,(xx*3+yy*11)%256),axis=-1).astype('uint8')

    def test_real_song_text_not_changed_or_pretend_timestamped(self):
        self.assertEqual(''.join(TEN_VOWELS),'ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ')
        self.assertEqual(FULL_LYRICS_EXCERPT[0], '어두운 밤이 지나면')
        cues=make_draft_intervals()
        self.assertEqual(''.join(c.syllable.glyph for c in cues),''.join(''.join(s.split()) for s in FULL_LYRICS_EXCERPT))
        self.assertTrue(all(c.source=='estimated_unreviewed_not_aligned' for c in cues))
        self.assertTrue(all(c.end>c.start for c in cues))
        self.assertTrue(all(cues[i].end<=cues[i+1].start+1e-8 for i in range(len(cues)-1)))
        pose,state=pose_at(cues,cues[1].start+.2)
        self.assertFalse(state['alignmentVerified'])
        self.assertEqual(state['status'],'PREVIEW_UNALIGNED')

    def test_strict_facial_perimeter_and_rigid_pixels(self):
        reference=self.image
        for vowel in TEN_VOWELS:
            changed,meta=face_warp_safeguarded(reference,vowel_pose(vowel,.9),CAPS)
            q=classify_displacements(reference,changed)
            self.assertEqual(q['outsideFacePixelDifference'],0.,vowel)
            self.assertEqual(q['boundaryPixelDifference'],0.,vowel)
            self.assertEqual(q['rigidCorePixelDifference'],0.,vowel)
            self.assertEqual(meta['exteriorAfterMaximum'],0.)
            self.assertEqual(meta['boundaryAfterMaximum'],0.)
            self.assertEqual(meta['rigidCoreAfterMaximum'],0.)
            self.assertLessEqual(meta['maxDisplacementPx'],3.01)

    def test_no_motion_at_rest_and_mouth_not_identical(self):
        exact,_=face_warp_safeguarded(self.image,REST,CAPS)
        self.assertTrue(np.array_equal(exact,self.image))
        opened,_=face_warp_safeguarded(self.image,vowel_pose('ㅏ',.9),CAPS)
        q=classify_displacements(self.image,opened)
        self.assertGreater(q['mouthPixelDifference'],0.05)
        self.assertGreater(q['jawPixelDifference'],0.05)
        self.assertGreater(q['leftCheekPixelDifference'],0.)
        self.assertGreater(q['rightCheekPixelDifference'],0.)

    def test_reject_bad_face_and_invalid_pose(self):
        with self.assertRaises(ValueError):face_warp_safeguarded(np.zeros((20,20,3),np.uint8),REST,CAPS)
        with self.assertRaises(ValueError):make_draft_intervals(line_seconds=(0,1))

    def test_lyrics_and_loudness_do_not_rewrite_vowel_identity(self):
        cues=make_draft_intervals(song_start=1.3)
        second=(cues[0].start+cues[0].end)/2
        p1,s1=pose_at(cues,second,energy=.1)
        p2,s2=pose_at(cues,second,energy=1.)
        self.assertEqual(s1['vowel'],s2['vowel'])
        self.assertNotEqual(p1.opening,p2.opening)

if __name__=='__main__':unittest.main()