"""Fake ZIP tests for diverse RAVDESS selections; no real people/images."""
import tempfile
import unittest
import zipfile
from pathlib import Path

from song_vision.external_ravdess_diverse_retrain import (
    EMOTIONS, STATEMENTS, REPETITIONS, select_diverse_research_takes,
)


class DiverseResearchSources(unittest.TestCase):
    def make_archive(self, path: Path, remove_last=False):
        names = [f"01-02-{emotion}-01-{statement}-{repeat}-01.mp4"
                 for emotion in EMOTIONS for statement in STATEMENTS for repeat in REPETITIONS]
        if remove_last:
            names.pop()
        with zipfile.ZipFile(path, "w") as z:
            for name in names:
                z.writestr("Actor_01/" + name, b"S" * 100001)

    def test_select_twenty_different_repetitions_and_statements(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            zip_path = root / "sample.zip"
            self.make_archive(zip_path)
            clips = select_diverse_research_takes(zip_path, root)
            self.assertEqual(len(clips), 20)
            self.assertEqual(sum(x.split == "train" for x in clips), 10)
            self.assertEqual(sum(x.split == "val" for x in clips), 10)
            self.assertEqual({x.statement for x in clips}, {"01", "02"})
            self.assertEqual({x.emotion for x in clips}, set(EMOTIONS))

    def test_missing_clip_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            zip_path = root / "missing.zip"
            self.make_archive(zip_path, remove_last=True)
            with self.assertRaisesRegex(ValueError, "Expected one source"):
                select_diverse_research_takes(zip_path, root)


if __name__ == "__main__":
    unittest.main()
