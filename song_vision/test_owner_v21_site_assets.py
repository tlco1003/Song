"""Ensure public v21 preview code and review video are deployed together."""
from pathlib import Path
import unittest

class PublishedV21(unittest.TestCase):
    def test_demo_path_and_only_owner_materials(self):
        home=Path("docs/index.html").read_text(encoding="utf-8")
        page=Path("docs/song-vision-v21-vowels.html").read_text(encoding="utf-8")
        lab=Path("docs/song-vision-lab.html").read_text(encoding="utf-8")
        asset="vision-owner/SONG_v21_TEN_KOREAN_VOWELS_OWNER_FULL_FACE_TEST.mp4"
        self.assertIn(asset,home)
        self.assertIn(asset,page)
        self.assertIn(asset,lab)
        movie=Path("docs")/asset
        self.assertTrue(movie.is_file())
        self.assertGreater(movie.stat().st_size,10000)
        self.assertIn("PREVIEW_UNALIGNED",Path("song_vision/owner_v21_text_viseme.py").read_text(encoding="utf-8"))
