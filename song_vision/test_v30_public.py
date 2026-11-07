"""Public v30 synthetic contracts; does not access private owner source recordings."""
import unittest
import numpy as np
from owner_v30_pose_lip_thickness import measure_bands_from_masks,apply_apparent_vermilion_thickness

class V30Public(unittest.TestCase):
 def test_valid_lip_band_heights(self):
  outer=np.zeros((80,90),np.uint8);inner=np.zeros_like(outer)
  outer[15:56,12:78]=255;inner[29:39,24:66]=255
  r=measure_bands_from_masks(outer,inner)
  self.assertEqual((r.upperVisibleVermilionHeightPx,r.lowerVisibleVermilionHeightPx),(14,17))
  self.assertFalse(r.clinicallyVerified)
 def test_reject_unseen_inner_mouth(self):
  outer=np.zeros((80,90),np.uint8);inner=np.zeros_like(outer)
  outer[15:56,12:78]=255
  r=measure_bands_from_masks(outer,inner)
  self.assertIsNone(r.upperVisibleVermilionHeightPx)
 def test_independent_bands_and_forehead_preserved(self):
  a=np.full((320,320,3),(100,140,160),np.uint8)
  a[220:245,110:212]=[80,95,150]
  b,m=apply_apparent_vermilion_thickness(a,.80,.89)
  self.assertTrue(np.array_equal(a[:210],b[:210]))
  self.assertTrue(np.array_equal(a[:,:75],b[:,:75]))
  self.assertFalse(np.array_equal(a[225:250,125:190],b[225:250,125:190]))
  self.assertNotEqual(m['upperRelativeScale'],m['lowerRelativeScale'])
if __name__=='__main__':unittest.main()
