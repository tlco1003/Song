"""SONG AI v39: auditable Korean phone timeline contracts.

MFA is an *external real acoustic aligner*, not part of this file. Its output
contains acoustic time guesses, not gold Korean speech/singing phonemes.
Human-reviewed timing is a distinct, explicit provenance class.
"""
from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from bisect import bisect_right
from pathlib import Path

SCHEMA = "SONG_AI_PHONE_ALIGNMENT_V39"
ONSETS = tuple("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")
VOWELS = tuple("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ")
CODAS = ("",) + tuple("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")
SLOTS = frozenset(("onset", "vowel", "coda", "unknown"))
SOURCES = frozenset(("mfa_candidate", "human_verified"))
# IPA mapping for *candidates*, never sufficient for human verified provenance.
IPA_VOWELS = {
    "a":"ㅏ", "ɑ":"ㅏ", "ɐ":"ㅏ", "ɛ":"ㅐ", "e":"ㅔ",
    "ʌ":"ㅓ", "ə":"ㅓ", "o":"ㅗ", "u":"ㅜ", "ɨ":"ㅡ", "i":"ㅣ",
}
IPA_CONSONANTS = {
    "ɡ":"ㄱ", "g":"ㄱ", "k":"ㄱ", "k͈":"ㄲ", "kʰ":"ㅋ", "n":"ㄴ",
    "t":"ㄷ", "d":"ㄷ", "t͈":"ㄸ", "tʰ":"ㅌ", "ɾ":"ㄹ", "ɭ":"ㄹ",
    "m":"ㅁ", "p":"ㅂ", "b":"ㅂ", "p͈":"ㅃ", "pʰ":"ㅍ", "s":"ㅅ",
    "s͈":"ㅆ", "tɕ":"ㅈ", "tɕ͈":"ㅉ", "tɕʰ":"ㅊ", "h":"ㅎ", "ŋ":"ㅇ",
}
SILENCE = frozenset(("sil", "sp", "spn", "<eps>", ""))


class AlignmentError(ValueError):
    pass


def sha256_text(text: str) -> str:
    return hashlib.sha256(unicodedata.normalize("NFC", text).encode("utf-8")).hexdigest()


def hangul_parts(text: str) -> list[dict]:
    items = []
    for line_no, line in enumerate(unicodedata.normalize("NFC", text).splitlines()):
        for ch in line:
            idx = ord(ch) - 0xAC00
            if 0 <= idx < 11172:
                lead, remainder = divmod(idx, 588)
                vowel, tail = divmod(remainder, 28)
                items.append({"glyph": ch, "onset": ONSETS[lead], "vowel": VOWELS[vowel],
                              "coda": CODAS[tail], "line": line_no})
            elif ch.isspace() or unicodedata.category(ch)[0] in ("P", "S"):
                continue
            else:
                raise AlignmentError(f"Unsupported lyric codepoint U+{ord(ch):04X} at line {line_no+1}")
    if not items:
        raise AlignmentError("No Hangul lyrics")
    return items


def clean_phone(raw: str) -> str:
    value = raw.strip().replace("ː", "").replace("ˑ", "").replace(":", "")
    return value


def ipa_guess(raw: str) -> tuple[str, str | None]:
    norm = clean_phone(raw)
    if norm in IPA_VOWELS:
        return "vowel", IPA_VOWELS[norm]
    if norm in IPA_CONSONANTS:
        return "onset", IPA_CONSONANTS[norm]
    if norm in ("j", "w", "ɥ", "ɰ"):
        return "unknown", None  # glide to following vowel: don't invent a mapping
    return "unknown", None


def _validate_interval(start, end, duration, label="interval") -> tuple[float, float]:
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end)):
        raise AlignmentError(f"{label} must have finite numeric bounds")
    if start < -0.000001 or end <= start or end > duration + .001:
        raise AlignmentError(f"{label} [{start}, {end}] out of range [0,{duration}]")
    return float(start), float(end)


def validate_phone_alignment(payload: dict, lyrics: str, duration: float, *, require_verified=False) -> dict:
    """Strict grade separation: MFA candidate != verified phonemes.

    Every Hangul lyric syllable has its own nonoverlapping timed interval.
    Every phone within it has its own interval and a known slot for verified mode.
    Surface phone realizations MAY differ from underlying Hangul due to liaison,
    assimilation and deletions, so identity is not asserted from spelling.
    """
    if payload.get("schema") != SCHEMA:
        raise AlignmentError("Unrecognized phone alignment schema")
    source = payload.get("source")
    if source not in SOURCES:
        raise AlignmentError("source must be human_verified or mfa_candidate")
    if require_verified and source != "human_verified":
        raise AlignmentError("Unreviewed MFA timeline cannot become supervised ground truth")
    if payload.get("lyricsSHA256") != sha256_text(lyrics):
        raise AlignmentError("Alignment lyrics hash differs from current lyrics")
    rows = payload.get("syllables")
    expected = hangul_parts(lyrics)
    if not isinstance(rows, list) or len(rows) != len(expected):
        raise AlignmentError("Exactly one interval per lyric syllable required")
    previous = 0.
    valid_phones = 0
    phone_unknowns = 0
    all_mouth_time = 0.
    for ix, (item, written) in enumerate(zip(rows, expected)):
        if item.get("glyph") != written["glyph"]:
            raise AlignmentError(f"Syllable {ix} is not the transcript glyph")
        a, b = _validate_interval(item.get("start"), item.get("end"), duration, f"syllable {ix}")
        if a < previous - 1e-6:
            raise AlignmentError(f"Syllables overlap at index {ix}")
        previous = b
        phones = item.get("phones")
        if not isinstance(phones, list) or not phones:
            raise AlignmentError(f"Phone events missing for syllable {ix}")
        last_phone = a
        vowel_phones = 0
        for j, p in enumerate(phones):
            q, z = _validate_interval(p.get("start"), p.get("end"), duration, f"phone {ix}:{j}")
            if q < a-1e-5 or z > b+1e-5 or q < last_phone - 1e-6:
                raise AlignmentError(f"Phone {ix}:{j} outside syllable or overlapping")
            last_phone = z
            slot = p.get("slot")
            if slot not in SLOTS:
                raise AlignmentError(f"Unsupported phone slot at {ix}:{j}")
            if slot == "unknown":
                phone_unknowns += 1
                if require_verified:
                    raise AlignmentError("Verified alignment cannot have unknown phone place/manner")
            if slot == "vowel":
                vowel_phones += 1
            symbol = p.get("symbol")
            if not isinstance(symbol, str) or not symbol.strip():
                raise AlignmentError("Each phone must retain a nonempty IPA or Hangul symbol")
            if require_verified:
                if p.get("source") != "human_verified":
                    raise AlignmentError("Phone source must be human_verified")
                if slot == "vowel" and symbol not in VOWELS:
                    raise AlignmentError("Verified vowel controls must use valid Hangul jamo")
                if slot in ("onset", "coda") and symbol not in ONSETS + CODAS:
                    raise AlignmentError("Verified consonant controls must use valid Hangul jamo")
            valid_phones += 1
            all_mouth_time += (z-q)
        if vowel_phones < 1 and require_verified:
            raise AlignmentError(f"Verified syllable {ix} missing an actual vowel event")
        if require_verified and item.get("source") != "human_verified":
            raise AlignmentError("Syllable review provenance missing")
    if require_verified and payload.get("reviewedByHuman") is not True:
        raise AlignmentError("Verified classification requires reviewer-approved timeline")
    return {"source": source, "syllables": len(rows), "phones": valid_phones,
            "unknownPhones": phone_unknowns, "spannedPhoneSeconds": round(all_mouth_time, 3),
            "reviewed": source == "human_verified" and payload.get("reviewedByHuman") is True,
            "humanVerifiedPhonemeTiming": bool(source == "human_verified" and payload.get("reviewedByHuman") is True)}


def verified_to_v38_syllables(payload: dict, lyrics: str, duration: float) -> dict:
    validate_phone_alignment(payload, lyrics, duration, require_verified=True)
    return {"schema": "SONG_AI_VERIFIED_SYLLABLES_V1",
            "syllables": [{"glyph": row["glyph"], "start": row["start"],
                           "end": row["end"], "source": "human_verified"}
                          for row in payload["syllables"]]}


def phone_at(payload: dict, second: float) -> dict | None:
    """Return active phone and its syllable index (strictly within alignment)."""
    rows = payload["syllables"]
    index = bisect_right([r["start"] for r in rows], second) - 1
    if index < 0 or second >= rows[index]["end"]:
        return None
    phones = rows[index]["phones"]
    at = bisect_right([p["start"] for p in phones], second) - 1
    if at < 0 or second >= phones[at]["end"]:
        return None
    return {**phones[at], "syllableIndex": index, "glyph": rows[index]["glyph"]}


def read_mfa_json(path: Path, *, duration: float) -> dict:
    """Read the actual MFA 3.X JSON tier structure; never promote it to truth."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    tiers = raw.get("tiers", {})
    if not isinstance(tiers, dict):
        raise AlignmentError("MFA output missing tiers")
    phone_tiers = [v for k, v in tiers.items() if "phone" in k.lower()]
    word_tiers = [v for k, v in tiers.items() if "word" in k.lower()]
    if len(phone_tiers) != 1 or len(word_tiers) != 1:
        raise AlignmentError("Need exactly one speaker phone and word tier; multi-singer audio requires explicit isolation")
    def parse(tier, label):
        entries=tier.get("entries")
        if not isinstance(entries,list):raise AlignmentError("MFA interval tier malformed")
        out=[];prev=0.
        for row in entries:
            if not isinstance(row,list) or len(row)!=3:raise AlignmentError("Expected MFA [start,end,label]")
            a,b=_validate_interval(row[0],row[1],duration,label)
            if a<prev-1e-6:raise AlignmentError("MFA intervals overlap")
            prev=b
            symbol=str(row[2]).strip()
            if symbol and symbol not in SILENCE:
                out.append({"start":a,"end":b,"symbol":symbol})
        return out
    words=parse(word_tiers[0],"word")
    phones=parse(phone_tiers[0],"phone")
    return {"schema":"SONG_AI_MFA_CANDIDATES_V39","source":"mfa_candidate",
            "requiresHumanReview":True,"phones":[{**p,"slotCandidate":ipa_guess(p["symbol"])[0],
                  "canonicalCandidate":ipa_guess(p["symbol"])[1]} for p in phones],
            "words":words,
            "limitations":["MFA timeline is not a confirmed phoneme transcript",
                           "Korean singing with accompaniment is out of read-speech training domain",
                           "IPA-to-Hangul phone mapping is not guaranteed"]}


def write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")


def mfa_to_preview_timeline(candidate: dict, lyrics: str, duration: float) -> dict:
    """Project MFA word/phone candidates to approximate syllable bins for *preview*.

    The IPA phone begin/end values come from actual MFA output; association to
    Hangul graphemes is heuristic. If vowels don't match the number of written
    syllables in any word, FAIL rather than creating fake phoneme boundaries.
    """
    import re
    text=unicodedata.normalize("NFC",lyrics)
    lyric_words=re.findall(r"[가-힣]+",text)
    aligned_words=candidate["words"]
    if len(lyric_words)!=len(aligned_words):
        raise AlignmentError("MFA word count differs from exact lyrics; singing repeats/adlibs need manually reviewed segments")
    expected=hangul_parts(lyrics)
    items=[];j=0
    for word, aw in zip(lyric_words,aligned_words):
        if word!=unicodedata.normalize("NFC",aw["symbol"]):
            raise AlignmentError("MFA word identity differs from exact lyric text")
        a,b=aw["start"],aw["end"]
        observed=[p for p in candidate["phones"] if p["start"]>=a-.001 and p["end"]<=b+.001]
        nuclei=[i for i,p in enumerate(observed) if p["slotCandidate"]=="vowel"]
        if len(nuclei)!=len(word):
            raise AlignmentError(f"MFA vowel nucleus count mismatch in {word!r}; human review required")
        boundaries=[a]
        for left,right in zip(nuclei[:-1],nuclei[1:]):
            between=observed[left+1:right]
            consonant_start=between[0]["start"] if between else (observed[left]["end"]+observed[right]["start"])/2
            boundaries.append(float(consonant_start))
        boundaries.append(b)
        for k,glyph in enumerate(word):
            start,end=boundaries[k],boundaries[k+1]
            if not end>start+.002:raise AlignmentError("MFA projected syllable duration invalid")
            sub=[]
            for p in observed:
                midpoint=(p["start"]+p["end"])*.5
                if not start<=midpoint<end and not (k==len(word)-1 and midpoint<=end):
                    continue
                lo=max(start,p["start"]);hi=min(end,p["end"])
                if hi-lo<.002:continue
                slot=p["slotCandidate"]
                if slot=="onset" and sub and any(x["slot"]=="vowel" for x in sub):
                    slot="coda"
                canonical=p.get("canonicalCandidate")
                sub.append({"start":lo,"end":hi,"slot":slot,
                            "symbol":canonical or p["symbol"],"ipaOriginal":p["symbol"],
                            "source":"mfa_candidate"})
            if not sub:raise AlignmentError("MFA projection produced empty syllable")
            # Consistency check with script: no invented phone nucleus if absent.
            if not any(p["slot"]=="vowel" for p in sub):
                raise AlignmentError("MFA syllable has no vowel; manual review necessary")
            items.append({"glyph":glyph,"start":start,"end":end,
                          "source":"mfa_candidate","phones":sub})
            j+=1
    if j!=len(expected):raise AlignmentError("Mismatch in projected Hangul count")
    payload={"schema":SCHEMA,"source":"mfa_candidate","reviewedByHuman":False,
             "lyricsSHA256":sha256_text(lyrics),"syllables":items,
             "mappingMethod":"MFA acoustic-phone intervals + syllable nucleus heuristic, NOT verified",}
    validate_phone_alignment(payload,lyrics,duration)
    return payload
