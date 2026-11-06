"""SONG-Vision v9: honest facial *surface* motion labels for singing.

Real-time visible landmarks only. The medial cheek region, jaw/chin
contour and lip opening are measured as camera-projected 2D coordinates
relative to the eye baseline; this is NOT X-ray/MRI craniofacial anatomy.

Optional 52 MediaPipe expression blendshape proxies complement landmarks.
All detector outputs are derived labels; no person's identity is predicted.

Official Face Landmarker https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

from .face_geometry import LocalFaceLandmarker

VERSION = "song-vision-face-surface-v1"
POINT_COUNT = 478
FEATURE_NAMES = (
    "lipGapEyeScaled",                 # inner upper and lower lip relative to eye span
    "mouthWidthEyeScaled",             # mouth-corner span
    "lowerLipVerticalToNose",          # projected lower lip, not internal jaw
    "chinVerticalToNose",              # jaw-lowering SURFACE proxy, not mandible position
    "leftCheekVerticalToEye",          # cheek tissue projected motion proxy
    "rightCheekVerticalToEye",
    "leftCheekHorizontalToNose",
    "rightCheekHorizontalToNose",
    "jawOpenBlendshape",               # Google expression model score [0,1]
    "cheekPuffBlendshape",
    "cheekSquintLeftBlendshape",
    "cheekSquintRightBlendshape",
)
# Geometric scales calibrate dimensionless motion magnitude, NOT medical mm.
FEATURE_SCALE = np.array(
    [.30, .35, .35, .40, .32, .32, .32, .32, .50, .50, .50, .50],
    dtype=np.float32,
)
EXPRESSION_EXTRAS = (
    "eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight", "browInnerUp", "browDownLeft", "browDownRight",
    "mouthClose", "mouthFunnel", "mouthPucker", "mouthPressLeft", "mouthPressRight",
    "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
    "noseSneerLeft", "noseSneerRight", "jawLeft", "jawRight",
    "mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight",
)
MIN_VALID_COVERAGE = .80
SCORE_NAMES = (
    "jawOpen", "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
)
# 205 / 425: front upper cheek surface vertices; 234 / 454 outer contour
# are part of the surface outline, NOT physical cheekbone landmarks.
VERTICES = {
    "eye_l_outer": 33, "eye_l_inner": 133,
    "eye_r_outer": 263, "eye_r_inner": 362,
    "nose_tip": 1, "upper_lip": 13, "lower_lip": 14,
    "mouth_l": 61, "mouth_r": 291, "chin": 152,
    "cheek_l": 205, "cheek_r": 425,
}


def measure_surface_feature_vector(landmarks, blendshapes: dict) -> np.ndarray:
    """12 surface measurements and expression proxies, without identifying bones."""
    pts = np.asarray(landmarks, dtype=np.float64)
    if pts.shape != (POINT_COUNT, 3) or not np.isfinite(pts).all():
        raise ValueError("Face Landmarker must return 478 finite 3D surface landmarks")
    if not isinstance(blendshapes, dict) or any(k not in blendshapes for k in SCORE_NAMES):
        raise ValueError("All jaw/cheek expression proxy scores required")
    scores = [float(blendshapes[k]) for k in SCORE_NAMES]
    if not all(np.isfinite(v) and 0 <= v <= 1 for v in scores):
        raise ValueError("Unreliable jaw/cheek blendshape score")
    xy = pts[:, :2]
    eye_l = (xy[33] + xy[133]) * .5
    eye_r = (xy[263] + xy[362]) * .5
    axis = eye_r - eye_l
    span = float(np.linalg.norm(axis))
    if not .08 <= span <= 1.5:
        raise ValueError("Interocular span too small or implausible")
    horizontal = axis / span
    vertical = np.array([-horizontal[1], horizontal[0]])
    if vertical[1] < 0:
        vertical = -vertical
    nose = xy[1]

    def along(p, origin, axis_unit):
        return float(np.dot(xy[p] - origin, axis_unit) / span)

    mouth = abs(along(291, xy[61], horizontal))
    gap = along(14, xy[13], vertical)
    if not .05 <= mouth <= 2 or not -.07 <= gap <= 1.1:
        raise ValueError("Implausible mouth geometry in face crop")
    values = np.array([
        max(0., gap), mouth,
        along(14, nose, vertical), along(152, nose, vertical),
        along(205, eye_l, vertical), along(425, eye_r, vertical),
        along(205, nose, horizontal), along(425, nose, horizontal),
        *scores,
    ], dtype=np.float32)
    if not np.isfinite(values).all() or np.max(np.abs(values[:8])) > 5.:
        raise ValueError("Out-of-range face projected geometry")
    return values


def _feature_file(directory: Path) -> Path:
    return directory / "face-surface-v1.npz"


def annotate_face_surface_dataset(dataset: Path, model_path: Path,
                                  min_coverage: float = MIN_VALID_COVERAGE,
                                  detector_factory=LocalFaceLandmarker) -> dict:
    """Detect real frame labels from allowed local research images.

    Refuse to fabricate missing detections. npz stores 478-point audit labels
    privately alongside training frames; caller must not upload this dataset.
    """
    if not .70 <= min_coverage <= 1.:
        raise ValueError("Invalid minimum face tracking coverage")
    if not model_path.is_file():
        raise FileNotFoundError("Install separately licensed offline MediaPipe task model")
    if not (dataset / "train").is_dir() or not (dataset / "val").is_dir():
        raise ValueError("Prepared train/val video frames required")
    counts = {"train": {"total": 0, "valid": 0}, "val": {"total": 0, "valid": 0}}
    with detector_factory(model_path, video=False) as detector:
        for split in ("train", "val"):
            entries = sorted((dataset / split).glob("*/index.json"))
            if not entries:
                raise ValueError("At least one clip per split required")
            for index_file in entries:
                folder = index_file.parent
                dest = _feature_file(folder)
                if dest.exists():
                    raise FileExistsError(f"Not overwriting previously annotated face labels: {dest}")
                records = json.loads(index_file.read_text(encoding="utf-8"))["frames"]
                if len(records) < 16:
                    raise ValueError("Insufficient prepared synchronized frames")
                valid = np.zeros(len(records), dtype=bool)
                observed = np.full((len(records), len(FEATURE_NAMES)), np.nan, dtype=np.float32)
                points = np.full((len(records), POINT_COUNT, 3), np.nan, dtype=np.float32)
                extras = np.full((len(records), len(EXPRESSION_EXTRAS)), np.nan, dtype=np.float32)
                for i, record in enumerate(records):
                    photo = cv2.imread(str(folder / "frames" / record["file"]))
                    if photo is None or photo.shape[:2] != (96, 96):
                        raise FileNotFoundError("A 96x96 prepared face frame is missing")
                    # Upscale the 96px *crop* for better input to 256px task;
                    # this adds NO image information and should be tested on
                    # full-resolution source before any real product use.
                    enlarged = cv2.resize(photo, (256, 256), interpolation=cv2.INTER_CUBIC)
                    result = detector.detect(enlarged)
                    if result is None:
                        continue
                    landmarks, shapes = result
                    try:
                        feat = measure_surface_feature_vector(landmarks, shapes)
                        if any(key not in shapes for key in EXPRESSION_EXTRAS):
                            raise ValueError("Incomplete face expression teacher labels")
                        expression = np.asarray([shapes[key] for key in EXPRESSION_EXTRAS],
                                                dtype=np.float32)
                        if not np.isfinite(expression).all() or np.any(expression < 0) or np.any(expression > 1):
                            raise ValueError("Unreliable face expression label")
                    except ValueError:
                        continue
                    observed[i] = feat
                    extras[i] = expression
                    points[i] = np.asarray(landmarks, dtype=np.float32)
                    valid[i] = True
                coverage = float(valid.mean())
                if coverage < min_coverage:
                    raise ValueError(
                        f"Face surface detector coverage for {index_file.parent.name} "
                        f"is {coverage:.1%}, below {min_coverage:.1%}; "
                        "do not interpolate invented jaw/cheek measurements"
                    )
                # Robust per-clip neutral reference, not anatomically neutral.
                median = np.median(observed[valid], axis=0).astype(np.float32)
                delta = (observed - median[None, :]) / FEATURE_SCALE[None, :]
                expression_median = np.median(extras[valid], axis=0).astype(np.float32)
                expression_delta = (extras - expression_median[None, :]) / .50
                if np.any(np.abs(expression_delta[valid]) > 5.):
                    raise ValueError("Unexpected facial expression label range")
                if np.any(np.abs(delta[valid]) > 5.):
                    raise ValueError("Unexpected facial dynamics range; check camera framing")
                np.savez_compressed(dest, surfacePoints=points, observed=observed,
                                    median=median, motion=delta.astype(np.float32),
                                    valid=valid, featureNames=np.array(FEATURE_NAMES),
                                    expressionNames=np.array(EXPRESSION_EXTRAS),
                                    expressionObserved=extras,
                                    expressionMedian=expression_median,
                                    expressionMotion=expression_delta.astype(np.float32))
                counts[split]["total"] += len(records)
                counts[split]["valid"] += int(valid.sum())
                # No personal surface landmark output in public logs.
                print("SONG_SURFACE_LABELS=" + json.dumps({
                    "split": split, "frames": len(records),
                    "labeled": int(valid.sum()), "coverage": round(coverage, 4)
                }), flush=True)
    return counts


def main():
    parser = argparse.ArgumentParser(description="Extract opt-in face surface dynamics labels")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--minimum-coverage", type=float, default=.80)
    args = parser.parse_args()
    report = annotate_face_surface_dataset(
        args.dataset, args.model, min_coverage=args.minimum_coverage)
    print(json.dumps({"status": "estimated_surface_geometry_not_bone_measurements",
                      "counts": report}, sort_keys=True))


if __name__ == "__main__":
    main()
