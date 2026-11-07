"""v21 acceptance tests; do not treat passing as real anatomical/lyric sync validation."""
import unittest
import cv2
import numpy as np
from owner_v21_text_viseme import (
    TEN_VOWELS,syllables,preview_intervals,validated_intervals,
    vowel_pose,pose_at,face_warp,region_differences,GLIDES,REST,Pose
)

class TextFirstVowels(unittest.TestCase):
    def test_exact_ten_requested_symbols_and_no_conflation(self):
        self.assertEqual(''.join(TEN_VOWELS),'ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ')
        result=syllables('ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ')
        self.assertEqual(tuple(x.vowel for x in result),TEN_VOWELS)
        self.assertEqual(len(set(pose_at(preview_intervals(' '.join(TEN_VOWELS)),i*.85+.11)[0].values()
                                 for i in range(10))),10)

    def test_hangul_lyrics_and_bilabial_closure(self):
        a=syllables('엄마, 난 가끔 그런 생각을 해')
        self.assertEqual(a[0].vowel,'ㅓ')
        self.assertEqual(a[1].onset,'ㅁ')
        self.assertEqual(a[1].vowel,'ㅏ')
        rows=preview_intervals('마',1.0)
        before,_=pose_at(rows,0.01)
        mid,_=pose_at(rows,.35)
        self.assertLess(before.opening,.10)
        self.assertGreater(mid.opening,.8)
        self.assertRaises(ValueError,syllables,'가🙂')

    def test_y_glides_are_real_time_trajectories_not_static_poses(self):
        for vowel,endpoint in GLIDES.items():
            with self.subTest(vowel=vowel):
                start=vowel_pose(vowel,0.)
                mid=vowel_pose(vowel,.18)
                end=vowel_pose(vowel,.75)
                self.assertAlmostEqual(start.spreading,vowel_pose('ㅣ',.5).spreading)
                self.assertNotEqual(start.values(),mid.values())
                for actual,expected in zip(end.values(),vowel_pose(endpoint,.5).values()):
                    self.assertAlmostEqual(actual,expected)

    def test_supported_vowel_targets_have_expected_contrasts(self):
        a=vowel_pose('ㅏ',.8);eo=vowel_pose('ㅓ',.8)
        o=vowel_pose('ㅗ',.8);u=vowel_pose('ㅜ',.8)
        eu=vowel_pose('ㅡ',.8);i=vowel_pose('ㅣ',.8)
        self.assertGreater(a.opening,eo.opening)
        self.assertGreater(o.opening,u.opening)
        self.assertGreater(o.rounding,eo.rounding)
        self.assertGreater(u.protrusion,o.protrusion)
        self.assertGreater(i.spreading,eu.spreading)

    def test_no_invented_alignment_or_text_override_by_energy(self):
        x=preview_intervals('아 야 어 여 오 요 우 유 으 이',.75)
        p,d=pose_at(x,2.1,energy=.2)
        p2,d2=pose_at(x,2.1,energy=.98)
        self.assertEqual(d['vowel'],d2['vowel'])
        self.assertEqual(d['status'],'PREVIEW_UNALIGNED')
        self.assertFalse(d['alignmentVerified'])
        self.assertNotEqual(p.opening,p2.opening)
        with self.assertRaises(ValueError):
            validated_intervals('아',[{'glyph':'아','start':.1,'end':.6,'source':'auto_preview_NOT_ALIGNED'}])
        with self.assertRaises(ValueError):
            validated_intervals('아',[{'glyph':'오','start':.1,'end':.6,'source':'manually_verified'}])
        allowed=validated_intervals('아',[{'glyph':'아','start':.1,'end':.6,'source':'manually_verified'}])
        self.assertTrue(pose_at(allowed,.3)[1]['alignmentVerified'])

    def test_face_cheeks_malar_and_lower_eyes_receive_small_correlated_motion(self):
        # Gradient pattern assures that pixel values reflect the displacement.
        yy,xx=np.mgrid[:384,:384]
        img=np.zeros((384,384,3),dtype=np.uint8)
        img[:]=np.stack([((xx*7+yy*3)%256),((xx*13+yy*5)%256),((xx*3+yy*11)%256)],axis=2)
        moved,meta=face_warp(img,vowel_pose('ㅏ',1.))
        changes=region_differences(img,moved)
        for part in ('mouth','jaw','leftCheek','rightCheek','leftMalar','rightMalar','leftLowerEye','rightLowerEye'):
            self.assertGreater(changes[part],0.,part)
        self.assertEqual(changes['edge'],0.)
        self.assertEqual(meta['skinModel'],'2D_correlated_surface_warp_NOT_measured_muscles')
        self.assertTrue(np.array_equal(face_warp(img,REST)[0],img))

if __name__=='__main__':unittest.main()