"""Source-bound lyrics and trainable contextual UTF-8 encoder (no external LLM).

Byte tokens are a lossless vocabulary, NOT a claim to understand language.
Meaning must be learned from varied paired performances/context annotations.
No word timing is invented by dividing a sentence into equal intervals.
"""
from __future__ import annotations
import hashlib
import json
import math
import unicodedata
from pathlib import Path
import torch
from torch import nn

MAX_BYTES = 1024
VOCAB_SIZE = 259  # pad=0, UTF8 byte+1, missing=257, masked=258


def encode_text(text: str) -> torch.Tensor:
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Nonempty lyrics required")
    raw = unicodedata.normalize("NFC", text).encode("utf-8")
    if len(raw) > MAX_BYTES:
        raise ValueError("Context exceeds 1024 UTF-8 bytes; supply a reviewed verse/context window")
    return torch.tensor([b + 1 for b in raw], dtype=torch.long)


def read_lyrics(path: Path, vocal_sha: str, last_frame: float) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if (data.get("schemaVersion") != 1 or data.get("vocalSha256") != vocal_sha
            or len(vocal_sha) != 64 or any(c not in "0123456789abcdef" for c in vocal_sha)):
        raise ValueError("Lyrics must belong to the exact source vocal SHA256")
    if data.get("timeBase") != "vocal_file_seconds":
        raise ValueError("Lyrics must use the source vocal clock")
    if data.get("transcriptSource") not in ("human_reviewed", "official_corpus_statement"):
        raise ValueError("Verified transcript source required")
    if not isinstance(data.get("source"), str) or not data["source"].strip():
        raise ValueError("Transcript provenance required")
    duration = data.get("durationSeconds")
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= last_frame:
        raise ValueError("Lyrics duration does not cover source video frames")
    text = unicodedata.normalize("NFC", data.get("text", ""))
    encode_text(text)
    words = data.get("words", [])
    if words and data.get("alignmentMethod") != "human_reviewed_word_intervals":
        raise ValueError("Exact word timing needs human-reviewed intervals")
    previous = 0.
    for word in words:
        start, end = word.get("startSeconds"), word.get("endSeconds")
        begin, finish = word.get("charStart"), word.get("charEnd")
        if (not isinstance(start, (int,float)) or not isinstance(end, (int,float))
                or not math.isfinite(start) or not math.isfinite(end)
                or not 0 <= previous <= start < end <= duration
                or type(begin) is not int or type(finish) is not int
                or not 0 <= begin < finish <= len(text)
                or text[begin:finish] != word.get("text")):
            raise ValueError("Invalid source word time or character interval")
        previous = end
    # Optional human contextual affect: valence, arousal, tension, warmth.
    # Annotations describe portrayed expression, not a person's internal state.
    for row in data.get("expressionIntervals", []):
        vals = row.get("values", [])
        if (data.get("expressionSource") != "human_reviewed_context"
                or len(vals) != 4 or not all(isinstance(x,(int,float)) and math.isfinite(x) and -1 <= x <= 1 for x in vals)
                or not 0 <= row.get("startSeconds", -1) < row.get("endSeconds", -1) <= duration):
            raise ValueError("Invalid reviewed contextual expression target")
    return {**data, "text": text}


def text_at_times(document: dict, times) -> tuple:
    text = document["text"]
    tokens = encode_text(text)
    active = torch.zeros(len(times), len(tokens), dtype=torch.bool)
    affect = torch.zeros(len(times), 4)
    valid = torch.zeros(len(times), dtype=torch.bool)
    for i, time in enumerate(times):
        for word in document.get("words", []):
            if word["startSeconds"] <= time < word["endSeconds"]:
                begin = len(text[:word["charStart"]].encode("utf-8"))
                end = len(text[:word["charEnd"]].encode("utf-8"))
                active[i, begin:end] = True
        for row in document.get("expressionIntervals", []):
            if row["startSeconds"] <= time < row["endSeconds"]:
                if valid[i]:
                    raise ValueError("Overlapping contextual expression intervals")
                affect[i] = torch.tensor(row["values"])
                valid[i] = True
    # No reviewed word interval => global context only, active remains false.
    return tokens, active, affect, valid


class LyricContextEncoder(nn.Module):
    def __init__(self, width=64):
        super().__init__()
        self.embedding = nn.Embedding(VOCAB_SIZE, width, padding_idx=0)
        self.position = nn.Embedding(MAX_BYTES, width)
        layer = nn.TransformerEncoderLayer(width, 4, width*3, dropout=0., batch_first=True)
        self.transformer = nn.TransformerEncoder(layer, 2, enable_nested_tensor=False)
        self.query = nn.Linear(width, width)
        self.attention = nn.MultiheadAttention(width, 4, dropout=0., batch_first=True)
        self.combine = nn.Sequential(nn.Linear(width*3, width), nn.GELU())
        self.language_head = nn.Linear(width, VOCAB_SIZE)

    def forward(self, tokens, active, audio_context):
        if (tokens.ndim != 2 or tokens.shape[1] > MAX_BYTES or tokens.dtype != torch.long
                or active.shape != (*audio_context.shape[:2], tokens.shape[1])
                or audio_context.shape[0] != tokens.shape[0]
                or not ((tokens > 0).any(dim=1)).all()
                or int(tokens.min()) < 0 or int(tokens.max()) >= VOCAB_SIZE):
            raise ValueError("Invalid contextual token/audio/word alignment shapes")
        padding = tokens == 0
        if (active & padding[:,None,:]).any():
            raise ValueError("Active word may not point to padding")
        h = self.embedding(tokens) + self.position(torch.arange(tokens.shape[1],device=tokens.device))[None]
        h = self.transformer(h, src_key_padding_mask=padding)
        visible = (~padding).to(h.dtype)
        global_context = (h * visible[...,None]).sum(1) / visible.sum(1,keepdim=True)
        weights = active.to(h.dtype)
        local = torch.einsum('btl,bld->btd', weights, h) / weights.sum(-1,keepdim=True).clamp_min(1.)
        attended,_ = self.attention(self.query(audio_context),h,h,key_padding_mask=padding,need_weights=False)
        global_context = global_context[:,None].expand(-1,audio_context.shape[1],-1)
        return self.combine(torch.cat((global_context,local,attended),dim=-1)), h

    def masked_language_loss(self, tokens):
        """Optional self-supervision; reconstruction alone does not prove semantics."""
        selected = (torch.rand(tokens.shape,device=tokens.device)<.15) & (tokens>0) & (tokens<=256)
        if not selected.any():
            return self.embedding.weight.sum()*0.
        hidden=tokens.clone(); hidden[selected]=258
        h=self.embedding(hidden)+self.position(torch.arange(tokens.shape[1],device=tokens.device))[None]
        h=self.transformer(h,src_key_padding_mask=tokens==0)
        return nn.functional.cross_entropy(self.language_head(h)[selected],tokens[selected])


def lexical_chunks(text):
    """Reuse the independently trained v15 lexical module over ALL word chunks."""
    from .word_feelings_v15 import encode_phrase, MAX_WORDS
    words=text.split()
    if not words: raise ValueError("Nonempty lexical context required")
    encoded=[encode_phrase(' '.join(words[i:i+MAX_WORDS])) for i in range(0,len(words),MAX_WORDS)]
    return torch.stack([x[0] for x in encoded]),torch.stack([x[1] for x in encoded])
