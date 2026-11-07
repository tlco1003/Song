"""Public v23 demo file links; no private source-face recordings."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class V23SiteFiles(unittest.TestCase):
    def test_v23_video_and_linked_pages(self):
        name="vision-owner/AM630_v23_TEXT_FIRST_CONSTRAINED_FACE_UNALIGNED.mp4"
        for doc in ("docs/index.html","docs/song-vision-lab.html","docs/song-vision-v23-am630.html"):
            self.assertIn(name,(ROOT/doc).read_text(encoding="utf-8"))
        self.assertTrue((ROOT/"docs"/name).is_file())
        self.assertGreater((ROOT/"docs"/name).stat().st_size,50000)
    def test_v23_closeup_and_failure_disclosure(self):
        name="vision-owner/AM630_v23_MOUTH_CLOSEUP_SITE.mp4"
        self.assertTrue((ROOT/"docs"/name).is_file())
        html=(ROOT/"docs/song-vision-v23-am630.html").read_text(encoding="utf-8")
        self.assertIn(name,html)
        self.assertIn("미검증",html)
        self.assertIn("3D",html)
if __name__=="__main__":unittest.main()
