"""Encrypt SONG-Vision RESEARCH-ONLY model checkpoints for durable backup.

PUBLIC vault repository stores only authenticated ciphertext; the private key
must never be committed, printed, passed to CI, or sent to an external API.

Crypto: ephemeral X25519 -> HKDF-SHA256 -> AES-256-GCM, with authenticated
metadata. Never reuse keys/nonces. This does not grant commercial rights.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import zipfile
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey, X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

VAULT_FORMAT = "SONG-VISION-RESEARCH-VAULT-V1"
MAX_CHECKPOINT_BYTES = 85 * 1024 * 1024
MAX_REPORT_BYTES = 5 * 1024 * 1024
LICENSE_ID = "CC-BY-NC-SA-4.0"
KDF_INFO = b"song-vision-research-weights-encryption-v1"
NOTICE = (
    "RAVDESS (Livingstone & Russo, 2018) - licensed CC BY-NC-SA 4.0. "
    "NONCOMMERCIAL RESEARCH ONLY; no rights granted for SONG paid services. "
    "Source: https://zenodo.org/records/1188976\n"
)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.b64decode(data, validate=True)


def _make_key(shared_secret: bytes, salt: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32,
                salt=salt, info=KDF_INFO).derive(shared_secret)


def _validated_metadata(metadata: dict) -> dict:
    if not isinstance(metadata, dict):
        raise ValueError("Vault metadata object required")
    if metadata.get("license") != LICENSE_ID:
        raise ValueError("Research licensing tag must be CC-BY-NC-SA-4.0")
    if metadata.get("commercialUseAllowed") is not False:
        raise ValueError("Commercial use must be explicitly disabled")
    if metadata.get("dataset") != "RAVDESS-Actor-01":
        raise ValueError("Unsupported research dataset")
    if metadata.get("checkpointCategory") != "research_only_not_lipsync_validated":
        raise ValueError("Unvalidated noncommercial model category required")
    for key in ("githubRunId", "modelVersion"):
        value = metadata.get(key)
        if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,120}", value):
            raise ValueError(f"Invalid metadata field {key}")
    return metadata


def _archive(checkpoint: bytes, report: bytes) -> bytes:
    with io.BytesIO() as stream:
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            zf.writestr("research-model.pt", checkpoint)
            zf.writestr("training-report.json", report)
            zf.writestr("NONCOMMERCIAL_LICENSE_NOTICE.txt", NOTICE)
        return stream.getvalue()


def seal(checkpoint_path: Path, report_path: Path, public_key_path: Path,
         output_path: Path, metadata: dict) -> dict:
    """Encrypt only the trained weights + report (never faces, vocals, source video)."""
    metadata = _validated_metadata(metadata)
    if output_path.exists():
        raise FileExistsError("Immutable checkpoint backup already exists")
    if not checkpoint_path.is_file() or not report_path.is_file():
        raise FileNotFoundError("Checkpoint and paired report both required")
    if not 1024 <= checkpoint_path.stat().st_size <= MAX_CHECKPOINT_BYTES:
        raise ValueError("Research checkpoint exceeds permitted size")
    if not 16 <= report_path.stat().st_size <= MAX_REPORT_BYTES:
        raise ValueError("Research training report exceeds permitted size")
    report = report_path.read_bytes()
    decoded = json.loads(report)
    if decoded.get("canAcceptPaidJobs") is not False:
        raise ValueError("Refuse to archive checkpoint without fail-closed paid job gate")
    if decoded.get("status") != "research_only_not_lipsync_validated":
        raise ValueError("Checkpoint report must be research-only and not validated")
    checkpoint = checkpoint_path.read_bytes()
    payload = _archive(checkpoint, report)
    pk = serialization.load_pem_public_key(public_key_path.read_bytes())
    if not isinstance(pk, X25519PublicKey):
        raise ValueError("Expected X25519 research public key")
    ephemeral = X25519PrivateKey.generate()
    salt, nonce = os.urandom(16), os.urandom(12)
    symmetric_key = _make_key(ephemeral.exchange(pk), salt)
    associated = json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()
    ciphertext = AESGCM(symmetric_key).encrypt(nonce, payload, associated)
    from cryptography.hazmat.primitives import serialization as ser
    encoded_ephemeral = ephemeral.public_key().public_bytes(
        encoding=ser.Encoding.Raw, format=ser.PublicFormat.Raw)
    envelope = {
        "format": VAULT_FORMAT,
        "metadata": metadata,
        "ephemeralPublicKeyBase64": _b64(encoded_ephemeral),
        "saltBase64": _b64(salt),
        "nonceBase64": _b64(nonce),
        "ciphertextBase64": _b64(ciphertext),
        "ciphertextSha256": _sha256_bytes(ciphertext),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create: never clobber a previous run's checkpoint.
    with output_path.open("x", encoding="utf-8") as out:
        json.dump(envelope, out, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "format": VAULT_FORMAT,
        "encryptedFile": output_path.name,
        "encryptedFileSha256": _sha256_bytes(output_path.read_bytes()),
        "sourceCheckpointSha256": _sha256_bytes(checkpoint),
        "modelVersion": metadata["modelVersion"],
        "dataset": metadata["dataset"],
        "license": LICENSE_ID,
        "commercialUseAllowed": False,
        "keyRequiredForDecryption": True,
    }


def unseal(encrypted_path: Path, private_key_path: Path,
           output_directory: Path) -> dict:
    """Decrypt a local operator copy. Reject tampering and unsafe ZIP entries."""
    if output_directory.exists():
        raise FileExistsError("Refusing to overwrite existing restored model folder")
    if encrypted_path.stat().st_size > MAX_CHECKPOINT_BYTES * 2:
        raise ValueError("Encrypted checkpoint too large")
    envelope = json.loads(encrypted_path.read_text(encoding="utf-8"))
    if envelope.get("format") != VAULT_FORMAT:
        raise ValueError("Unsupported vault format")
    metadata = _validated_metadata(envelope["metadata"])
    private_key = serialization.load_pem_private_key(
        private_key_path.read_bytes(), password=None)
    if not isinstance(private_key, X25519PrivateKey):
        raise ValueError("Expected the matching X25519 PRIVATE key")
    peer_key = X25519PublicKey.from_public_bytes(
        _unb64(envelope["ephemeralPublicKeyBase64"]))
    salt = _unb64(envelope["saltBase64"])
    nonce = _unb64(envelope["nonceBase64"])
    ciphertext = _unb64(envelope["ciphertextBase64"])
    if len(nonce) != 12 or len(salt) != 16:
        raise ValueError("Malformed encryption parameters")
    if _sha256_bytes(ciphertext) != envelope["ciphertextSha256"]:
        raise ValueError("Encrypted payload hash mismatch")
    shared = private_key.exchange(peer_key)
    key = _make_key(shared, salt)
    associated = json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()
    # InvalidTag is raised for an incorrect key or tampered ciphertext.
    plain = AESGCM(key).decrypt(nonce, ciphertext, associated)
    output_directory.mkdir(parents=True, exist_ok=False)
    try:
        with zipfile.ZipFile(io.BytesIO(plain)) as zf:
            allowed = {"research-model.pt", "training-report.json",
                       "NONCOMMERCIAL_LICENSE_NOTICE.txt"}
            if set(zf.namelist()) != allowed:
                raise ValueError("Unexpected files in research vault")
            for filename in sorted(allowed):
                dest = output_directory / filename
                with dest.open("xb") as fp:
                    fp.write(zf.read(filename))
    except Exception:
        import shutil
        shutil.rmtree(output_directory)
        raise
    return {
        "restoredTo": str(output_directory),
        "modelVersion": metadata["modelVersion"],
        "license": LICENSE_ID,
        "commercialUseAllowed": False,
    }


def main():
    parser = argparse.ArgumentParser(description="SONG-Vision encrypted noncommercial checkpoint vault")
    sub = parser.add_subparsers(dest="command", required=True)
    enc = sub.add_parser("encrypt")
    enc.add_argument("--checkpoint", type=Path, required=True)
    enc.add_argument("--report", type=Path, required=True)
    enc.add_argument("--public-key", type=Path, required=True)
    enc.add_argument("--output", type=Path, required=True)
    enc.add_argument("--metadata", type=Path, required=True)
    dec = sub.add_parser("decrypt")
    dec.add_argument("--encrypted", type=Path, required=True)
    dec.add_argument("--private-key", type=Path, required=True)
    dec.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "encrypt":
        result = seal(args.checkpoint, args.report, args.public_key, args.output,
                      json.loads(args.metadata.read_text(encoding="utf-8")))
    else:
        result = unseal(args.encrypted, args.private_key, args.out_dir)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
