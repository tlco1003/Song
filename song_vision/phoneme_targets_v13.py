"""Optional, verified Korean speech-unit supervision for SONG-Vision v13.

This is an annotation *contract*, never a guessed forced aligner. It covers
13 requested basic consonants and 5 requested vowels. Other languages and
Korean variants require separate reviewed phonetic mapping, not silent fallback.
When no aligned human-reviewed annotations exist, phoneme classification loss
must be SKIPPED; only video-observed articulatory geometry is learned.

Time coordinates must match the ORIGINAL vocal stem identified by SHA-256
from the trusted local preparation index. Never use the song lyric alone as
ground truth timing, and never claim perfect Korean acoustic phoneme mapping.
"""
from __future__ import annotations

import bisect
import json
import math
import re
from pathlib import Path

CONSONANTS = tuple("ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅋㅌㅍㅎ")
VOWELS = ("ㅏ", "ㅣ", "ㅜ", "ㅔ", "ㅗ")
SCHEMA_VERSION = 1
IGNORE_LABEL = -100


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def read_reviewed_phone_timeline(path: Path, source_audio_sha256: str) -> dict:
    """Validate an explicit phone timeline before using it as training truth."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("Unsupported human-reviewed phoneme timeline")
    if (raw.get("alignmentMethod") != "human_reviewed_phonemes" or
            raw.get("verified") is not True or
            raw.get("timeBase") != "vocal_file_seconds"):
        raise ValueError("Only human-reviewed actual vocal phoneme timing is accepted")
    reviewer = raw.get("verifiedBy")
    if not isinstance(reviewer, str) or not reviewer.strip() or len(reviewer) > 120:
        raise ValueError("Reviewer attribution required")
    if (not isinstance(source_audio_sha256, str) or
            not re.fullmatch(r"[a-f0-9]{64}", source_audio_sha256) or
            raw.get("vocalSha256") != source_audio_sha256):
        raise ValueError("Phone alignment does not belong to prepared original vocals")
    duration = raw.get("durationSeconds")
    if not _finite(duration) or not .1 <= duration <= 900:
        raise ValueError("Valid vocal duration required")
    segments = raw.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ValueError("Nonempty manually checked timing segments required")
    cursor = 0.
    checked = []
    for row in segments:
        if not isinstance(row, dict):
            raise ValueError("Invalid phone timing row")
        start, end = row.get("startSeconds"), row.get("endSeconds")
        if not _finite(start) or not _finite(end) or end - start < .005:
            raise ValueError("Phone times must be finite, chronological, >=5 ms")
        if abs(float(start) - cursor) > .001:
            raise ValueError("Phone timing has an unlabelled gap or overlap")
        kind = row.get("kind")
        symbol = row.get("symbol")
        if kind == "rest" and symbol not in (None, ""):
            raise ValueError("A rest cannot have a phoneme label")
        if kind == "consonant" and symbol not in CONSONANTS:
            raise ValueError("Unreviewed/unsupported consonant: expand schema deliberately")
        if kind == "vowel" and symbol not in VOWELS:
            raise ValueError("Unreviewed/unsupported vowel: expand schema deliberately")
        if kind not in {"rest", "consonant", "vowel"}:
            raise ValueError("Phone unit must be rest/consonant/vowel")
        checked.append((float(start), float(end), kind, symbol or ""))
        cursor = float(end)
    if abs(cursor - float(duration)) > .001:
        raise ValueError("Manual alignment must cover entire vocal duration including rests")
    return {"duration": float(duration), "reviewedBy": reviewer.strip(),
            "sourceAudioSha256": source_audio_sha256, "segments": tuple(checked),
            "starts": tuple(row[0] for row in checked)}


def labels_at_second(timeline: dict | None, seconds: float) -> tuple[int, int]:
    """(-100,-100) means unlabelled, NOT acoustic silence classification."""
    if timeline is None:
        return IGNORE_LABEL, IGNORE_LABEL
    if not _finite(seconds) or seconds < 0 or seconds >= timeline["duration"]:
        raise ValueError("Sample outside verified vocal timeline")
    index = max(0, bisect.bisect_right(timeline["starts"], seconds) - 1)
    start, end, kind, symbol = timeline["segments"][index]
    if not start <= seconds < end:
        raise ValueError("No reviewed phone at supplied sample time")
    if kind == "consonant":
        return CONSONANTS.index(symbol), IGNORE_LABEL
    if kind == "vowel":
        return IGNORE_LABEL, VOWELS.index(symbol)
    return IGNORE_LABEL, IGNORE_LABEL
