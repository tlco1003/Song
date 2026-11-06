"""Offline bounded retry tests; no real downloads or raw RAVDESS media."""
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from song_vision.research_source_retries import download_research_archive_with_retry


class SourceRetriesTests(unittest.TestCase):
    def test_http_500_retries_and_verifies_via_original_downloader(self):
        events = [urllib.error.HTTPError("https://zenodo.org/", 500, "outage", {}, None),
                  "verified-original-md5"]
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "source.zip"
            def fake_fetch(path):
                result = events.pop(0)
                if isinstance(result, Exception):
                    path.write_bytes(b"incomplete")
                    raise result
                return result
            with patch("song_vision.research_source_retries.download_public_archive",
                       side_effect=fake_fetch) as mocked:
                with patch("song_vision.research_source_retries.time.sleep") as sleep:
                    result = download_research_archive_with_retry(archive)
                self.assertEqual(result, "verified-original-md5")
                self.assertEqual(mocked.call_count, 2)
                sleep.assert_called_once_with(5)
                self.assertFalse(archive.exists())

    def test_http_403_is_not_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            error = urllib.error.HTTPError("https://zenodo.org/", 403,
                                           "forbidden", {}, None)
            with patch("song_vision.research_source_retries.download_public_archive",
                       side_effect=error) as mocked:
                with self.assertRaises(urllib.error.HTTPError):
                    download_research_archive_with_retry(Path(tmp) / "archive.zip")
                self.assertEqual(mocked.call_count, 1)


if __name__ == "__main__":
    unittest.main()
