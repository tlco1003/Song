"""Korean syllable-to-viseme timing control for local SONG-Vision previews.

This is a deterministic, operator-aligned RESEARCH control layer, not acoustic
forced alignment and not a trained articulatory synthesis model. The ratio
values are initial design targets requiring calibration on consented singers.
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

SCHEMA_VERSION = 1
# Hangul syllable Unicode arithmetic (U+AC00..U+D7A3).
ONSETS = tuple("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")
VOWELS = tuple("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ")
CODAS = (
    "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ",
    "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
)
BILABIAL_ONSETS = frozenset({"ㅁ", "ㅂ", "ㅃ", "ㅍ"})
BILABIAL_CODAS = frozenset({"ㅁ", "ㅂ", "ㅄ", "ㄻ", "ㄼ", "ㄿ"})
# (inner-lip-open / mouth-width, horizontal-width scale, roundedness tag).
# These are conservative ENGINEERING START VALUES, not published mm data.
VOWEL_SHAPES = {
    "ㅏ": (.280, 1.01, 0.00), "ㅐ": (.170, 1.05, 0.00),
    "ㅑ": (.255, 1.01, 0.00), "ㅒ": (.160, 1.05, 0.00),
    "ㅓ": (.195, 0.98, 0.00), "ㅔ": (.155, 1.06, 0.00),
    "ㅕ": (.180, 0.98, 0.00), "ㅖ": (.150, 1.06, 0.00),
    "ㅗ": (.110, 0.84, 0.85), "ㅘ": (.185, 0.91, 0.65),
    "ㅙ": (.155, 0.94, 0.50), "ㅚ": (.100, 0.88, 0.75),
    "ㅛ": (.110, 0.86, 0.85), "ㅜ": (.085, 0.82, 1.00),
    "ㅝ": (.145, 0.89, 0.70), "ㅞ": (.135, 0.91, 0.65),
    "ㅟ": (.075, 0.85, 0.85), "ㅠ": (.090, 0.83, 1.00),
    "ㅡ": (.055, 1.11, 0.00), "ㅢ": (.085, 1.06, 0.00),
    "ㅣ": (.060, 1.13, 0.00),
}

SILENCE = (0.008, 1.0, 0.0)
CLOSED = (0.008, 0.96, 0.0)


@dataclass(frozen=True)
class Syllable:
    onset: str
    vowel: str
    coda: str


@dataclass(frozen=True)
class Segment:
    kind: str
    start: float
    end: float
    syllable: str = ""
    onset: str = ""
    vowel: str = ""
    coda: str = ""


@dataclass(frozen=True)
class Timeline:
    duration: float
    vocal_sha256: str
    verified_by: str
    segments: tuple[Segment, ...]


def decompose_syllable(value: str) -> Syllable:
    if len(value) != 1 or not 0xAC00 <= ord(value) <= 0xD7A3:
        raise ValueError("Expected exactly one precomposed Korean Hangul syllable")
    index = ord(value) - 0xAC00
    return Syllable(ONSETS[index // (21 * 28)],
                    VOWELS[(index % (21 * 28)) // 28], CODAS[index % 28])


def _float_seconds(value, name: str) -> float:
    if type(value) not in (float, int) or not math.isfinite(value):
        raise ValueError(f"Invalid {name}: finite seconds required")
    return float(value)


def _parse_segment(raw: dict) -> Segment:
    if not isinstance(raw, dict) or raw.get("kind") not in {"syllable", "rest"}:
        raise ValueError("Each segment must be syllable or rest")
    start = _float_seconds(raw.get("startSeconds"), "startSeconds")
    end = _float_seconds(raw.get("endSeconds"), "endSeconds")
    if not 0 <= start < end:
        raise ValueError("Invalid syllable/rest times")
    if raw["kind"] == "rest":
        if any(raw.get(k) for k in ("syllable", "onset", "vowel", "coda")):
            raise ValueError("Rest may not contain pronunciation")
        return Segment("rest", start, end)
    char = raw.get("syllable")
    if not isinstance(char, str):
        raise ValueError("Missing Hangul syllable")
    orthographic = decompose_syllable(char)
    onset = raw.get("onset", orthographic.onset)
    vowel = raw.get("vowel", orthographic.vowel)
    coda = raw.get("coda", orthographic.coda)
    if onset not in ONSETS or vowel not in VOWELS or coda not in CODAS:
        raise ValueError("Invalid annotated phonetic overrides")
    if end - start < 0.02:
        raise ValueError("Syllable shorter than 20 ms must be reviewed")
    return Segment("syllable", start, end, char, onset, vowel, coda)


def load_timeline(path: Path) -> Timeline:
    """Reject guessed timings and audio-file mismatches by design."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("Unsupported timeline schema")
    if raw.get("alignmentMethod") != "human_reviewed" or raw.get("verified") is not True:
        raise ValueError("An explicitly human-reviewed vocal alignment is required")
    who = raw.get("verifiedBy")
    if not isinstance(who, str) or not who.strip() or len(who) > 120:
        raise ValueError("Missing annotation reviewer")
    if raw.get("timeBase") != "vocal_file_seconds":
        raise ValueError("All times must be relative to the chosen vocal file")
    vocal_sha = raw.get("vocalSha256")
    if not isinstance(vocal_sha, str) or re.fullmatch(r"[a-f0-9]{64}", vocal_sha) is None:
        raise ValueError("The annotated vocal file SHA256 is required")
    duration = _float_seconds(raw.get("durationSeconds"), "durationSeconds")
    if not 0.1 <= duration <= 900:
        raise ValueError("Timeline duration must be 0.1..900 seconds")
    if not isinstance(raw.get("segments"), list) or not raw["segments"]:
        raise ValueError("Nonempty timeline segments required")
    segments = tuple(_parse_segment(seg) for seg in raw["segments"])
    cursor = 0.0
    for seg in segments:
        if abs(seg.start - cursor) > 0.001:
            raise ValueError("Timeline has a gap/overlap. Add explicit rest segments.")
        cursor = seg.end
    if abs(cursor - duration) > 0.001:
        raise ValueError("Timeline must cover its declared duration")
    return Timeline(duration, vocal_sha, who.strip(), segments)


def verify_audio_file(timeline: Timeline, vocal_file: Path):
    actual = hashlib.sha256(vocal_file.read_bytes()).hexdigest()
    if timeline.vocal_sha256 != actual:
        raise ValueError("Vocal SHA256 mismatch: alignment belongs to a different file")


def _shape(seg: Segment, elapsed: float) -> tuple[float, float, float]:
    if seg.kind == "rest":
        return SILENCE
    opening, width, roundness = VOWEL_SHAPES[seg.vowel]
    duration = seg.end - seg.start
    # Bilabial closures are approximate and never claim exact plosive timing.
    closure = min(0.045, duration * 0.20)
    if seg.onset in BILABIAL_ONSETS and elapsed < closure:
        progress = max(0., min(1., elapsed / max(closure, 1e-6)))
        k = progress * progress * (3 - 2 * progress)
        return _lerp(CLOSED, (opening, width, roundness), k)
    if seg.coda in BILABIAL_CODAS and duration - elapsed < closure:
        progress = max(0., min(1., (duration - elapsed) / max(closure, 1e-6)))
        k = progress * progress * (3 - 2 * progress)
        return _lerp(CLOSED, (opening, width, roundness), k)
    return opening, width, roundness


def _lerp(a: tuple, b: tuple, fraction: float) -> tuple:
    return tuple((1. - fraction) * x + fraction * y for x, y in zip(a, b))


def sample_viseme(timeline: Timeline, second: float) -> dict:
    t = _float_seconds(second, "sample time")
    if t < 0 or t >= timeline.duration:
        raise ValueError("Sample time must fall inside annotated vocal duration")
    starts = [seg.start for seg in timeline.segments]
    idx = max(0, bisect.bisect_right(starts, t) - 1)
    seg = timeline.segments[idx]
    local = t - seg.start
    current = _shape(seg, local)
    # Short blending across syllable boundaries approximates coarticulation.
    # At a shared boundary both segments use the same averaged target.
    window = min(.06, (seg.end - seg.start) * .25)
    if idx > 0 and local < window:
        previous = timeline.segments[idx - 1]
        before = _shape(previous, previous.end - previous.start)
        blend = .5 + .5 * local / max(window, 1e-6)
        current = _lerp(before, current, blend)
    if idx + 1 < len(timeline.segments):
        remaining = seg.end - t
        if remaining < window:
            upcoming = timeline.segments[idx + 1]
            after = _shape(upcoming, 0)
            blend = .5 * (1 - remaining / max(window, 1e-6))
            current = _lerp(current, after, blend)
    return {
        "timeSeconds": round(t, 6),
        "kind": seg.kind,
        "syllable": seg.syllable,
        "vowel": seg.vowel,
        "openingRatio": round(current[0], 6),
        "widthScale": round(current[1], 6),
        "roundnessProxy": round(current[2], 6),
        "quality": "heuristic_orthographic_viseme_not_verified_lipsync",
    }


def sample_frames(timeline: Timeline, start: float, length: float, fps: int = 25) -> list[dict]:
    begin = _float_seconds(start, "start")
    duration = _float_seconds(length, "length")
    if begin < 0 or duration <= 0 or not 1 <= fps <= 120:
        raise ValueError("Invalid frame selection")
    count = math.ceil(duration * fps)
    if begin + (count - 1) / fps >= timeline.duration:
        raise ValueError("Annotated timeline does not cover every output frame")
    return [sample_viseme(timeline, begin + i / fps) for i in range(count)]


def main():
    parser = argparse.ArgumentParser(description="Korean viseme timeline checker, no fake auto-alignment")
    parser.add_argument("--timeline", type=Path, required=True)
    parser.add_argument("--vocals", type=Path, required=True)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--seconds", type=float, default=1)
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    timeline = load_timeline(args.timeline)
    verify_audio_file(timeline, args.vocals)
    frames = sample_frames(timeline, args.start, args.seconds, args.fps)
    result = {
        "engine": "song-vision-korean-viseme-v1",
        "alignmentMethod": "human_reviewed",
        "timeBase": "vocal_file_seconds",
        "vocalSha256": timeline.vocal_sha256,
        "fps": args.fps,
        "status": "heuristic_not_phoneme_lipsync_validated",
        "frames": frames,
    }
    if args.output is not None:
        if args.output.exists():
            raise FileExistsError("Refusing to overwrite existing private viseme output")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"engine": result["engine"], "status": result["status"],
                      "frameCount": len(frames), "vocalSha256": timeline.vocal_sha256}))


if __name__ == "__main__":
    main()
