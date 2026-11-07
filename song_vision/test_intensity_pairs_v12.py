"""Offline tests: normal/strong paired SONG v12 research protocol."""
import tempfile
import unittest
import zipfile
from pathlib import Path

from song_vision.external_ravdess_intensity_v12 import (
    ACTORS, INTENSITY_CONDITIONS, EXPECTED_TAKES_PER_ACTOR,
    select_condition_balanced_singing, check_performer_and_strength_split,
)
from song_vision.external_ravdess_diverse_retrain import EMOTIONS, STATEMENTS, REPETITIONS


class MatchedIntensityResearchTests(unittest.TestCase):
    @staticmethod
    def make_fake_zip(path, actor, missing=None):
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as zf:
            for emotion in EMOTIONS:
                for condition in INTENSITY_CONDITIONS:
                    for statement in STATEMENTS:
                        for repetition in REPETITIONS:
                            name = (
                                f"01-02-{emotion}-{condition}-{statement}-"
                                f"{repetition}-{actor}.mp4"
                            )
                            if name != missing:
                                zf.writestr("Actor_" + actor + "/" + name,
                                            b"fake-only-v12-test-av" * 5500)
            zf.writestr("Actor_" + actor + "/non-singer.png",
                        b"ignore unlicensed/other media")

    def test_every_actor_contains_20_strength_pairs_and_never_leaks_val_person(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            takes = []
            for actor in ACTORS:
                archive = root / f"actor-{actor}.zip"
                self.make_fake_zip(archive, actor)
                parsed = select_condition_balanced_singing(
                    archive, root, actor)
                self.assertEqual(len(parsed), EXPECTED_TAKES_PER_ACTOR)
                self.assertEqual(len({t.match_key for t in parsed}), 20)
                self.assertEqual(sum(t.condition == "02" for t in parsed), 20)
                takes.extend(parsed)
            split = check_performer_and_strength_split(takes)
            self.assertEqual(split["trainingClips"], 80)
            self.assertEqual(split["validationClips"], 40)
            self.assertEqual(split["matchedPairs"], 60)
            self.assertEqual(split["normalRecordings"], 60)
            self.assertEqual(split["strongExpressionRecordings"], 60)
            self.assertEqual(split["holdoutActors"], ["03"])
            self.assertTrue(all(t.actor == "03" for t in takes if t.split == "val"))
            self.assertTrue(all(t.actor != "03" for t in takes if t.split == "train"))

    def test_missing_strong_clip_fails_before_model_training(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "bad.zip"
            missing = "01-02-02-02-01-01-01.mp4"
            self.make_fake_zip(archive, "01", missing=missing)
            with self.assertRaisesRegex(ValueError, "Missing/ambiguous matched"):
                select_condition_balanced_singing(archive, root, "01")

    def test_no_duplicate_or_cross_singer_leak(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            takes = []
            for actor in ACTORS:
                archive = root / f"actor-{actor}.zip"
                self.make_fake_zip(archive, actor)
                takes.extend(select_condition_balanced_singing(archive, root, actor))
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                check_performer_and_strength_split(takes[:-1] + [takes[0]])
            with self.assertRaisesRegex(ValueError, "120 verified"):
                check_performer_and_strength_split(takes[:-1])


if __name__ == "__main__":
    unittest.main()
