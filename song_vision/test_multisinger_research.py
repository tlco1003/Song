"""RAVDESS singer-held-out training data contracts; fully offline fixtures."""
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from song_vision.external_ravdess_multisinger import (
    ACTOR_MD5, DATASET_ID, TRAIN_ACTORS, HOLDOUT_ACTORS,
    SingingTake, check_singer_disjoint, download_official_actor_zip,
    extract_research_takes, run_multi_singer_research,
)
from song_vision.external_ravdess_diverse_retrain import EMOTIONS, STATEMENTS, REPETITIONS
from song_vision.research_checkpoint_vault import _validated_metadata


class MultiSingerResearchTests(unittest.TestCase):
    def _write_fake_zip(self, path, actor):
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as zf:
            for e in EMOTIONS:
                for statement in STATEMENTS:
                    for repeat in REPETITIONS:
                        filename = f"01-02-{e}-01-{statement}-{repeat}-{actor}.mp4"
                        zf.writestr(f"Actor_{actor}/{filename}", b"AV-format-test-only-" * 6500)
            zf.writestr(f"Actor_{actor}/not-training-data.mp4", b"never-extracted")

    def test_two_training_singers_and_unseen_validation_singer(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            takes = []
            for actor in ("01", "02", "03"):
                archive = root / (actor + ".zip")
                self._write_fake_zip(archive, actor)
                parsed = extract_research_takes(archive, root, actor)
                self.assertEqual(len(parsed), 20)
                takes.extend(parsed)
            split = check_singer_disjoint(takes)
            self.assertEqual(split["trainActors"], ["01", "02"])
            self.assertEqual(split["holdoutActors"], ["03"])
            self.assertEqual(split["trainRecordings"], 40)
            self.assertEqual(split["holdoutRecordings"], 20)
            self.assertFalse((root / "not-training-data.mp4").exists())
            self.assertEqual(len({take.path.name for take in takes}), 60)

    def test_all_archives_pinned_to_zenodo_md5(self):
        self.assertEqual(ACTOR_MD5["01"], "0f7ba20f3a7278d5a662a7e30f44c942")
        self.assertEqual(ACTOR_MD5["02"], "8e426ef4134abe1dff4d2a8262abe8a9")
        self.assertEqual(ACTOR_MD5["03"], "2d686591f8760f8041d2dc75e8234828")
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "Actor not in approved"):
                download_official_actor_zip("24", Path(td) / "bad.zip")

    def test_missing_or_bad_archive_does_not_silently_continue(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            path = root / "missing.zip"
            self._write_fake_zip(path, "02")
            with self.assertRaisesRegex(ValueError, "Exactly one authorized clip"):
                extract_research_takes(path, root, "01")

    def test_cross_performer_leakage_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            takes = []
            for actor in ("01", "02", "03"):
                for emotion in EMOTIONS:
                    for statement in STATEMENTS:
                        for repetition in REPETITIONS:
                            take = SingingTake(root / f"{actor}-{emotion}-{statement}-{repetition}.mp4",
                                               actor, emotion, statement, repetition)
                            takes.append(take)
            self.assertEqual(len(takes), 60)
            check_singer_disjoint(takes)
            leaked = [take for take in takes if take.actor != "03"]
            with self.assertRaisesRegex(ValueError, "60 individual recordings"):
                check_singer_disjoint(leaked)

    def test_vault_label_allows_new_research_set_but_not_other_data(self):
        meta = {
            "dataset": DATASET_ID, "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "githubRunId": "test-actor-holdout", "modelVersion": "song-vision-masked-audio-v2",
        }
        self.assertEqual(_validated_metadata(meta)["dataset"], DATASET_ID)
        meta["commercialUseAllowed"] = True
        with self.assertRaisesRegex(ValueError, "Commercial use"):
            _validated_metadata(meta)

    def test_training_parameters_fail_before_network(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            key = root / "public.pem"
            key.write_text("synthetic mock")
            with self.assertRaisesRegex(ValueError, "early stopping"):
                run_multi_singer_research(key, root / "out", epochs=99)
            with self.assertRaisesRegex(ValueError, "early stopping"):
                run_multi_singer_research(key, root / "out", epochs=10, min_epochs=12)


if __name__ == "__main__":
    unittest.main()
