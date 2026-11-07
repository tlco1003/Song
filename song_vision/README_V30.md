# SONG-Vision v30 — owner-specific observable lip heights and pose sections

## Study purpose
This iteration extends v29's 2D jaw and cheek skin rig with **separately measured
upper/lower visible vermilion band heights** and **pose-candidate sections** from
owner-authorized speaking video. It does **not** infer real tissue depth,
mandibular rotation, hidden mouth 3D, true Korean phonemes, or exact sung lyrics
boundaries. Code and rendered previews are research-only.

## Verified scientific basis (read primary publications)

1. Nasir, S. H., Popat, H., Richmond, S. (2020), *The effect of resting morphological
   lip shape during lip movement: A three-dimensional motion analysis study*,
   Heliyon 6(6), e04093. DOI: 10.1016/j.heliyon.2020.e04093.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC7267716/
   They tracked **six 3D lip landmarks** in 80 individuals at rest and during
   production of bilabial words. The study does **not** provide user-specific
   vowel-matched measurements or prove that a particular Korean `ㅔ` is always
   thinner than `ㅣ`.
2. Ferrario et al. (2000), *Normal growth and development of the lips: a
   3-dimensional study from 6 years to adulthood using a geometric model*.
   Journal of Anatomy 196:415–423, DOI 10.1046/j.1469-7580.2000.19630415.x.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC1468077/
   Landmark-based lip width / vermilion height / area / volume are separately
   defined. **2D colored vermilion height cannot be equated to lip tissue
   thickness or volume in mm.**
3. Three-Dimensional Photogrammetric Study on Age-Related Facial Characteristics
   in Korean Females (2021). https://pmc.ncbi.nlm.nih.gov/articles/PMC7875215/
   Provides the distinction between upper/lower visible vermilion landmarks
   and mouth width for Korean female subjects. Population stats cannot be
   applied as one subject's dynamic measurements.
4. Nazari, Perrier, Chabanas & Payan (2011), *Shaping by stiffening: a modeling
   study for lips*, Motor Control 15:141–168, DOI 10.1123/mcj.15.1.141.
   https://pubmed.ncbi.nlm.nih.gov/21339518/
   Stress-stiffening and orbicularis oris activation affect lip protrusion,
   rounding, and limit of deformation; do **not** claim its force/material
   constants are learned from the owner's 2D RGB footage.
5. Rams et al. (2024), *Investigating the Contraction Pattern of the
   Zygomaticus Major Muscle and its Clinical Relevance: A Functional MRI Study*.
   DOI 10.1007/s00266-024-03876-8.
   https://pubmed.ncbi.nlm.nih.gov/38413445/
   Facial muscle/cheek displacement couples to smiling emotion. This study did
   not measure speaker-specific vowel lips.
6. Garg et al. (2026), *Multimodal Assessment of Biomechanical and Neuromuscular
   Characteristics of Zygomaticus Major in Healthy Participants*.
   DOI 10.1097/GOX.0000000000007639.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC13105802/
   Midface skin moves differently for smile versus puckering; its data from
   33 subjects are **not** the owner's tissue mechanics training labels.
7. Ha & Hwang (2024), *A Study on the Articulatory Patterns and Spatial
   Structure of Monophthongs in Korean*, DOI 10.29211/soli.2024.52..004.
   https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=ART003106062
   Korean vowel tongue/tract articulation must not be reduced to visual lip
   style. This does not provide user's phoneme start/end ground truth.

## Actual local execution

Owner footage: `IMG_0853.mp4`, `IMG_0854.mp4`. Lips detected with seeded
GrabCut; candidate dark aperture also detected. Visible upper/lower thickness is
measured **only if the algorithm can extract a putative inner boundary**; when
closed or unclear, numbers are null. All values in **pixels on normalized
320×320 face crops**. There is no real-world mm calibration or clinical label
validation. Visual inspection found closed-mouth false candidates, so known
closed examples have been explicitly gated to null. This still does not
establish accuracy on unfamiliar footage.

Front/profile candidate tracking uses OpenCV frontal/profile Haar cascades and
an eye detector. Yaw angle in degrees is null throughout; a simultaneous front
and profile detection is flagged for review. Turned footage at about 9–13s of
`IMG_0853.mp4` is shown **unchanged**, not treated as a validated 3D side rig.

The owner-derived 2D mouth shape atlas, independent jaw movement proxy, and
facial microexpression field from v29 are retained. Experimental upper/lower
vermilion *scaling* is added as an image remap, and bounded to avoid deforming
outside the mouth: `ㅣ 0.94/0.96`, `ㅔ 0.80/0.89`, `ㅗ 1.12/1.10`,
`ㅜ 1.04/1.02`, `ㅏ 1.05/1.11`, `ㅡ 0.88/0.92`.
**These are unverified animation controls based on the user's requested look,
not clinical or learned Korean-phoneme norms.** A real person may articulate
these vowels differently.

`AM630_V30_VISIBLE_LIP_THICKNESS_UNALIGNED.mp4` combines the actual supplied
AM 6:30 sound, literal text from the supplied song, and placeholder unaligned
syllable timing. It is **not** a quantitatively verified singing sync. The
`AM630_V30_HUMAN_ALIGNMENT_PENDING.json` contract contains null timestamps and
requires manual review before phoneme-accurate claims.

## Reproduction and tests

Run `python -m unittest -v test_v30_owner.py` in the source container with
source videos, then `python analyze_v30_owner.py`, `python render_v30_owner.py`
and `python render_v30_am630.py` with an original user-authorized audio file.
Dependencies: Python, OpenCV, numpy, Pillow, SciPy (for the inherited v26/v29
modules), ffmpeg, existing v26/v27/v29 model code and source footage.

Passing synthetic shape tests mean the transformation is implemented, **not**
that its anatomical realism or Korean lip sync is independently validated.
No third-party face/video weights or external person's photos were trained.

## Next hard requirements

1. Person-verified front/left/right pose labels, landmarks, and side-specific
   shape libraries; reject automatic pose labels when detectors disagree.
2. Lip vermilion and oral-cavity boundary annotations at frame-level for real
   Dice/IoU and human-vs-model interobserver measurement errors. Current
   dark-pixel method fails on teeth and closed lips.
3. Per-vowel text/time human annotations, followed by testing of `ㅣ` vs `ㅔ`
   thickness and `ㅗ` vs `ㅜ` aperture on held-out recording sessions.
4. Jaw bone motion capture/3D scan before any real bone angle or tissue force
   claim. Facial 2D pixel flow is not a bone measurement.
