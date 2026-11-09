"""v36 research: audible acoustics depends on HIDDEN tongue, lips, jaw, palate.

Computes a rough 1D air cross-sectional function from the v35 3D tongue and
hard palate surface, then transfer-matrix resonances in a loss-regularized,
closed-glottis / open-mouth tube. This IS NOT a validated speech synthesizer:
there is no full 3D turbulent flow, nasal branch, voice quality model or
person-specific MRI area function.

Scientific principle: Story, Titze & Hoffman (1996) DOI 10.1121/1.415960,
Maeda (1991) DOI 10.1016/S0095-4470(19)30348-1.
"""
from __future__ import annotations
from dataclasses import dataclass,asdict,replace
import math
import numpy as np
from scipy.signal import find_peaks
from owner_v35_articulatory_3d import (
 RigControls,tongue_mesh,palate_height,vowel_pose,consonant_pose,
 BASE_VOWELS,ONSETS,VOWELS,CONSONANTS
)

SPEED_OF_SOUND_M_S=343.0
VOICE_TRACT_LENGTH_M=0.168  # illustration only; NOT measured on the owner

@dataclass
class TubeProfile:
    areas_cm2:list[float]
    length_m:float
    nasal_port_open:bool
    main_oral_constriction:str
    source:str= 'v35_articulator_to_1d_airway_illustrative_geometry'
    owner_anatomy_measured:bool=False
    nasal_branch_acoustically_simulated:bool=False
    complete_glottal_flow_simulated:bool=False


def airway_from_pose(pose:RigControls, nominal_length_m=VOICE_TRACT_LENGTH_M,nx=35)->TubeProfile:
    """Approximate oral air areas using the tongue surface and palate gap.

    The top 3D mesh is observed only in the *synthetic v35 model*. The sampled
    cross sectional function is a proxy, not 3D human anatomical segmentation.
    """
    pose.validate()
    if not 0.12<=nominal_length_m<=0.23:raise ValueError('non calibrated tract length outside demo range')
    verts,faces,checks=tongue_mesh(pose,nx=nx,ny=15)
    upper=verts[:nx*15].reshape(nx,15,3)
    x=upper[:,0,0]
    y=upper[:,:,1]
    roof=palate_height(upper[:,:,0],y,pose.velum_open)
    gap=np.maximum(roof-upper[:,:,2],0.007)
    # Cross-sectional air area from the sagittal tongue upper-to-palate gap.
    # Side channels, teeth contact and pharyngeal wall are NOT calibrated.
    integrated=np.trapezoid(gap,y,axis=1)
    integrated=np.abs(integrated)
    area=np.clip(integrated*13.0+0.09,0.08,5.2)
    # jaw lowering enlarges the anterior cavity, with a smaller rear effect.
    jaw_enlargement=(0.20+0.80*np.clip((x+.2)/1.1,0,1))*pose.jaw_rad*3.7
    area=np.clip(area+jaw_enlargement,0.07,6.5)
    # Constrictions are applied to the AIR SPACE, not visually painted teeth.
    position={'alveolar':.61,'post_alveolar':.40,'velar':-.42}
    if pose.oral_closure in position and pose.oral_stricture>0:
        center=position[pose.oral_closure]
        bell=np.exp(-((x-center)/(.085 if center>0 else .12))**2)
        # stop closure approximates zero flow; airflow turbulence is not simulated.
        closure=np.clip(pose.oral_stricture,0,1.)
        max_reduction=.985 if pose.tongue_groove<.3 else .94
        area *= (1-max_reduction*closure*bell)
    # posterior pharynx; interpolation is illustrative, no laryngoscopy.
    back=np.linspace(float(area[0])*.75,float(area[0]),5)
    # Lip terminal area depends on actual lip OPEN and width independently.
    lip_area=np.clip(0.06+pose.lip_width*(0.15+pose.lip_open)*12.0,0.06,5.0)
    if pose.oral_closure=='bilabial' and pose.oral_stricture>.5:
        lip_area=0.012 # full bilabial closure in 1D duct, not phonation
    front=np.linspace(float(area[-1]),lip_area,5)[1:]
    areas=np.concatenate([back,area,front]).astype(float)
    # lip protrusion acoustically lengthens the resonator in this simplified proxy
    length=nominal_length_m+float(pose.lip_protrusion)*.012
    return TubeProfile([float(round(v,6)) for v in areas],float(length),
        nasal_port_open=pose.velum_open>.25,main_oral_constriction=pose.oral_closure)


def tube_frequency_response(profile:TubeProfile, freqs_hz=None, loss=0.01):
    """Lossy acoustic transfer-matrix of serial tube sections.

    Normalize volume velocity by rho*c so tube matrix has A and 1/A terms.
    Hard glottis / pressure-release lips -> U_glottis = M22*U_lips,
    hence |1/M22| peaks near tube resonances. Radiation impedance,
    nasal/side branches and energy losses are simplified.
    """
    f=np.asarray(freqs_hz if freqs_hz is not None else np.arange(100.,4301.,5.),dtype=float)
    if np.any(~np.isfinite(f)) or np.any(f<=0):raise ValueError('frequency values must be positive')
    a=np.asarray(profile.areas_cm2,dtype=float)
    if len(a)<8 or np.any(~np.isfinite(a)) or np.any(a<=0):raise ValueError('area function invalid')
    if not 0.002<=loss<=0.1:raise ValueError('passivity loss outside supported reference')
    seglen=profile.length_m/len(a)
    phase=2*np.pi*f*seglen/SPEED_OF_SOUND_M_S*(1-1j*loss)
    c=np.cos(phase);s=np.sin(phase)
    # product of all 2x2 matrices over frequency, vectorized across freqs
    m11=np.ones(len(f),dtype=np.complex128);m12=np.zeros(len(f),dtype=np.complex128)
    m21=np.zeros(len(f),dtype=np.complex128);m22=np.ones(len(f),dtype=np.complex128)
    for ar in a:
        n11=m11*c+m12*(1j*ar*s)
        n12=m11*(1j*s/ar)+m12*c
        n21=m21*c+m22*(1j*ar*s)
        n22=m21*(1j*s/ar)+m22*c
        m11,m12,m21,m22=n11,n12,n21,n22
    response=np.abs(1/(m22+1e-12))
    response/=max(float(response.max()),1e-9)
    return f,response


def formant_candidates(profile:TubeProfile,lowest=150,highest=4200,max_count=4):
    """Resonant peaks, NOT verified F1/F2 obtained from owner sound."""
    f,amps=tube_frequency_response(profile,np.arange(float(lowest),float(highest)+1,5))
    peaks,_=find_peaks(amps,prominence=0.06,distance=35)
    peaks=sorted(peaks,key=lambda i:f[i])[:max_count]
    return [int(round(f[i])) for i in peaks]


def phoneme_signature(onset:str,vowel:str):
    """Explicit tongue/lips/jaw/dental/larynx/glottis constraints by phone."""
    c=consonant_pose(onset,vowel)
    v=vowel_pose(vowel)
    cp=CONSONANTS[onset]
    initial=airway_from_pose(c)
    nuclear=airway_from_pose(v)
    return {'onset':onset,'vowel':vowel,'onsetPlace':cp.place,'onsetManner':cp.manner,
        'tongueClosureTarget':c.oral_closure,'lipSealed':bool(c.lip_open<=.005),
        'velumOpen':bool(c.velum_open>.5),
        'glottalAspirationPreset':c.glottal_aspiration,
        'laryngealTensePreset':c.laryngeal_tense,
        'vowelJawRad':v.jaw_rad,'vowelTongueTipZ':v.tip_z,
        'vowelTongueDorsumZ':v.dorsum_z,
        'vowelLipWidth':v.lip_width,'vowelLipProtrusion':v.lip_protrusion,
        'vowelTubeResonancesHz':formant_candidates(nuclear),
        'onsetConstrictionMinAreaCm2':min(initial.areas_cm2),
        'learnedFromOwnerTongueImaging':False,
        'synthesizesFullKoreanSpeech':False,
        'koreanVOT_F0_currently_only_controls_not_fit':True}
