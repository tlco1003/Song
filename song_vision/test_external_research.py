"""Offline assertions for licensed RAVDESS research loader; no network/face data."""
import tempfile
import unittest
import zipfile
from pathlib import Path
from song_vision.external_ravdess_research import (
    ARCHIVE_URL, FILE_NAMES, MAX_BYTES, ORIGINAL_MD5, select_research_clips
)

class ResearchDataSafety(unittest.TestCase):
    def test_source_pinned(self):
        self.assertIn("zenodo.org/records/1188976/files/Video_Song_Actor_01.zip", ARCHIVE_URL)
        self.assertEqual(len(ORIGINAL_MD5), 32)
        self.assertLess(MAX_BYTES, 600 * 1024 * 1024)
        self.assertEqual(len(FILE_NAMES), 2)

    def test_extract_only_selected_two(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "fixtures.zip"
            with zipfile.ZipFile(archive, "w") as z:
                for name in FILE_NAMES:
                    z.writestr("Actor_01/" + name, b"0" * 100_001)
                z.writestr("Actor_01/private.txt", b"unused")
            found = select_research_clips(archive, root)
            self.assertEqual(len(found), 2)
            self.assertFalse((root / "private.txt").exists())
            self.assertTrue(all(f.stat().st_size == 100_001 for f in found))

    def test_missing_take_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "fixtures.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("Actor_01/" + FILE_NAMES[0], b"0" * 100_001)
            with self.assertRaisesRegex(ValueError, "exactly one source"):
                select_research_clips(archive, root)

if __name__ == "__main__":
    unittest.main()
