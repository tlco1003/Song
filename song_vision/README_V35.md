# SONG-Vision v35 — Korean articulatory 3D rig (research prototype)

## What actually runs
This is an **executable three-dimensional parametric oral-articulator model** that produces two MP4 videos and six inspectable `.glb` 3D scenes. It is intentionally a general **normalized** Korean phoneme-gesture template, **not** a 3D reconstruction of any specific person's hidden tongue, teeth or jaw. No tongue MRI, EMA, ultrasound, FEM parameters or person-specific jaw measurements are available. It is not yet an audio-synchronous facial video or an acoustic speech synthesizer.

1. 3D tongue surface/volume mesh with independent **tip, blade, mid-body, dorsum, root** control points.
2. Static **hard palate and upper jaw**, mobile **soft palate / velum**, and a spatial tongue-palate nonpenetration constraint. Intended tongue-to-palate/gingiva constrictions are represented explicitly (and measured numerically in the template).
3. Separate rigid **mandibular hinge**, 3D jaw bones, **mandibular versus maxillary teeth**, upper/lower lips and **forward lip protrusion**. The upper skull and maxillary teeth are never transformed by the jaw hinge.
4. Glottal aspiration/tenseness state and nasal port/velum opening are controlled separately from the visible lips.
5. Twelve *muscle function proxy commands* for future biomechanical solvers. These are not actual EMG or forces: e.g. genioglossus fronting, styloglossus raising, orbicularis oris pursing, digastric jaw opening, levator veli palatini velar closure. Mapping from these proxies to a physical muscle activation/FEM system is **not implemented**.
6. **All 19 modern Hangul onsets** and **21 medial vowels** have computational presets (399 onset-vowel combinations). Diphthongs/glides such as ㅑ /j+a/, ㅛ /j+o/ and ㅠ /j+u/ have time-dependent motions, not one frozen shape. This is a pedagogical approximation, not a validated phonetic representation.
7. **All 28 coda slots** are parsed, but only the seven basic final-place patterns (ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅇ) have guarded contacts. Composite and context-changing final pronunciation **fail closed** until real Korean surface-pronunciation alignment exists. Onset `ㅇ` is silent; coda `ㅇ` is velar-nasal with velum opening.
8. `owner_v35_text_to_3d.py` converts Hangul strings to timed 3D control sequences with **illustrative** durations and explicit `synchronizedToRealAudio=False`. It does not substitute for verified phoneme time alignment of real recordings.
9. Frame renderers show the hidden 3D tongue and palate from a cutaway viewpoint plus a schematic front-mouth drawing. Front diagrams use illustrative mouth color fill, **not user facial imagery**, and do not claim photo-realism.

## Executed validations
`python -m unittest -v test_owner_v35_articulatory_3d.py` — **14 tests passed locally** (2026-11-09). Tests include all 19×21 phoneme combinations, tongue/palate mesh nonpenetration, /ㄱ ㄴ ㄷ ㅈ/ closure-site gap, /ㅅ/ narrow frication gap, /ㅁ ㄴ/ velum opening, /ㅜ/ versus /ㅗ/ jaw and protrusion constraints, /ㅏ/ jaw drop, glide variation, upper-skull invariance with jaw rotation, 3D scene export, distinct onset/coda `ㅇ`, and fail-closed complex coda pronunciation.

## What is NOT learned/validated
- No personal oral MRI, ultrasound, EMA, bite scan, motion-capture or multi-view 3D geometry was used: **personal tongue position cannot be inferred reliably from hidden video pixels**.
- No realistic soft tissue FEM dynamics or muscles forces were solved, even though controls and hard contact guards exist. Tongue mesh deformation is a parametric animation.
- No actual voice synthesis from constrictions or 3D airway acoustics, laryngeal wave propagation, nasal formants, phoneme-level correctness or lip-sync accuracy.
- The normalized jaw angles, collision clearances and tongue heights are illustrative authoring values and are **not** biomechanical measurements taken from the articles below.
- 3D .glb meshes include tongue, hard palate/velum, lip ring, mandible and teeth, but no person's actual facial skin, nerves or individual tooth geometry.

## Primary scientific research (checked)
- Stavness et al. **Coupled hard–soft tissue simulation with contact and constraints applied to jaw–tongue–hyoid dynamics** (2011). DOI: [10.1002/cnm.1423](https://doi.org/10.1002/cnm.1423). Physical hard/soft tissue coupling and true dynamic contact require solver/muscle parameters absent in this research template.
- Stavness, Lloyd & Fels. **Automatic prediction of tongue muscle activations using a finite element model** (2012). DOI: [10.1016/j.jbiomech.2012.08.031](https://doi.org/10.1016/j.jbiomech.2012.08.031).
- Anderson et al. **A comprehensive 3D biomechanically-driven vocal tract model including inverse dynamics for speech research**. Interspeech 2015, DOI [10.21437/Interspeech.2015-518](https://www.isca-archive.org/interspeech_2015/anderson15_interspeech.html). Adds soft palate, pharynx, larynx and airway model to previous jaw/tongue frameworks.
- Kim, Honda & Maeda. **Stroboscopic-cine MRI study of the phasing between the tongue and the larynx in the Korean three-way phonation contrast**. Journal of Phonetics 33(1), 2005. DOI [10.1016/j.wocn.2004.06.001](https://doi.org/10.1016/j.wocn.2004.06.001). Korean lax/aspirated/tense contrast needs laryngeal timing, not just tongue shape.
- Kim. **Gradual tongue movements in Korean Palatalization as coarticulation**. Journal of Phonetics 40(1), 2012. DOI [10.1016/j.wocn.2011.07.004](https://doi.org/10.1016/j.wocn.2011.07.004). Tongue gesture depends on upcoming vowels.
- Kim. **Stroboscopic-cine MRI data on Korean coronal plosives and affricates: implications for their place of articulation as alveolar**. Phonetica 61, 2004/2005. DOI [10.1159/000084160](https://pubmed.ncbi.nlm.nih.gov/15824489/).
- Hwang & Ha. **Articulatory characteristics of Korean monophthongs — a 3D ultrasound study with AUC analysis** (2026). DOI [10.16876/klrc.2026.67.24.1](https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003344185). Studies /ㅣ E ㅡ ㅓ ㅏ ㅜ ㅗ/; does not supply the owner's personalized coefficients.

## Run
```bash
python -m pip install numpy opencv-python pillow trimesh
python -m unittest -v test_owner_v35_articulatory_3d.py
python render_owner_v35_3d.py
python owner_v35_text_to_3d.py
```
Requires ffmpeg on PATH to encode H.264 videos. No internet, pretrained face, or private owner video is required to run the **general** v35 rig. The future owner-specific fitting stage must consume private, consented data and independently verified phoneme timings before promising synchronized 3D tongue animation in user music videos.
