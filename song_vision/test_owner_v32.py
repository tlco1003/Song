from __future__ import annotations
import unittest
from pathlib import Path
import sys,numpy as np
sys.path.insert(0,str(Path(__file__).parent))
from korean_phone_contract_v32 import ONSETS,NUCLEI,CODAS,enumerate_all_syllables,split_hangul,create_pending_annotations,validate_for_training
from owner_v32_oral_segmentation import OwnerMouthAtlas,extract_owner_atlas,segment_opening,render_actual_owner_pixels
from owner_v32_3d_contract import default_neutral,export_3d_job_contract,articulate_jaw_mesh,require_owner_calibrated_3d_profile

class ContractTests(unittest.TestCase):
    def test_all_modern_hangul(self):
        self.assertEqual((len(ONSETS),len(NUCLEI),len(CODAS)),(19,21,28))
        self.assertEqual(sum(1 for _ in enumerate_all_syllables()),11172)
    def test_jamo_split(self):
        r=split_hangul('감사합니다')
        self.assertEqual((r[0].onset,r[0].nucleus,r[0].coda),('ㄱ','ㅏ','ㅁ'))
    def test_refuse_guessed_labels(self):
        rows=create_pending_annotations('아우부무','IMG_0853.mp4',25)
        self.assertEqual(len(rows['frames']),4)
        with self.assertRaises(ValueError):validate_for_training(rows)
    def test_3d_conservative(self):
        d=export_3d_job_contract('owner-test',default_neutral())
        self.assertFalse(d['evidence']['owner3DFitPerformed'])
        self.assertTrue(d['modelBindings']['FLAME']['upperSkullRigid'])
    def test_3d_jaw_only_without_maxillary_stretch(self):
        import numpy as np
        verts=np.array([[0.,0.,0.],[0.,1.,0.],[0.,-1.,1.]],dtype=float)
        out=articulate_jaw_mesh(verts,np.array([0.,0.,1.]),[0.,0.,0.],0.2)
        self.assertTrue(np.array_equal(out[:2],verts[:2]))
        self.assertFalse(np.allclose(out[2],verts[2]))
        with self.assertRaises(ValueError):require_owner_calibrated_3d_profile({})
    def test_true_owner_pixels_and_upper_face_locked(self):
        atlas=OwnerMouthAtlas.from_user_videos(Path('/mnt/data'))
        for v in ('ㅏ','ㅗ','ㅜ','ㅣ','ㅔ'):
            result,meta=render_actual_owner_pixels(atlas,v)
            self.assertTrue(meta['innerPixelsFromRealOwnerFrame'])
            self.assertFalse(meta['syntheticCavityDrawn'])
            self.assertTrue(meta['maxillaUpper61PctIdentical'])
    def test_oral_mask_is_image_estimate(self):
        atlas=OwnerMouthAtlas.from_user_videos(Path('/mnt/data'))
        mask,obs=segment_opening(atlas.images['very_open'],'very_open')
        self.assertEqual(mask.shape,(320,320))
        self.assertFalse(obs.medicalSegmentationValidated)
        mask2,obs2=segment_opening(atlas.images['closed'],'closed')
        self.assertFalse(obs2.reliableBoundary)

if __name__=='__main__':unittest.main()
