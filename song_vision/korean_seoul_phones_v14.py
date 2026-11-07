"""SONG research-only Korean phoneme supervision from the REAL Seoul Corpus.

The Seoul Corpus (OpenSLR SLR113) has hand-corrected Korean phoneme
boundaries and corresponding genuine audio, unlike an ASR-generated guess.
This adapter maps ONLY published Seoul Corpus phone codes unambiguously to
the requested 13 consonants and 5 vowels. /ㅇ/ = coda /ng/; silent onset
ㅇ has no corresponding sound and is never invented.

The experiment trains only the v13 articulation acoustics encoder and
phoneme classifier heads. There is NO Korean video here, NO face-muscle
training claim, NO audio synthesis, and NO commercial data use.
CC BY-NC 2.0; two data archives can total several gigabytes in CI.

Source https://www.openslr.org/113/
Source paper Yun et al. 2015 https://doi.org/10.13064/KSSS.2015.7.2.103
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import subprocess
import tarfile
import tempfile
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

from .core import audio_features, mel_window, SAMPLE_RATE
from .phoneme_targets_v13 import CONSONANTS, VOWELS

VERSION = "song-vision-seoul-hand-corrected-phones-v1"
BASE_URL = "https://openslr.trmal.net/resources/113"
# Exact codes as published in Yun et al., 2015, Table 3.
SEOUL_TO_KOREAN = {
    "k0": "ㄱ", "nn": "ㄴ", "t0": "ㄷ", "ll": "ㄹ",
    "mm": "ㅁ", "p0": "ㅂ", "s0": "ㅅ", "ng": "ㅇ",
    "c0": "ㅈ", "kh": "ㅋ", "th": "ㅌ", "ph": "ㅍ", "hh": "ㅎ",
    "aa": "ㅏ", "ii": "ㅣ", "uu": "ㅜ", "ee": "ㅔ", "oo": "ㅗ",
}
assert set(SEOUL_TO_KOREAN.values()) == set(CONSONANTS) | set(VOWELS)
MAX_PHONE_CLIPS_PER_CLASS = 250
SOURCE_TIMEOUT = 900


def _safe_download(url: str, output: Path, *, max_bytes: int) -> str:
    if output.exists():
        raise FileExistsError("Never overwrite verified Korean research source")
    if not url.startswith(BASE_URL + "/"):
        raise ValueError("Only the official Seoul Corpus archive location is accepted")
    digest = hashlib.sha256()
    count = 0
    with urllib.request.urlopen(urllib.request.Request(
            url, headers={"User-Agent":"SONG-Vision-academic-research/1.0"}),
            timeout=SOURCE_TIMEOUT) as response, output.open("xb") as f:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            count += len(block)
            if count > max_bytes:
                raise ValueError("Source archive exceeds safe research limit")
            digest.update(block)
            f.write(block)
    if count < 100_000:
        raise ValueError("Official Seoul Corpus archive seems incomplete")
    return digest.hexdigest()


def parse_long_textgrid(text: str) -> list[tuple[float, float, str]]:
    """Conservatively read phone tier of a valid Praat *long* TextGrid.

    If the archive uses an undocumented tier/format, do NOT fabricate labels:
    fail and inspect actual corpus. No orthography-to-phone shortcuts.
    """
    if not isinstance(text, str) or "TextGrid" not in text:
        raise ValueError("Not a Praat TextGrid")
    tiers = re.split(r"(?m)^\s*item\s*\[\d+\]:\s*$", text)
    selected = []
    for tier in tiers:
        m = re.search(r'(?m)^\s*name\s*=\s*"([^"]+)"', tier)
        if m and m.group(1).strip().lower() in ("phoneme", "phon", "phones"):
            selected.append(tier)
    if len(selected) != 1:
        raise ValueError("Missing/ambiguous phoneme tier in original Seoul Corpus TextGrid")
    intervals = re.split(r"(?m)^\s*intervals\s*\[\d+\]:\s*$", selected[0])[1:]
    if not intervals:
        raise ValueError("Phoneme tier has no labelled intervals")
    result = []
    prev_end = None
    for block in intervals:
        start = re.search(r"(?m)^\s*xmin\s*=\s*([0-9.eE+-]+)\s*$", block)
        end = re.search(r"(?m)^\s*xmax\s*=\s*([0-9.eE+-]+)\s*$", block)
        label = re.search(r'(?m)^\s*text\s*=\s*"([^"]*)"', block)
        if not (start and end and label):
            raise ValueError("Corrupt phoneme interval in actual TextGrid")
        a, b = float(start.group(1)), float(end.group(1))
        if not (math.isfinite(a) and math.isfinite(b) and 0 <= a < b):
            raise ValueError("Invalid Seoul Corpus phone timestamp")
        if prev_end is not None and a < prev_end - .002:
            raise ValueError("Overlapping Seoul Corpus phoneme intervals")
        result.append((a, b, label.group(1).strip()))
        prev_end = b
    return result


def _group_speaker(name: str) -> str | None:
    match = re.search(r"(?i)(?:^|[/_-])s(\d{2})(?:[/_.-]|$)", name)
    return f"s{match.group(1)}" if match else None


def _member_basename(name: str) -> str:
    return Path(name).stem.lower()


def _collect_labels(label_archive: Path) -> dict[str, dict]:
    candidates = {}
    with tarfile.open(label_archive, mode="r:gz") as archive:
        for member in archive:
            if not member.isfile() or not member.name.lower().endswith(".textgrid"):
                continue
            if member.size > 4 * 1024 * 1024:
                raise ValueError("Label file unexpectedly large")
            speaker = _group_speaker(member.name)
            if speaker is None:
                continue
            basename = _member_basename(member.name)
            if basename in candidates:
                raise ValueError("Ambiguous Seoul Corpus label basename")
            raw = archive.extractfile(member).read()
            try:
                label = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                label = raw.decode("utf-16")
            try:
                intervals = parse_long_textgrid(label)
            except ValueError:
                # Fail only if no valid labels exist. Some original auxiliary
                # TextGrids may not have the specific phone tier.
                continue
            valid = [(start, end, SEOUL_TO_KOREAN.get(code))
                     for start, end, code in intervals if code in SEOUL_TO_KOREAN]
            if len(valid) >= 25:
                candidates[basename] = {"speaker": speaker, "phones": valid}
    speakers = {item["speaker"] for item in candidates.values()}
    if len(speakers) < 3:
        raise ValueError("Need at least 3 actual speakers with verified phoneme labels")
    return candidates


def _choose_audio_members(sound_archive: Path, labels: dict, *, max_files=6):
    speakers = defaultdict(list)
    with tarfile.open(sound_archive, mode="r:gz") as archive:
        for member in archive:
            if member.isfile() and member.name.lower().endswith(".flac"):
                key = _member_basename(member.name)
                if key in labels and labels[key]["speaker"] == _group_speaker(member.name):
                    speakers[labels[key]["speaker"]].append(member.name)
    if len(speakers) < 3:
        raise ValueError("Seoul Corpus recorded audio does not match annotated speakers")
    candidates = sorted(speakers)
    chosen = []
    for speaker in candidates[:3]:
        for name in sorted(speakers[speaker])[:2]:
            chosen.append(name)
    if len(chosen) < 3 or len(chosen) > max_files:
        raise ValueError("Invalid independent-speaker research audio split")
    return chosen


class PhonemeWindows(Dataset):
    def __init__(self, rows):
        if not rows:
            raise ValueError("Empty real Korean phoneme training set")
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        mel, second, phone = self.rows[idx]
        return (torch.from_numpy(mel_window(mel, second)),
                torch.tensor(CONSONANTS.index(phone) if phone in CONSONANTS else -100,
                             dtype=torch.long),
                torch.tensor(VOWELS.index(phone) if phone in VOWELS else -100,
                             dtype=torch.long))


class KoreanPhoneNet(nn.Module):
    """Only the independently trainable articulation branch from v13."""
    def __init__(self):
        super().__init__()
        # Use the *same layer names and shapes* for direct v13 initialization.
        from .staged_face_v13 import StagedSingingFaceNet
        reference = StagedSingingFaceNet()
        self.articulation_encoder = reference.articulation_encoder
        self.consonant_head = reference.consonant_head
        self.vowel_head = reference.vowel_head

    def forward(self, mel):
        hidden = self.articulation_encoder(mel)
        return self.consonant_head(hidden), self.vowel_head(hidden)


def _accuracy(model, loader):
    model.eval()
    totals = {"c":0,"v":0,"c_hit":0,"v_hit":0}
    with torch.no_grad():
        for mel, consonant, vowel in loader:
            logits_c, logits_v = model(mel)
            for label, logits, key in (
                (consonant, logits_c, "c"), (vowel, logits_v, "v")):
                keep = label >= 0
                totals[key] += int(keep.sum())
                totals[f"{key}_hit"] += int((logits[keep].argmax(dim=-1) == label[keep]).sum())
    return {
        "consonantFrames": totals["c"],
        "vowelFrames": totals["v"],
        "consonantAccuracy": round(totals["c_hit"]/totals["c"],5) if totals["c"] else None,
        "vowelAccuracy": round(totals["v_hit"]/totals["v"],5) if totals["v"] else None,
    }


def _phone_loss(model, mel, consonant, vowel):
    logits_c, logits_v = model(mel)
    parts = []
    for logits, label in ((logits_c, consonant),(logits_v, vowel)):
        present = label >= 0
        if present.any():
            parts.append(nn.functional.cross_entropy(logits[present], label[present]))
    if not parts:
        raise ValueError("No human-corrected phonetic training data")
    return torch.stack(parts).mean()


def train_korean_phones(train_rows, holdout_rows, checkpoint: Path, epochs: int = 6) -> dict:
    if not 1 <= epochs <= 30 or checkpoint.exists():
        raise ValueError("Invalid epochs or checkpoint exists")
    torch.set_num_threads(min(torch.get_num_threads(), 2))
    torch.manual_seed(42)
    train=DataLoader(PhonemeWindows(train_rows),batch_size=32,shuffle=True)
    val=DataLoader(PhonemeWindows(holdout_rows),batch_size=32)
    net=KoreanPhoneNet()
    opt=torch.optim.AdamW(net.parameters(),lr=.0003)
    best=-1.
    history=[]
    for ep in range(1,epochs+1):
        net.train()
        weighted=0.
        n=0
        for mel,c,v in train:
            loss=_phone_loss(net,mel,c,v)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(),1.)
            opt.step()
            weighted+=float(loss.detach())*len(mel)
            n+=len(mel)
        scores=_accuracy(net,val)
        if scores["consonantFrames"] < 10 or scores["vowelFrames"] < 10:
            raise ValueError("Held-out speaker lacks phonetic class observations")
        scores["epoch"]=ep
        scores["trainLoss"]=round(weighted/n,7)
        history.append(scores)
        print("SONG_REAL_KOREAN_PHONE_EPOCH="+json.dumps(scores),flush=True)
        rank=(scores["consonantAccuracy"]+scores["vowelAccuracy"])/2
        if rank>best:
            best=rank
            checkpoint.parent.mkdir(parents=True,exist_ok=True)
            torch.save({
                "modelVersion":VERSION,
                "consonants":CONSONANTS,"vowels":VOWELS,
                "stateDict":{k:v.detach().cpu() for k,v in net.state_dict().items()},
                "epoch":ep,
                "status":"research_only_hand_corrected_Korean_speech_phonemes",
                "sourceLicense":"CC-BY-NC-2.0",
                "commerciallyValidated":False,
            },checkpoint)
    report={
        "modelVersion":VERSION,
        "status":"speech_only_Korean_phone_supervision_NO_singing_video",
        "trainingFrames":len(train_rows),
        "independentSpeakerHoldoutFrames":len(holdout_rows),
        "bestHeldoutMeanAccuracy":best,
        "bestValidation":max(history,key=lambda s:(s["consonantAccuracy"]+s["vowelAccuracy"])/2),
        "history":history,"sourceLicense":"CC-BY-NC-2.0",
        "actualSingingPhonemeAccuracyProven":False,
        "faceVideoLearnedFromKoreanSpeech":False,
        "commercialUseAllowed":False,
        "checkpointSha256":hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
    }
    checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report


def _resample_file(wav_file: Path, seconds: int) -> np.ndarray:
    if not 30 <= seconds <= 240:
        raise ValueError("Invalid research sample duration")
    out=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error",
                        "-i",str(wav_file),"-t",str(seconds),
                        "-vn","-ac","1","-ar","16000","-f","s16le","-"],
                       check=True,capture_output=True)
    if not out.stdout:
        raise ValueError("Empty official Korean speech recording")
    return np.frombuffer(out.stdout,dtype="<i2").astype(np.float32)/32768.


def research_seoul(root: Path, *, limit_seconds: int = 150,
                   download: bool = True, epochs: int = 6) -> dict:
    """Download/extract official archive, train on two speakers, test third."""
    root.mkdir(parents=True,exist_ok=True)
    checksums={}
    label_tar=root/"label.tgz"
    sound_tar=root/"sound.tgz"
    if download:
        checksums["labelArchiveSha256"]=_safe_download(
            BASE_URL+"/label.tgz",label_tar,max_bytes=120*1024*1024)
        checksums["soundArchiveSha256"]=_safe_download(
            BASE_URL+"/sound.tgz",sound_tar,max_bytes=4*1024**3)
    labels=_collect_labels(label_tar)
    selected=_choose_audio_members(sound_tar,labels)
    chosen_speakers=sorted({labels[_member_basename(name)]["speaker"] for name in selected})
    if len(chosen_speakers)!=3:
        raise ValueError("Need exactly 3 independent Korean talkers")
    training_speakers=set(chosen_speakers[:2])
    holdout_speaker=chosen_speakers[2]
    train_rows,holdout_rows=[],[]
    counts=defaultdict(Counter)
    chosen_names=set(selected)
    with tarfile.open(sound_tar,mode="r:gz") as tar:
        for member in tar:
            if not member.isfile() or member.name not in chosen_names:
                continue
            key=_member_basename(member.name)
            speaker=labels[key]["speaker"]
            if member.size>300*1024*1024:
                raise ValueError("Single source audio unexpectedly big")
            sample=root/(key+".flac")
            with sample.open("xb") as f:
                infile=tar.extractfile(member)
                import shutil
                shutil.copyfileobj(infile,f,length=1024*1024)
            wave=_resample_file(sample,limit_seconds)
            sample.unlink()
            mel=audio_features(wave)
            examples=defaultdict(list)
            for start,end,phone in labels[key]["phones"]:
                if start >= len(wave)/SAMPLE_RATE or end-start < .02:
                    continue
                mid=(start+min(end,len(wave)/SAMPLE_RATE))*.5
                if mid >=len(wave)/SAMPLE_RATE:
                    continue
                # Audio around labelled phone centre, never fabricate new labels.
                examples[phone].append((mel,mid,phone))
            target= train_rows if speaker in training_speakers else holdout_rows
            for phone,examples_for_phone in sorted(examples.items()):
                quota=max(0,MAX_PHONE_CLIPS_PER_CLASS-counts[speaker][phone])
                selected_rows=examples_for_phone[:quota]
                target.extend(selected_rows)
                counts[speaker][phone]+=len(selected_rows)
    if len(train_rows)<100 or len(holdout_rows)<50:
        raise ValueError("Actual hand-corrected Korean audio samples insufficient")
    checkpoint=root/"korean-phone-only.pt"
    report=train_korean_phones(train_rows,holdout_rows,checkpoint,epochs=epochs)
    report.update({
        "source":"OpenSLR 113 - Seoul Corpus, human-corrected phoneme TextGrid",
        "paper":"Yun et al. 2015, 10.13064/KSSS.2015.7.2.103",
        "sourceChecksums":checksums,
        "trainingSpeakers":sorted(training_speakers),
        "independentValidationSpeaker":holdout_speaker,
        "mappedConsonantClasses":list(CONSONANTS),
        "mappedVowelClasses":list(VOWELS),
        "unmappedPhonemesSilentlyInvented":False,
        "sourceFileNames": [Path(n).name for n in selected],
        "trainingClassCounts": {
            k:dict(v) for k,v in counts.items()
        },
    })
    checkpoint.with_suffix(".report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report


def run_seoul_encrypted(public_key: Path, vault_dir: Path, epochs: int = 6) -> dict:
    from .seoul_research_vault_v14 import seal_seoul
    if not public_key.is_file():
        raise FileNotFoundError("Existing research owner public key is required")
    if vault_dir.exists() and any(vault_dir.iterdir()):
        raise FileExistsError("Never overwrite past Korean phone research weights")
    with tempfile.TemporaryDirectory(prefix="song-seoul-phones-private-") as td:
        folder=Path(td)
        report=research_seoul(folder,epochs=epochs)
        import os
        run=os.getenv("GITHUB_RUN_ID","operator")
        attempt=os.getenv("GITHUB_RUN_ATTEMPT","1")
        name=f"song-seoul-korean-phones-{run}-a{attempt}.svault"
        encrypted=seal_seoul(
            folder/"korean-phone-only.pt",
            folder/"korean-phone-only.report.json",
            public_key,vault_dir/name,
            run=f"{run}-attempt-{attempt}")
        summary={
            "study":"SeoulCorpusHandCorrectedRealKoreanPhonemes",
            "source":"https://www.openslr.org/113/",
            "license":"CC-BY-NC-2.0",
            "actualSpeechAudioAndPhoneTimestampsUsed":True,
            "realKoreanSingerVideoUsed":False,
            "trainSpeakers":report["trainingSpeakers"],
            "heldoutSpeaker":report["independentValidationSpeaker"],
            "trainingPhoneFrames":report["trainingFrames"],
            "heldoutPhoneFrames":report["independentSpeakerHoldoutFrames"],
            "bestHeldoutValidation":report["bestValidation"],
            "sourceChecksums":report["sourceChecksums"],
            "encryptedCheckpoint":name,
            "encryptedSha256":encrypted["encryptedFileSha256"],
            "commercialUseAllowed":False,
            "canAcceptPaidJobs":False,
        }
        vault_dir.joinpath(name+".manifest.json").write_text(
            json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
        print("SONG_SEOUL_REAL_KOREAN_PHONEME_RESULT="+json.dumps(summary,ensure_ascii=False),
              flush=True)
        return summary


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--research-acknowledge-noncommercial",action="store_true")
    p.add_argument("--vault-public-key",type=Path,required=True)
    p.add_argument("--vault-output-dir",type=Path,required=True)
    p.add_argument("--epochs",type=int,default=6)
    args=p.parse_args()
    if not args.research_acknowledge_noncommercial:
        p.error("Seoul Corpus is licensed CC BY-NC 2.0, research only")
    run_seoul_encrypted(args.vault_public_key,args.vault_output_dir,epochs=args.epochs)


if __name__ == "__main__":
    main()
