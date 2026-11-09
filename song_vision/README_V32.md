# SONG-Vision v32: actual owner oral pixels + 3D-ready constraints

## Status
- Original owner Speaking videos are used as observable data.
- 8 mouth-appearance states from source frames; 2D lower-face pixel transfer and video created.
- Inner-opening mask is dark-connected-component **proxy**, not full verified oral contour; bright teeth/tongue mask proposals are likewise not clinical labels.
- No artificial black ellipse mouth interior in final face rendering; actual visible teeth/tongue/oral pixels come from owner video.
- Maxillary upper 61% remains pixel-identical; actual lower face/cheek and chin pixels are selected from owner frames instead of stretching the philtrum.
- Jamo parser covers all 19 modern choseong, 21 jungseong, 28 jongseong slots (including empty final): 11,172 Hangul syllables.
- Sound-change rules and phoneme timing are not fabricated. Human-reviewed surface transcription required to train.
- 3D FLAME/MediaPipe interfaces are prepared but no calibrated owner 3D fit, true jaw bone angle, tongue cavity or teeth geometry model has been trained. Offline install of MediaPipe failed; no external model weights were available.
- This is an observational 2D prototype, not a scientifically validated anatomical 3D face or correct lyric-sync model.

## Scientific references
- Google MediaPipe Face Landmarker: 478 landmarks, 52 expression blendshapes, transformation matrices: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- Li et al. (2017), FLAME Faces Learned with an Articulated Model and Expressions, SIGGRAPH Asia: https://flame.is.tue.mpg.de/
- Liu et al. (2020), LaPa pixel-level face parsing with 11 categories and 106 points, AAAI. DOI 10.1609/aaai.v34i07.6832: https://ojs.aaai.org/index.php/AAAI/article/view/6832
- Feng et al. (2021), DECA expression-dependent detail and identity shape. DOI 10.1145/3450626.3459936: https://doi.org/10.1145/3450626.3459936
- Xing et al. (2023), CodeTalker, speech-driven 3D animation. CVPR pages 12780-12790: https://openaccess.thecvf.com/content/CVPR2023/html/Xing_CodeTalker_Speech-Driven_3D_Facial_Animation_With_Discrete_Motion_Prior_CVPR_2023_paper.html
- Montreal Forced Aligner Korean speech acoustic model (not run, lyrics still unaligned): https://huggingface.co/MontrealCorpusTools/korean_mfa

## Test and reproduction
`python -m unittest -v test_owner_v32.py`
`python render_owner_v32.py`
Required packages: numpy, scipy, opencv-python, Pillow, ffmpeg; locally mounted user source videos.

The video is a diagnosis: left neutral, center appearance with REAL mouth pixels, right unverified segmentation mask overlays. The labels `ㅏ,ㅗ,ㅜ` are style targets mapped to visibly similar observed shapes, **not** phonetic labels measured from the corresponding video frame. Interpolation is not a trained physically-based motion path.

## Self-supervised owner 2D motion training (executed)
`train_owner_v32_motion_prior.py` learns a 3-component PCA basis of lower-face 24×40×2 optical-flow fields from six observed frames in `IMG_0853.mp4`; two distinct video samples from `IMG_0854.mp4` are held out as a probe. Training-reconstruction MAE 0.4576 flow units; heldout projection 1.7182 versus zero-motion 2.3144. **The heldout projection uses the target's flow for coefficients and therefore is NOT prediction accuracy or phoneme/3D training.** Private basis data is never published to the public Github site. This provides a reproducible starting point for later verified audio/text-conditioned 3D jaw/skin learning, not a working 3D model.
