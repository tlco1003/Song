"""Dedicated owner-encrypted v15 research model archive with correct provenance.

RAVDESS CC BY-NC-SA 4.0 and Korean emotion terms community digitization
(CC0 listed by republisher, original academic research copyright) are
DIFFERENT sources. Neither authorizes the SONG commercial face service by
default. No private key, raw words from a licensed corpus or customer media
enters the public research model branch.
"""
from __future__ import annotations
import base64
import hashlib
import io
import json
import os
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey,X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SOURCES={
    "RAVDESS-AND-KOREAN-WORD-NORMS-CONTEXTUAL-V16":{
        "license":"RAVDESS-CC-BY-NC-SA-4.0-AND-WORD-NORM-NSMC-RIGHTS-UNVERIFIED",
        "urls":["https://zenodo.org/records/1188976",
                "https://huggingface.co/datasets/jonghwanhyeon/korean-emotion-lexicon",
                "https://huggingface.co/datasets/e9t/nsmc"]},
    "RAVDESS-FACE-120":{
        "license":"CC-BY-NC-SA-4.0",
        "url":"https://zenodo.org/records/1188976"},
    "KOREAN-EMOTION-WORD-RATINGS":{
        "license":"COMMUNITY-CC0-ORIGINAL-PAPER-RIGHTS-UNVERIFIED",
        "url":"https://huggingface.co/datasets/jonghwanhyeon/korean-emotion-lexicon"},
}
FORMAT="SONG-RESEARCH-MODEL-VAULT-V15"


def seal_study_model(model:Path,report_file:Path,owner_public:Path,
                     out_file:Path,*,dataset:str,run_id:str)->dict:
    if dataset not in SOURCES or not isinstance(run_id,str) or len(run_id)>80:
        raise ValueError("Unknown or ambiguous source dataset/run")
    if out_file.exists():
        raise FileExistsError("Never overwrite older research models")
    if not model.is_file() or not report_file.is_file() or not owner_public.is_file():
        raise FileNotFoundError("Model, transparent quality report and public key required")
    if model.stat().st_size>80*1024*1024 or report_file.stat().st_size>5*1024*1024:
        raise ValueError("Research payload exceeds protected size limit")
    report=json.loads(report_file.read_text(encoding="utf-8"))
    if (report.get("status")!="research_only_not_lipsync_validated"
            or report.get("canAcceptPaidJobs") is not False):
        raise ValueError("Only unvalidated noncommercial research results can be archived")
    public=serialization.load_pem_public_key(owner_public.read_bytes())
    if not isinstance(public,X25519PublicKey):
        raise ValueError("X25519 owner public key required; no private keys in CI")
    meta={
        "format":FORMAT,"dataset":dataset,"source":SOURCES[dataset],
        "modelVersion":report["modelVersion"],"runId":run_id,
        "commercialUseAllowed":False,"privateOriginalMediaIncluded":False,
    }
    associated=json.dumps(meta,sort_keys=True,separators=(",",":")).encode()
    with io.BytesIO() as stream:
        with zipfile.ZipFile(stream,"w",zipfile.ZIP_DEFLATED) as zipout:
            zipout.writestr("research-model.pt",model.read_bytes())
            zipout.writestr("training-report.json",report_file.read_bytes())
            zipout.writestr("LICENSE_AND_SCOPE.txt",json.dumps(
                {"source":SOURCES[dataset],"researchOnly":True,
                 "wordNormsAreNotPsychologicalDiagnosis":True,
                 "commercialRightsForOriginalSourceUnverified":dataset in ("KOREAN-EMOTION-WORD-RATINGS","RAVDESS-AND-KOREAN-WORD-NORMS-CONTEXTUAL-V16")},
                indent=2,ensure_ascii=False))
        contents=stream.getvalue()
    ephemeral=X25519PrivateKey.generate()
    salt,nonce=os.urandom(16),os.urandom(12)
    key=HKDF(algorithm=hashes.SHA256(),length=32,salt=salt,
             info=b"song-user-owned-research-v15").derive(ephemeral.exchange(public))
    cipher=AESGCM(key).encrypt(nonce,contents,associated)
    def b64(b):return base64.b64encode(b).decode("ascii")
    envelope={
        "metadata":meta,
        "ephemeralPublicKey":b64(ephemeral.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,format=serialization.PublicFormat.Raw)),
        "salt":b64(salt),"nonce":b64(nonce),"encryptedData":b64(cipher),
        "cipherSha256":hashlib.sha256(cipher).hexdigest(),
    }
    out_file.parent.mkdir(parents=True,exist_ok=True)
    with out_file.open("x",encoding="utf-8") as f:
        json.dump(envelope,f,ensure_ascii=False,sort_keys=True,separators=(",",":"))
    return {"file":out_file.name,"sha256":hashlib.sha256(out_file.read_bytes()).hexdigest(),
            "sourceDataset":dataset,"provenance":SOURCES[dataset],
            "commercialUseAllowed":False}
