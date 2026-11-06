"""RAVDESS licensed research-only masked-mouth retraining (ephemeral weights).

No third-party video generation APIs, no content publication and no commercial
customer rendering. The original RAVDESS license is CC BY-NC-SA 4.0.
"""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from .external_ravdess_research import (
    ORIGINAL_MD5, RECORD_URL, download_public_archive,
    prepare_external_research_assets, select_research_clips,
)
from .masked_retrain import MASKED_MODEL_VERSION, masked_retrain
from .real_training import prepare_manifest


def research_retrain(epochs: int = 5):
    if not 1 <= epochs <= 12:
        raise ValueError("RAVDESS one-shot experiment limits epochs to 1..12")
    with tempfile.TemporaryDirectory(prefix="song-v2-ravdess-noncommercial-") as td:
        root = Path(td)
        archive = root / "research-source.zip"
        md5 = download_public_archive(archive)
        if md5 != ORIGINAL_MD5:
            raise RuntimeError("Original Zenodo checksum mismatch")
        files = select_research_clips(archive, root)
        manifest = prepare_external_research_assets(files, root)
        dataset = root / "consent-derived-research-only"
        prepared = prepare_manifest(manifest, dataset)
        checkpoint = root / "ephemeral-masked-v2.pt"
        report = masked_retrain(dataset, checkpoint, epochs=epochs, batch_size=8,
                                lr=.0003, seed=42, device="cpu")
        best = report["bestMetrics"]
        result = {
            "experiment": "song_vision_masked_reference_retrain",
            "dataset": "RAVDESS Actor_01 - two independent recordings, same singer and words",
            "zenodoRecord": RECORD_URL,
            "license": "CC-BY-NC-SA-4.0",
            "commercialUseAllowed": False,
            "sourceMd5Verified": True,
            "modelVersion": MASKED_MODEL_VERSION,
            "epochsRequested": epochs,
            "epochsCompleted": len(report["history"]),
            "trainFrames": report["trainFrames"],
            "valFrames": report["valFrames"],
            "bestEpoch": report["bestEpoch"],
            "bestValMaskedMAE": best["valMaskedMAE"],
            "copyReferenceMaskedMAE": best["copyReferenceMaskedMAE"],
            "maskedInputMAE": best["maskedInputMAE"],
            "audioSensitivity": best["audioSensitivity"],
            "correctVsShuffledMAEGain": best["correctVsShuffledMAEGain"],
            "diagnosticFlags": report["diagnosticFlags"],
            "validationType": "same singer, same sentence, separate take; no speaker generalization",
            "metricsComparableToV1": False,
            "qualityValidated": False,
            "customerFaceSwapValidated": False,
            "commercialJobReady": False,
            "weightsPublished": False,
            "mediaPublished": False,
            "originalMediaDeletedWithTemporaryRunner": True,
            "checkpointDeletedWithTemporaryRunner": True,
        }
        print("SONG_RAVDESS_MASKED_RETRAIN_RESULT=" +
              json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        return result


def main():
    parser = argparse.ArgumentParser(description="Noncommercial RAVDESS re-training; no published weights")
    parser.add_argument("--acknowledge-noncommercial-research", action="store_true")
    parser.add_argument("--epochs", type=int, default=5)
    args = parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error("RAVDESS data are noncommercial; explicitly acknowledge research-only use")
    research_retrain(epochs=args.epochs)


if __name__ == "__main__":
    main()
