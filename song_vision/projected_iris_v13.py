"""Visible projected iris-centre motion, NOT eye tracking of true gaze direction.

Google Face Landmarker returns 478 surface landmarks, including estimated
iris centres (468 and 473) when available. This uses normalized local pixel
coordinates relative to the two visible eye corners. It does NOT measure
eyeball rotation, pupil dilation, gaze at a 3D target, intention or emotion.

Never infer iris labels from audio. Obtain supervision only from detected
source video frames. Some cropped frames will not contain reliable irises;
invalid geometry is skipped rather than silently fabricated.
"""
from __future__ import annotations

import numpy as np

IRIS_FEATURES = (
    "leftIrisHorizontalRelativeEye", "leftIrisVerticalRelativeEye",
    "rightIrisHorizontalRelativeEye", "rightIrisVerticalRelativeEye",
)
IRIS_COUNT = len(IRIS_FEATURES)


def measure_projected_iris(points) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float32)
    if pts.shape != (478, 3) or not np.isfinite(pts).all():
        raise ValueError("Exactly 478 finite observed face surface points required")
    xy = pts[:, :2]
    values = []
    for iris, corner_a, corner_b in ((468, 33, 133), (473, 263, 362)):
        center = .5 * (xy[corner_a] + xy[corner_b])
        eye_span = float(np.linalg.norm(xy[corner_a] - xy[corner_b]))
        if eye_span < .025 or eye_span > .5:
            raise ValueError("Eye span unreliable; no iris-motion ground truth")
        delta = (xy[iris] - center) / eye_span
        if not np.isfinite(delta).all() or float(np.abs(delta).max()) > 3:
            raise ValueError("Iris point out of plausible projected eye region")
        values.extend(float(v) for v in delta)
    return np.asarray(values, dtype=np.float32)


def iris_motion_from_private_face_labels(points, valid) -> tuple[np.ndarray, np.ndarray]:
    """Return video-observed iris motion about the per-clip median.

    Unreliably detected frames get 0 only as a storage placeholder, and
    MUST be excluded by returned explicit validity mask in every loss.
    """
    pts = np.asarray(points)
    ok = np.asarray(valid)
    if pts.ndim != 3 or pts.shape[1:] != (478, 3) or ok.shape != (len(pts),):
        raise ValueError("Misaligned per-frame face points / validity")
    measured = np.zeros((len(pts), IRIS_COUNT), dtype=np.float32)
    reliable = np.zeros(len(pts), dtype=bool)
    for i in np.flatnonzero(ok):
        try:
            measured[i] = measure_projected_iris(pts[i])
            reliable[i] = True
        except ValueError:
            pass
    if int(reliable.sum()) < 2:
        return measured, reliable
    median = np.median(measured[reliable], axis=0)
    measured[reliable] = np.clip(
        (measured[reliable] - median) / .50, -3., 3.)
    return measured, reliable
