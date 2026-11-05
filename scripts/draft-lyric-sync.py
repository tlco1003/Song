#!/usr/bin/env python3
"""Create review-only lyric timing drafts for every public track.

Never commit the results to docs/media/ automatically: singing ASR can misalign
repeated choruses or confuse backing vocals and long instrumental sections.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "docs" / "media"
OUT = ROOT / "lyric-sync-drafts"
SAFE = re.compile(r"^[A-Za-z0-9가-힣_.-]{1,110}$")
BAD_HEADING = re.compile(r"^(?:verse\s*\d+\]|(?:version|버전)\s*\d+\]?)$", re.I)
SECTION = re.compile(r"^\[[^]]+\]$")


def visible_lines(text: str) -> list[str]:
    lines = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s or SECTION.fullmatch(s) or BAD_HEADING.fullmatch(s):
            continue
        if s.startswith("#"):
            continue
        lines.append(s)
    return lines


def align_one(track: dict) -> dict:
    song_id = track.get("id", "")
    filename = track.get("file", "")
    lyric_file = track.get("lyricsFile", "")
    summary = {"id": song_id, "title": track.get("title"), "status": "error"}
    if not song_id.startswith("song-") or any(
        not SAFE.fullmatch(name) for name in [filename, lyric_file]
    ):
        summary["error"] = "unsafe filename or missing track ID"
        return summary
    media_path, lyric_path = MEDIA / filename, MEDIA / lyric_file
    if not media_path.is_file() or media_path.stat().st_size < 1024 or not lyric_path.is_file():
        summary["error"] = "media/lyrics file missing or empty"
        return summary

    original = visible_lines(lyric_path.read_text(encoding="utf-8"))
    if not original:
        summary["error"] = "empty lyric lines"
        return summary

    # The upstream CLI treats a whole parenthesized sung ad-lib as a section marker.
    # Remove its surrounding parentheses *only in the temporary ASR input*.
    normalized = [s[1:-1].strip() if s.startswith("(") and s.endswith(")") else s
                  for s in original]
    OUT.mkdir(parents=True, exist_ok=True)
    temp = OUT / f"{song_id}.input.txt"
    temp.write_text("\n".join(normalized) + "\n", encoding="utf-8")
    raw_path = OUT / f"{song_id}.aligned.json"

    command = [
        "lyric-align", str(media_path), str(temp), "--language", "ko",
        "--model", "small", "--no-vad", "--format", "json", "-o", str(raw_path)
    ]
    try:
        job = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=3000)
    except Exception as exc:
        summary["error"] = f"alignment process: {exc}"
        return summary
    (OUT / f"{song_id}.log").write_text(
        job.stdout[-5000:] + "\n" + job.stderr[-12000:], encoding="utf-8")
    if job.returncode != 0 or not raw_path.is_file():
        summary["error"] = f"lyric-align exit={job.returncode}"
        return summary

    try:
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        if len(raw) != len(original):
            raise ValueError("aligned line count does not equal source lyrics")

        times, matched, confidence = [], [], []
        prev = -1.0
        for i, row in enumerate(raw):
            # Never trust alignment that changes the known lyric text or sequence.
            if row.get("line") != normalized[i]:
                raise ValueError(f"lyric mismatch at line {i+1}")
            at = row.get("start")
            valid = (row.get("matched") is True
                     and isinstance(at, (int, float))
                     and not isinstance(at, bool)
                     and at >= 0 and at > prev)
            if valid:
                start = round(float(at), 2)
                if start <= prev:
                    valid = False
            if valid:
                times.append(start)
                prev = start
            else:
                times.append(None)
            matched.append(bool(valid))
            confidence.append(float(row.get("score") or 0.0))
        draft = {
            "schemaVersion": 1,
            "source": "unreviewed-asr-draft",
            "id": song_id,
            "file": filename,
            "lyricsFile": lyric_file,
            "lines": original,
            "times": times,
            "matched": matched,
            "confidence": confidence,
            "verified": False
        }
        (OUT / f"{song_id}.json").write_text(
            json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        summary.update(status="draft", totalLines=len(original),
                       autoMatched=sum(matched),
                       needsReview=len(original), verified=False)
    except Exception as exc:
        summary["error"] = str(exc)
    return summary


def main() -> int:
    tracks = json.loads((MEDIA / "tracks.json").read_text(encoding="utf-8"))["tracks"]
    if not tracks:
        raise SystemExit("no public tracks")
    OUT.mkdir(parents=True, exist_ok=True)
    report = [align_one(t) for t in tracks]
    (OUT / "report.json").write_text(
        json.dumps({"tracks": report, "allVerified": False}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    for row in report:
        print(f"{row['id']}: {row['status']} {row.get('autoMatched', 0)}/{row.get('totalLines', '?')}"
              f" {row.get('error', '')}", flush=True)
    if not any(x["status"] == "draft" for x in report):
        print("No draft produced: inspect logs in artifact", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
