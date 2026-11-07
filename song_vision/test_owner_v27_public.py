"""Public research contract tests using synthetic pixels, no private face data."""
import unittest
from pathlib import Path
import numpy as np
from owner_v27_jaw_oral_rig import learnable_jaw_shift,apply_owner_jaw_image_motion
from owner_v27_phone_contract import VerifiedPhoneCue,create_annotation_template

class PublicV27Safety(unittest.TestCase):
    def test_owner_calibration_provenance_required(self):
        with self.assertRaises(ValueError):
            learnable_jaw_shift({'trainedWithActualOwnerVideo':False},200)

    def test_monotonic_jaw_opening_and_clamp(self):
        profile={'trainedWithActualOwnerVideo':True,'status':'RESEARCH_MEASURED_IMAGE_DISPLACEMENT_NOT_BONE',
                 'inputOpeningShadowBreakpoints':[0,100,200,400,700],
                 'predictedChinShiftPx':[0,2,3,5,9],
                 'neutralOpeningShadowPx':100,'maxAllowedJawDeltaPx':6}
        self.assertEqual(learnable_jaw_shift(profile,100),0)
        self.assertGreater(learnable_jaw_shift(profile,400),0)
        self.assertLessEqual(learnable_jaw_shift(profile,900),6.)

    def test_invariant_upper_skull_and_active_chin(self):
        y,x=np.mgrid[:320,:320]
        image=np.stack([((x*2+y*7)%255),((x*5+y*2)%255),((x*3+y*11)%255)],axis=2).astype(np.uint8)
        frame,meta=apply_owner_jaw_image_motion(image,9.)
        self.assertTrue(np.array_equal(image[:220],frame[:220]))
        self.assertGreater(meta['jawImageRegionChanges'],20)
        self.assertFalse(meta['mandibularBoneRotationActuallyMeasured'])

    def test_manual_korean_phone_required(self):
        record=create_annotation_template('speaking.mp4','a'*64)
        self.assertEqual(record['cues'],[])
        with self.assertRaises(ValueError):
            VerifiedPhoneCue('speaking.mp4','a'*64,'아','ㅏ',1.,1.2,'automatic','inferred')

if __name__=='__main__':unittest.main()
