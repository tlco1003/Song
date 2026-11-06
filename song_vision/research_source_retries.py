"""Bounded retries for an official verified RAVDESS research source.

Never accept other media, a different license or a checksum mismatch.
"""
from __future__ import annotations

import time
import urllib.error
from pathlib import Path

from .external_ravdess_research import download_public_archive


def download_research_archive_with_retry(target: Path) -> str:
    for attempt in range(4):
        try:
            return download_public_archive(target)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            target.unlink(missing_ok=True)
            if isinstance(error, urllib.error.HTTPError) and error.code not in (
                429, 500, 502, 503, 504
            ):
                raise
            if attempt == 3:
                raise
            pause_seconds = (5, 15, 30)[attempt]
            print(
                f"SONG_ZENODO_TRANSIENT_RETRY={attempt + 1};waitSeconds={pause_seconds}",
                flush=True,
            )
            time.sleep(pause_seconds)
    raise RuntimeError("Unexpected download retry exhaustion")
