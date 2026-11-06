"""SONG-Vision facial surface geometry & experimental audio-driven lip warp.

No hosted AI API. The offline Face Landmarker bundle is NOT authored/trained
by SONG; landmark measurements and mouth deformation code below are original.
2D/estimated 3D landmarks DO NOT locate real skull or jaw bones.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

from .core import SAMPLE_RATE, assert_consent, decode_audio
from .viseme_timeline import load_timeline, sample_frames, verify_audio_file

VERSION = "song-face-geometry-v1"
MIN_POINTS = 478
# Official Google MediaPipe landmark indices (surface landmarks, not bones).
KEYPOINTS = {
    "eye_outer_left_image": 33,
    "eye_outer_right_image": 263,
    "eye_inner_left_image": 133,
    "eye_inner_right_image": 362,
    "nose_tip_surface": 1,
    "lip_upper_inner": 13,
    "lip_lower_inner": 14,
    "mouth_corner_left_image": 61,
    "mouth_corner_right_image": 291,
    "chin_surface": 152,
    "cheek_left_image": 234,
    "cheek_right_image": 454,
    "forehead_surface": 10,
}
LIP_OUTLINE = (
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    409, 270, 269, 267, 0, 37, 39, 40, 185, 61,
)
# These are a closed ring in the Image plane. Depth is only a model estimate.
LIP_INNER = (78, 95, 88, 178, 87, 14, 317, 402, 318,
             324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78)


def _check_points(points: np.ndarray) -> np.ndarray:
    array = np.asarray(points, dtype=np.float64)
    if array.ndim != 2 or array.shape[0] < MIN_POINTS or array.shape[1] != 3:
        raise ValueError("Expected >=478 MediaPipe landmarks with x,y,relative-z")
    if not np.isfinite(array).all():
        raise ValueError("Nonfinite face landmarks")
    return array


def _xy_px(points: np.ndarray, width: int, height: int) -> np.ndarray:
    return points[:, :2] * np.asarray([width, height])


def measure_face(points: np.ndarray, width: int, height: int,
                 blendshapes: dict | None = None, detailed: bool = False) -> dict:
    """Surface ratios, never anatomical bone widths or real mm distances."""
    pts = _check_points(points)
    if min(width, height) <= 0:
        raise ValueError("Invalid dimensions")
    xy = _xy_px(pts, width, height)

    def length(a: int, b: int) -> float:
        return float(np.linalg.norm(xy[a] - xy[b]))

    mouth_width = max(length(61, 291), 1e-6)
    eye_width = max(length(33, 263), 1e-6)
    lip_open = length(13, 14)
    face_width = max(length(234, 454), 1e-6)
    if not 5 <= mouth_width <= width * 1.5 or eye_width < 5:
        raise ValueError("Unreliable facial geometry, reject distorted landmarks")
    ratio = lip_open / mouth_width
    if ratio > 1.2:
        raise ValueError("Implausible mouth geometry")
    select = {}
    for label, idx in KEYPOINTS.items():
        select[label] = {
            "x": round(float(pts[idx, 0]), 6),
            "y": round(float(pts[idx, 1]), 6),
            "relativeZ": round(float(pts[idx, 2]), 6),
            "pixelX": round(float(xy[idx, 0]), 2),
            "pixelY": round(float(xy[idx, 1]), 2),
        }
    output = {
        "engine": VERSION,
        "coordinateType": "estimated_surface_landmarks",
        "width": width,
        "height": height,
        "count": len(pts),
        "boneMeasurementsAvailable": False,
        "internalTonguePositionAvailable": False,
        "mouth": {
            "openingWidthNormalizedRatio": round(ratio, 6),
            "mouthWidthPx": round(mouth_width, 2),
            "visibleGapPx": round(lip_open, 2),
            "mouthToEyeSpanRatio": round(mouth_width / eye_width, 5),
        },
        "surface": {
            "eyeSpanToCheekSpanRatio": round(eye_width / face_width, 5),
            "noseToChinOverEyeSpan": round(length(1, 152) / eye_width, 5),
            "faceOrientation": "2D projected; not medically calibrated",
        },
        "keypoints": select,
        "blendshapes": {str(k): round(float(v), 5) for k, v in (blendshapes or {}).items()},
    }
    if detailed:
        output["allLandmarks"] = [
            [round(float(p[0]), 6), round(float(p[1]), 6), round(float(p[2]), 6)]
            for p in pts
        ]
    return output


def annotate_face(frame: np.ndarray, points: np.ndarray) -> np.ndarray:
    pts = _check_points(points)
    result = frame.copy()
    xy = _xy_px(pts, frame.shape[1], frame.shape[0])
    for ring in (LIP_OUTLINE, LIP_INNER):
        polygon = np.rint(xy[np.asarray(ring)]).astype(np.int32)
        cv2.polylines(result, [polygon], False, (40, 230, 230), 1, cv2.LINE_AA)
    for label, i in KEYPOINTS.items():
        x, y = np.rint(xy[i]).astype(int)
        cv2.circle(result, (int(x), int(y)), 2, (50, 220, 40), -1, cv2.LINE_AA)
    return result


class LocalFaceLandmarker:
    """Runs a separately installed on-device Google model from a local file."""
    def __init__(self, model_path: Path, video: bool = False):
        if not model_path.is_file():
            raise FileNotFoundError("Install official face_landmarker.task locally first")
        try:
            import mediapipe as mp
        except ImportError as exc:
            raise RuntimeError("Install the optional mediapipe package") from exc
        self.mp = mp
        self.video = video
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path.resolve())),
            running_mode=(mp.tasks.vision.RunningMode.VIDEO
                          if video else mp.tasks.vision.RunningMode.IMAGE),
            num_faces=1,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
        )
        self.model = mp.tasks.vision.FaceLandmarker.create_from_options(options)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.model.close()

    def detect(self, bgr: np.ndarray, timestamp_ms: int | None = None):
        rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        frame = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        if self.video:
            if timestamp_ms is None or timestamp_ms < 0:
                raise ValueError("Video landmark detection requires monotonic timestamps")
            result = self.model.detect_for_video(frame, int(timestamp_ms))
        else:
            result = self.model.detect(frame)
        if len(result.face_landmarks) != 1:
            return None
        points = np.asarray([[p.x, p.y, p.z] for p in result.face_landmarks[0]], dtype=np.float64)
        shapes = {}
        if result.face_blendshapes:
            shapes = {c.category_name: float(c.score) for c in result.face_blendshapes[0]}
        return points, shapes


def audio_to_opening_curve(waveform: np.ndarray, seconds: float,
                           start: float = 0, fps: int = 25) -> np.ndarray:
    """RMS-driven vowel-like mouth OPENING proxy, not phoneme/viseme alignment.

    Audio amplitude is not sufficient to infer an accurate singing mouth shape.
    """
    if not (0 < seconds <= 30) or start < 0 or not 1 <= fps <= 120:
        raise ValueError("Invalid audio timing")
    wave = np.asarray(waveform, dtype=np.float32)
    count = int(math.ceil(seconds * fps))
    curve = np.zeros(count, dtype=np.float32)
    for i in range(count):
        center = int((start + i / fps) * SAMPLE_RATE)
        lo = max(0, center - int(SAMPLE_RATE * .035))
        hi = min(len(wave), center + int(SAMPLE_RATE * .035))
        segment = wave[lo:hi]
        curve[i] = float(np.sqrt(np.mean(segment * segment))) if len(segment) else 0.
    low = float(np.percentile(curve, 15))
    high = float(np.percentile(curve, 95))
    if high < 1e-4:
        return np.full(count, .008, dtype=np.float32)
    # If RMS barely changes, don't invent highly dynamic lip motions.
    change = max(high - low, .025 * high, 1e-5)
    scaled = np.clip((curve - low) / change, 0., 1.)
    target = np.where(curve > max(1e-4, high * .1),
                      .015 + .11 * np.sqrt(scaled), .008)
    smooth = np.zeros_like(curve)
    smooth[0] = target[0]
    for i in range(1, count):
        alpha = .48 if target[i] > smooth[i - 1] else .22
        smooth[i] = (1. - alpha) * smooth[i - 1] + alpha * target[i]
    return smooth


def deform_lips(frame: np.ndarray, points: np.ndarray, target_open_ratio: float,
                strength: float = 1., target_width_scale: float = 1.) -> np.ndarray:
    """Local soft ROI warp. Does not synthesize teeth, tongue or new visemes."""
    pts = _check_points(points)
    if frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError("Expected BGR frame")
    if (not 0 <= strength <= 2 or not 0 <= target_open_ratio <= .5
            or not 0.7 <= target_width_scale <= 1.3):
        raise ValueError("Unbounded mouth movement")
    h, w = frame.shape[:2]
    xy = _xy_px(pts, w, h)
    left, right = xy[61], xy[291]
    upper, lower = xy[13], xy[14]
    width = float(np.linalg.norm(right - left))
    if width < 12 or width > w * .8:
        raise ValueError("Mouth too small/large for safe deform")
    center_x = float((left[0] + right[0]) / 2)
    center_y = float((upper[1] + lower[1]) / 2)
    observed_ratio = float(np.linalg.norm(upper - lower) / width)
    if observed_ratio > 1.0:
        raise ValueError("Invalid input lip position")
    dy = float(np.clip((target_open_ratio - observed_ratio) * width * strength,
                       -.12 * width, .12 * width))
    width_factor = 1. + (target_width_scale - 1.) * strength
    if abs(dy) < .08 and abs(width_factor - 1.) < .003:
        return frame.copy()
    rx, ry = max(8., .85 * width), max(8., .66 * width)
    x1, x2 = max(0, int(center_x - rx)), min(w, int(center_x + rx + 1))
    y1, y2 = max(0, int(center_y - ry)), min(h, int(center_y + ry + 1))
    if x2 - x1 < 10 or y2 - y1 < 10:
        raise ValueError("Mouth ROI out of bounds")
    yy, xx = np.mgrid[y1:y2, x1:x2].astype(np.float32)
    sigma_x = max(4., width * .40)
    sigma_y = max(4., width * .23)
    upper_field = np.exp(-.5 * (((xx - center_x) / sigma_x) ** 2 +
                               ((yy - float(upper[1])) / sigma_y) ** 2))
    lower_field = np.exp(-.5 * (((xx - center_x) / sigma_x) ** 2 +
                               ((yy - float(lower[1])) / sigma_y) ** 2))
    # Inverse-mapping from output pixels to original: upper lip moves up,
    # lower lip moves down. This is intentionally a limited 2D approximation.
    displacement_y = (-.4 * upper_field + .6 * lower_field) * dy
    local = frame[y1:y2, x1:x2]
    # Horizontal inverse remap changes projected lip width in a bounded ROI.
    # This cannot reconstruct true lip protrusion or teeth/tongue occlusion.
    lip_field = np.exp(-.5 * (((xx - center_x) / (width * .56)) ** 2
                                 + ((yy - center_y) / (width * .32)) ** 2))
    x_displacement = (xx - center_x) * (1. - 1. / width_factor) * lip_field
    map_x = (xx - x1 - x_displacement).astype(np.float32)
    map_y = (yy - y1 - displacement_y).astype(np.float32)
    warped = cv2.remap(local, map_x, map_y, interpolation=cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_REFLECT_101)
    dx = (xx - center_x) / rx
    ddy = (yy - center_y) / ry
    feather = np.clip((1. - dx ** 2 - ddy ** 2) * 4., 0., 1.)[..., None]
    result = frame.copy()
    result[y1:y2, x1:x2] = np.clip(warped * feather + local * (1. - feather),
                                   0, 255).astype(np.uint8)
    return result


def inspect_image(image_path: Path, model_path: Path, json_path: Path,
                  annotated_path: Path | None = None, detailed: bool = False):
    frame = cv2.imread(str(image_path))
    if frame is None:
        raise ValueError("Could not decode image")
    with LocalFaceLandmarker(model_path) as scanner:
        detected = scanner.detect(frame)
    if detected is None:
        raise ValueError("Exactly one visible face is required")
    pts, shapes = detected
    report = measure_face(pts, frame.shape[1], frame.shape[0], shapes, detailed)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if annotated_path:
        annotated_path.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(annotated_path), annotate_face(frame, pts)):
            raise IOError("Failed to save annotated face")
    return report


def animate_video(template: Path, vocals: Path, mix: Path, model_path: Path,
                  consent_record: Path, output: Path, seconds: float = 10.,
                  start: float = 0., strength: float = 1.,
                  timeline_path: Path | None = None):
    """Offline preview; operator must verify actual rights beyond consent JSON."""
    assert_consent(consent_record, scope="video_edit")
    if not 1. <= seconds <= 30. or start < 0 or not 0 <= strength <= 2:
        raise ValueError("Invalid preview length or strength")
    if output.exists():
        raise FileExistsError("Never overwrite an existing output video")
    waveform = decode_audio(vocals)
    if len(waveform) / SAMPLE_RATE < start + seconds - .02:
        raise ValueError("Vocals do not cover requested audio range")
    cap = cv2.VideoCapture(str(template))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not cap.isOpened() or not math.isfinite(fps) or fps <= 0 or min(width, height) < 128:
        raise ValueError("Template video invalid")
    if frame_count / fps + .02 < seconds:
        raise ValueError("Video template shorter than preview; no looping hidden")
    if timeline_path is not None:
        timeline = load_timeline(timeline_path)
        verify_audio_file(timeline, vocals)
        controls = sample_frames(timeline, start, seconds, fps=25)
        control_mode = "human_reviewed_korean_viseme_timeline"
    else:
        curve = audio_to_opening_curve(waveform, seconds, start, fps=25)
        controls = [{"openingRatio": float(value), "widthScale": 1.}
                    for value in curve]
        control_mode = "rms_amplitude_only"
    output.parent.mkdir(parents=True, exist_ok=True)
    seen = 0
    with tempfile.TemporaryDirectory(prefix="song-geometry-") as tmp:
        silent = Path(tmp) / "silent.mp4"
        writer = cv2.VideoWriter(str(silent), cv2.VideoWriter_fourcc(*"mp4v"), 25., (width, height))
        if not writer.isOpened():
            raise RuntimeError("OpenCV MP4 codec not available")
        try:
            with LocalFaceLandmarker(model_path, video=True) as scanner:
                for i, control in enumerate(controls):
                    video_second = i / 25.
                    cap.set(cv2.CAP_PROP_POS_MSEC, video_second * 1000.)
                    ok, frame = cap.read()
                    if not ok:
                        raise ValueError("Video frame not decodable")
                    detection = scanner.detect(frame, int(i * 1000 / 25))
                    if detection is None:
                        raise ValueError(f"Face tracking failed at frame {i}")
                    points, _ = detection
                    new_frame = deform_lips(
                        frame, points, float(control["openingRatio"]), strength,
                        target_width_scale=float(control["widthScale"]))
                    writer.write(new_frame)
                    seen += 1
        finally:
            writer.release()
            cap.release()
        command = [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-y", "-i", str(silent), "-ss", str(start), "-t", str(seconds),
            "-i", str(mix), "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-t", str(seconds),
            "-movflags", "+faststart", str(output),
        ]
        try:
            subprocess.run(command, check=True, capture_output=True)
        except Exception:
            output.unlink(missing_ok=True)
            raise
    if not output.is_file() or output.stat().st_size < 1000:
        output.unlink(missing_ok=True)
        raise RuntimeError("Video was not produced")
    report = {
        "engine": VERSION,
        "status": "EXPERIMENTAL_RMS_WARP_NOT_ACCURATE_PHONEME_LIPSYNC",
        "frames": seen,
        "durationSeconds": seconds,
        "customerFaceReplaced": False,
        "boneMeasurementsAvailable": False,
        "controlMode": control_mode,
        "lipSyncVerified": False,
        "alignmentProvenance": "manual_timings" if timeline_path else "none",
        "modelFileSha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
    }
    output.with_suffix(".geometry.json").write_text(json.dumps(report, indent=2),
                                                       encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description="SONG-Vision offline face mesh and lip warp")
    sub = parser.add_subparsers(dest="command", required=True)
    image = sub.add_parser("analyze-face")
    image.add_argument("--image", type=Path, required=True)
    image.add_argument("--model", type=Path, required=True)
    image.add_argument("--output-json", type=Path, required=True)
    image.add_argument("--annotated", type=Path)
    image.add_argument("--all-landmarks", action="store_true")
    video = sub.add_parser("warp-video")
    video.add_argument("--template", type=Path, required=True)
    video.add_argument("--vocals", type=Path, required=True)
    video.add_argument("--mix", type=Path, required=True)
    video.add_argument("--model", type=Path, required=True)
    video.add_argument("--consent-record", type=Path, required=True)
    video.add_argument("--output", type=Path, required=True)
    video.add_argument("--seconds", type=float, default=10.)
    video.add_argument("--start", type=float, default=0.)
    video.add_argument("--strength", type=float, default=1.)
    video.add_argument("--timeline", type=Path, help="Verified Korean syllable timing JSON")
    args = parser.parse_args()
    if args.command == "analyze-face":
        report = inspect_image(args.image, args.model, args.output_json,
                               args.annotated, args.all_landmarks)
    else:
        report = animate_video(args.template, args.vocals, args.mix, args.model,
                               args.consent_record, args.output, args.seconds,
                               args.start, args.strength, args.timeline)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
