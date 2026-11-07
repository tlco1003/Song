"""Separate cryptographic vault for Seoul Corpus, CC BY-NC 2.0 ONLY.

Never label Seoul Corpus as RAVDESS, or reuse a RAVDESS-specific license
notice. Uses owner X25519 public key with ephemeral ECDH + HKDF + AESGCM.
The private key is never supplied to training/GitHub Actions.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

FORMAT="SONG-SEOUL-CORPUS-NONCOMMERCIAL-VAULT-V1"
LICENSE="CC-BY-NC-2.0"
DATASET="SeoulCorpus-OpenSLR-113"
NOTICE=(
    "The Korean Corpus of Spontaneous Speech (Seoul Corpus; Yun et al., 2015)\n"
    "https://www.openslr.org/113/\n"
    "License CC BY-NC 2.0; NONCOMMERCIAL research use only.\n"
    "No singer-face / singing dataset and no rights for paid SONG services.\n"
)


def seal_seoul(checkpoint: Path, report_path: Path, public_key: Path,
               target: Path, *,run: str) -> dict:
    if target.exists():
        raise FileExistsError("Never replace prior Korean research model")
    if not (checkpoint.is_file() and report_path.is_file() and public_key.is_file()):
        raise FileNotFoundError("Study weights, source report, owner public key needed")
    if checkpoint.stat().st_size>50*1024**2 or report_path.stat().st_size>5*1024**2:
        raise ValueError("Unexpected Seoul Corpus study weights/report size")
    report=json.loads(report_path.read_text(encoding="utf-8"))
    if (report.get("modelVersion")!="song-vision-seoul-hand-corrected-phones-v1" or
            report.get("sourceLicense")!=LICENSE or
            report.get("commercialUseAllowed") is not False):
        raise ValueError("Only correctly attributed noncommercial Seoul phone studies permitted")
    pub=serialization.load_pem_public_key(public_key.read_bytes())
    if not isinstance(pub,X25519PublicKey):
        raise ValueError("Owner key must be X25519 public key")
    with io.BytesIO() as output:
        with zipfile.ZipFile(output,"w",compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("korean-phone-weights.pt",checkpoint.read_bytes())
            archive.writestr("research-report.json",report_path.read_bytes())
            archive.writestr("SEOUL_CORPUS_LICENSE.txt",NOTICE)
        payload=output.getvalue()
    eph=X25519PrivateKey.generate()
    salt=os.urandom(16)
    nonce=os.urandom(12)
    meta={"format":FORMAT,"dataset":DATASET,"license":LICENSE,
          "modelVersion":report["modelVersion"],"runId":run,
          "commercialUseAllowed":False,"source":"https://www.openslr.org/113/"}
    associated=json.dumps(meta,sort_keys=True,separators=(",",":")).encode()
    key=HKDF(algorithm=hashes.SHA256(),length=32,salt=salt,
             info=b"song-seoul-corpus-v1-research-only").derive(eph.exchange(pub))
    ciphertext=AESGCM(key).encrypt(nonce,payload,associated)
    def enc(v):return base64.b64encode(v).decode("ascii")
    envelope={
        "metadata":meta,
        "ephemeralPublicKeyBase64":enc(eph.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,format=serialization.PublicFormat.Raw)),
        "saltBase64":enc(salt),"nonceBase64":enc(nonce),
        "ciphertextBase64":enc(ciphertext),
        "ciphertextSha256":hashlib.sha256(ciphertext).hexdigest(),
    }
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open("x",encoding="utf-8") as stream:
        json.dump(envelope,stream,sort_keys=True,separators=(",",":"))
    return {"encryptedFile":target.name,
            "encryptedFileSha256":hashlib.sha256(target.read_bytes()).hexdigest(),
            "license":LICENSE,"source":DATASET,"commercialUseAllowed":False}
