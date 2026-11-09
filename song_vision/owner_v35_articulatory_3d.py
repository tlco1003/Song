"""SONG-Vision v35: executable generative 3D Korean articulator *prototype*.

Prior-driven normalized template, NOT reconstructed anatomy of the owner.
It builds distinct rigid hard-palate/maxilla, rotating jaw, tongue (3-D surface
with tip/blade/dorsum/root), velum, upper/lower teeth and protruding lips.
The tongue is constrained to stay below the palate and can meet articulatory
closures with other moving articulators. Nasality and glottal control are
independent of visible mouth shapes. No spectrally accurate speech is synthesized.

Anatomy research: Stavness et al. 2011 doi:10.1002/cnm.1423;
Anderson et al. 2015 doi:10.21437/Interspeech.2015-518;
Hyunsoon Kim et al. 2005 doi:10.1016/j.wocn.2004.06.001;
Hyunsoon Kim 2012 doi:10.1016/j.wocn.2011.07.004;
Hwang & Ha 2026 doi:10.16876/klrc.2026.67.24.1.
The numeric parameters below are **illustrative normalized authoring presets**,
NOT values fitted to those papers or an individual's oral MRI/ultrasound.
"""
from __future__ import annotations
from dataclasses import dataclass,asdict,replace
from typing import Optional
import math
import numpy as np

ONSETS=tuple('ㄱ ㄲ ㄴ ㄷ ㄸ ㄹ ㅁ ㅂ ㅃ ㅅ ㅆ ㅇ ㅈ ㅉ ㅊ ㅋ ㅌ ㅍ ㅎ'.split())
VOWELS=tuple('ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅗ ㅘ ㅙ ㅚ ㅛ ㅜ ㅝ ㅞ ㅟ ㅠ ㅡ ㅢ ㅣ'.split())
CODAS=tuple('∅ ㄱ ㄲ ㄳ ㄴ ㄵ ㄶ ㄷ ㄹ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅁ ㅂ ㅄ ㅅ ㅆ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ'.split())
assert len(ONSETS)==19 and len(VOWELS)==21 and len(CODAS)==28

# x: posterior(-) to lips(+); y: left/right; z: up. All coordinates normalized.
# States are mid-vowel targets, not phonetic measurements. Glide vowels have
# explicitly different entry/exit poses.
@dataclass(frozen=True)
class VowelPreset:
    jaw:float
    tip:float
    blade:float
    body:float
    dorsum:float
    root:float
    lip_width:float
    lip_open:float
    lip_protrusion:float
    gloss:str

BASE_VOWELS={
'ㅏ': VowelPreset(.255,.05,.13,.04,.09,.07,.43,.30,.02,'open unrounded'),
'ㅐ': VowelPreset(.135,.22,.33,.24,.10,.12,.41,.17,.02,'front mid-open, variable'),
'ㅓ': VowelPreset(.162,.11,.15,.22,.25,.21,.38,.23,.02,'mid/back unrounded'),
'ㅔ': VowelPreset(.102,.23,.35,.29,.08,.12,.40,.14,.01,'front mid, variable'),
'ㅗ': VowelPreset(.067,.11,.12,.31,.35,.27,.23,.12,.28,'rounded mid-back'),
'ㅜ': VowelPreset(.026,.10,.13,.37,.45,.30,.17,.08,.44,'stronger pucker high-back'),
'ㅡ': VowelPreset(.035,.15,.21,.39,.36,.21,.36,.07,.00,'high central unrounded'),
'ㅣ': VowelPreset(.042,.37,.43,.36,.14,.08,.40,.08,.00,'high front unrounded'),
}
GLIDES={
 'ㅑ':('ㅣ','ㅏ'), 'ㅒ':('ㅣ','ㅐ'), 'ㅕ':('ㅣ','ㅓ'), 'ㅖ':('ㅣ','ㅔ'),
 'ㅛ':('ㅣ','ㅗ'), 'ㅠ':('ㅣ','ㅜ'),
 'ㅘ':('ㅗ','ㅏ'), 'ㅙ':('ㅗ','ㅐ'), 'ㅚ':('ㅗ','ㅣ'),
 'ㅝ':('ㅜ','ㅓ'), 'ㅞ':('ㅜ','ㅔ'), 'ㅟ':('ㅜ','ㅣ'), 'ㅢ':('ㅡ','ㅣ'),
}
assert set(BASE_VOWELS)|set(GLIDES)==set(VOWELS)

# Articulatory place and manner are established contrasts, not person-specific
# muscle excitations. Glottis and aspiration must be separately represented.
@dataclass(frozen=True)
class ConsonantPreset:
    place:str
    manner:str
    closure:float
    velum_open:bool=False
    aspiration:float=0.0
    laryngeal_tense:float=0.0

CONSONANTS={
 'ㄱ':ConsonantPreset('velar','stop',1.0),
 'ㄲ':ConsonantPreset('velar','stop',1.0,laryngeal_tense=1.),
 'ㅋ':ConsonantPreset('velar','stop',1.0,aspiration=1.),
 'ㄴ':ConsonantPreset('alveolar','nasal',1.0,velum_open=True),
 'ㄷ':ConsonantPreset('alveolar','stop',1.0),
 'ㄸ':ConsonantPreset('alveolar','stop',1.0,laryngeal_tense=1.),
 'ㅌ':ConsonantPreset('alveolar','stop',1.0,aspiration=1.),
 'ㄹ':ConsonantPreset('alveolar','tap/lateral',.75),
 'ㅁ':ConsonantPreset('bilabial','nasal',1.0,velum_open=True),
 'ㅂ':ConsonantPreset('bilabial','stop',1.0),
 'ㅃ':ConsonantPreset('bilabial','stop',1.0,laryngeal_tense=1.),
 'ㅍ':ConsonantPreset('bilabial','stop',1.0,aspiration=1.),
 'ㅅ':ConsonantPreset('alveolar','fricative',.78),
 'ㅆ':ConsonantPreset('alveolar','fricative',.84,laryngeal_tense=1.),
 'ㅈ':ConsonantPreset('post_alveolar','affricate',1.0),
 'ㅉ':ConsonantPreset('post_alveolar','affricate',1.0,laryngeal_tense=1.),
 'ㅊ':ConsonantPreset('post_alveolar','affricate',1.0,aspiration=1.),
 'ㅎ':ConsonantPreset('glottal','fricative',0,aspiration=.85),
 'ㅇ':ConsonantPreset('none','silent_onset',0),
}
assert set(CONSONANTS)==set(ONSETS)

SIMPLE_CODA={'ㄱ':'velar_stop','ㄴ':'alveolar_nasal','ㄷ':'alveolar_stop','ㄹ':'alveolar_lateral',
             'ㅁ':'bilabial_nasal','ㅂ':'bilabial_stop','ㅇ':'velar_nasal'}

@dataclass(frozen=True)
class RigControls:
    jaw_rad:float
    tip_z:float
    blade_z:float
    body_z:float
    dorsum_z:float
    root_z:float
    lip_width:float
    lip_open:float
    lip_protrusion:float
    velum_open:float=0.
    glottal_aspiration:float=0.
    laryngeal_tense:float=0.
    oral_closure:str='none'
    oral_stricture:float=0.
    tongue_groove:float=0.
    phase:str='vowel'
    target_grapheme:str=''
    observed_owner_tongue:bool=False

    def validate(self):
        vals=(self.jaw_rad,self.tip_z,self.blade_z,self.body_z,self.dorsum_z,self.root_z,
              self.lip_width,self.lip_open,self.lip_protrusion,self.velum_open,
              self.glottal_aspiration,self.laryngeal_tense,self.oral_stricture,self.tongue_groove)
        if not all(math.isfinite(x) for x in vals):raise ValueError('Nonfinite control')
        if not 0<=self.jaw_rad<=.39:raise ValueError('Jaw rotation out of anatomical preset bounds')
        if not 0<=self.lip_open<=.40 or not .04<=self.lip_width<=.56:raise ValueError('Lip dimensions invalid')
        if any(not 0<=x<=1 for x in (self.velum_open,self.glottal_aspiration,self.laryngeal_tense,self.oral_stricture,self.tongue_groove)):
            raise ValueError('normalized control invalid')
        return self


def vowel_pose(vowel:str,progress:float=1.):
    if vowel not in VOWELS:raise ValueError(f'unknown vowel {vowel}')
    if vowel in GLIDES:
        a,b=GLIDES[vowel]
        # First 45% of vowel forms /j/ or /w/ glide toward final target.
        t=float(np.clip((progress-.07)/.90,0,1));t=t*t*(3-2*t)
        va=BASE_VOWELS[a];vb=BASE_VOWELS[b]
        vals=[(1-t)*getattr(va,k)+t*getattr(vb,k) for k in ('jaw','tip','blade','body','dorsum','root','lip_width','lip_open','lip_protrusion')]
    else:
        v=BASE_VOWELS[vowel];vals=[getattr(v,k) for k in ('jaw','tip','blade','body','dorsum','root','lip_width','lip_open','lip_protrusion')]
    return RigControls(*map(float,vals),phase='vowel',target_grapheme=vowel).validate()


def consonant_pose(onset:str,next_vowel='ㅏ',release_progress=0.):
    if onset not in CONSONANTS:raise ValueError('unknown onset '+onset)
    c=CONSONANTS[onset];v=vowel_pose(next_vowel,0 if next_vowel in GLIDES else 1)
    controls=replace(v,phase='onset_closure',target_grapheme=onset,
                     velum_open=1. if c.velum_open else 0.,glottal_aspiration=c.aspiration,
                     laryngeal_tense=c.laryngeal_tense,oral_closure=c.place,
                     oral_stricture=c.closure,
                     tongue_groove=.90 if c.manner=='fricative' and c.place=='alveolar' else 0.)
    if c.place=='bilabial':controls=replace(controls,lip_open=.003,lip_width=max(.20,v.lip_width*.85))
    if c.place=='alveolar':controls=replace(controls,tip_z=.57,blade_z=max(controls.blade_z,.44))
    if c.place=='post_alveolar':controls=replace(controls,blade_z=.57,tip_z=max(controls.tip_z,.36))
    if c.place=='velar':controls=replace(controls,dorsum_z=.59,root_z=max(controls.root_z,.36))
    if c.place=='glottal':controls=replace(controls,oral_closure='none',oral_stricture=0.)
    if c.place=='none':controls=replace(controls,oral_closure='none',oral_stricture=0.)
    if c.manner=='fricative' and c.place=='alveolar':
        controls=replace(controls,tip_z=.515,oral_stricture=.78)
    # Full closure releases progressively; release must not abruptly teleport.
    p=float(np.clip(release_progress,0,1))
    if p>0:
        target=vowel_pose(next_vowel,p)
        controls=blend_controls(controls,target,p)
    return controls.validate()


def blend_controls(a:RigControls,b:RigControls,t:float):
    t=float(np.clip(t,0,1));t=t*t*(3-2*t)
    numeric=('jaw_rad','tip_z','blade_z','body_z','dorsum_z','root_z','lip_width','lip_open',
             'lip_protrusion','velum_open','glottal_aspiration','laryngeal_tense','oral_stricture','tongue_groove')
    data={k:(1-t)*getattr(a,k)+t*getattr(b,k) for k in numeric}
    data.update(oral_closure=a.oral_closure if t<.55 and a.oral_stricture*(1-t)>.12 else 'none',
                phase='transition',target_grapheme=b.target_grapheme,observed_owner_tongue=False)
    return RigControls(**data).validate()


def syllable_motion(onset:str,vowel:str,frames=24):
    """Onset closure -> release -> vowel, with separate glides and velum."""
    if frames<6:raise ValueError('Need >=6 frames')
    final=vowel_pose(vowel,1)
    start=consonant_pose(onset,vowel)
    for i in range(frames):
        t=i/(frames-1)
        if t<.25:state=start
        elif t<.61:
            p=(t-.25)/.36
            state=blend_controls(start,vowel_pose(vowel,p),p)
        else:state=vowel_pose(vowel,min(1,(t-.61)/.27))
        yield state


def palate_height(x,y,velum_open=0.):
    x=np.asarray(x,dtype=np.float64);y=np.asarray(y,dtype=np.float64)
    z=.62-.13*(y/.48)**2-.04*(x-.05)**2+.035*np.exp(-((x-.57)/.12)**2)
    # Posterior soft-palate component descends to route nasal airflow.
    soft=np.clip((-.36-x)/.19,0,1)
    return z-.18*soft*velum_open


def apply_jaw_hinge(points,angle):
    pts=np.asarray(points,dtype=np.float64);pivot=np.array([-.76,0.,-.40])
    if pts.shape[-1]!=3:raise ValueError('Expected XYZ')
    ca,sa=np.cos(angle),np.sin(angle)
    rot=np.array([[ca,0,sa],[0,1,0],[-sa,0,ca]])
    return (pts-pivot)@rot.T+pivot


def _surface_mesh(top,bottom):
    """NxM top and bottom -> closed tube-like triangular surface."""
    n,m,_=top.shape
    verts=np.concatenate([top.reshape(-1,3),bottom.reshape(-1,3)],axis=0)
    face=[]
    def quad(a,b,c,d):face.extend([(a,b,c),(a,c,d)])
    for layer in (0,n*m):
        for i in range(n-1):
            for j in range(m-1):
                a=layer+i*m+j;b=a+1;c=b+m;d=a+m
                quad(a,b,c,d)
    for i in range(n-1):
        for j in (0,m-1):
            a=i*m+j;b=(i+1)*m+j
            quad(a,b,b+n*m,a+n*m)
    for j in range(m-1):
        for i in (0,n-1):
            a=i*m+j;b=a+1
            quad(a,b,b+n*m,a+n*m)
    return verts,np.array(face,dtype=np.int32)


def tongue_mesh(c:RigControls,nx=23,ny=11):
    """3-D deformable tongue with tip/blade/body/dorsum/root, and palate stops."""
    c.validate()
    xv=np.linspace(-.69,.73,nx);v=np.linspace(-1,1,ny)
    X=np.broadcast_to(xv[:,None],(nx,ny))
    widths=.35*np.sqrt(np.clip(1-((xv+.015)/.85)**2,.06,1.0))
    Y=widths[:,None]*v[None,:]
    keys_x=np.array([-.69,-.45,-.17,.12,.39,.62,.73])
    keys_z=np.array([c.root_z,c.dorsum_z,c.body_z,(c.body_z+c.blade_z)*.5,c.blade_z,c.tip_z,c.tip_z-.025])
    center=np.interp(xv,keys_x,keys_z)
    ztop=center[:,None]-.048*(v[None,:]**2)
    # Coarticulatory constriction for dorsal, apical, and laminal consonants.
    center_x={'alveolar':.62,'post_alveolar':.39,'velar':-.45}.get(c.oral_closure)
    if center_x is not None and c.oral_stricture>.08:
        gauss=np.exp(-((X-center_x)/(.075 if center_x>0 else .12))**2)
        lateral=np.exp(-((Y)/.21)**2)
        palate=palate_height(X,Y,c.velum_open)
        if c.oral_closure=='alveolar' and c.tongue_groove>.2:
            # /s/: center groove remains narrow, lateral surface approaches alveolar ridge.
            groove=np.exp(-(Y/.045)**2)
            desired=palate-.018-.052*c.tongue_groove*groove
        else:desired=palate-.008
        lift=gauss*lateral*c.oral_stricture
        ztop=ztop*(1-lift)+np.maximum(ztop,desired)*lift
    # A hard palate/tongue non-penetration guard; real soft tissue contact needs FEM.
    limit=palate_height(X,Y,c.velum_open)-.007
    raw=ztop.copy();ztop=np.minimum(ztop,limit)
    floor=-.47-.22*c.jaw_rad
    zbottom=np.minimum(ztop-.12,floor+.06*np.cos(v[None,:]*np.pi/2))
    top=np.stack([X,Y,ztop],axis=-1)
    bottom=np.stack([X,Y,zbottom],axis=-1)
    verts,faces=_surface_mesh(top,bottom)
    min_gap=float(np.min(limit-ztop))
    # The closure can be verified numerically at midline for the targeted zone.
    contact_gap=None
    if center_x is not None:
        i=int(np.argmin(abs(xv-center_x)));j=ny//2
        contact_gap=float(palate_height(xv[i],Y[i,j],c.velum_open)-ztop[i,j])
    return verts,faces,{'maxUnclippedPalatePenetration':float(max(0,np.max(raw-limit))),
                         'minPostClampPalateClearance':min_gap,'targetContactGap':contact_gap,
                         'contactPlace':c.oral_closure,'source':'research_preset_not_subject_specific'}


def palate_mesh(c:RigControls,nx=19,ny=9):
    xs=np.linspace(-.77,.77,nx);y=np.linspace(-.49,.49,ny)
    X,Y=np.meshgrid(xs,y,indexing='ij')
    z=palate_height(X,Y,c.velum_open)
    points=np.stack([X,Y,z],axis=-1)
    faces=[]
    for i in range(nx-1):
        for j in range(ny-1):
            a=i*ny+j;b=(i+1)*ny+j;faces.extend([(a,a+1,b),(a+1,b+1,b)])
    return points.reshape(-1,3),np.asarray(faces,dtype=np.int32)


def jaw_lines(c:RigControls):
    y=np.linspace(-.31,.31,15)
    # upper skull bone remains in fixed patient-neutral frame
    jaw0=np.array([[x,0,z] for x,z in [(-.72,-.40),(-.48,-.46),(-.18,-.53),(.18,-.50),(.56,-.48),(.87,-.49)]])
    return apply_jaw_hinge(jaw0,c.jaw_rad)


def teeth_points(c:RigControls):
    ys=np.linspace(-.29,.29,12)
    upper=np.array([[.72+(.08*(1-abs(y/.3))),y,.14] for y in ys])
    lower0=np.array([[.75+(.08*(1-abs(y/.3))),y,-.20] for y in ys])
    return upper,apply_jaw_hinge(lower0,c.jaw_rad)


def lips_mesh(c:RigControls,sections=44):
    th=np.linspace(0,2*np.pi,sections,endpoint=False)
    w=c.lip_width;h=max(.001,c.lip_open)
    center_x=.95+c.lip_protrusion*.34
    outer=np.stack([center_x+.045*np.cos(2*th), (w+.055)*np.cos(th),
           -.06-.25*c.jaw_rad + (h+.072)*np.sin(th)],axis=1)
    inner=np.stack([center_x+.027*np.cos(2*th), w*np.cos(th),
           -.06-.25*c.jaw_rad + h*np.sin(th)],axis=1)
    # Mesh around opening; upper and lower contour are independent in controls.
    vertices=np.vstack([outer,inner]);faces=[]
    for i in range(sections):
        j=(i+1)%sections
        faces.extend([(i,j,i+sections),(j,j+sections,i+sections)])
    return vertices,np.asarray(faces,dtype=np.int32),inner


def observed_geometry(c:RigControls):
    tv,tf,diag=tongue_mesh(c)
    pv,pf=palate_mesh(c)
    lv,lf,opening=lips_mesh(c)
    upper_teeth,lower_teeth=teeth_points(c)
    return {'tongue':(tv,tf),'palate':(pv,pf),'lips':(lv,lf),
            'jawLine':jaw_lines(c),'upperTeeth':upper_teeth,'lowerTeeth':lower_teeth,
            'lipOpeningContour':opening,'diagnostics':diag,'controls':c}


def export_gltf(c:RigControls,output):
    import trimesh
    from pathlib import Path
    scene=trimesh.Scene()
    for name,color in [('tongue',(202,100,133,255)),('palate',(223,213,194,255)),('lips',(207,108,140,255))]:
        points,faces=observed_geometry(c)[name]
        mesh=trimesh.Trimesh(vertices=points,faces=faces,process=False)
        mesh.visual.vertex_colors=np.tile(np.asarray(color,dtype=np.uint8),(len(points),1))
        scene.add_geometry(mesh,geom_name=name)
    # Jaw and teeth are real separate 3D triangles, not lines in the renderer.
    for part,parts in bone_and_teeth_meshes(c).items():
        tone=(230,225,214,255) if part!='mandible' else (211,190,174,255)
        for idx,(verts,facets) in enumerate(parts):
            mesh=trimesh.Trimesh(vertices=verts,faces=facets,process=False)
            mesh.visual.vertex_colors=np.tile(np.asarray(tone,dtype=np.uint8),(len(verts),1))
            scene.add_geometry(mesh,geom_name=f'{part}_{idx}')
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(scene.export(file_type='glb'))
    return output



def muscle_control_proxies(c:RigControls):
    """Uncalibrated commands inspired by muscle functions, not inverse dynamics.

    0..1 controls can guide a later FEM solver, but these are NOT EMG, forces,
    fibre shortening or parameters identified from the owner's videos.
    """
    c.validate()
    clamp=lambda v:float(np.clip(v,0,1))
    nasal=clamp(c.velum_open)
    return {
       'genioglossus_fronting_proxy':clamp((c.tip_z+c.blade_z)/1.2),
       'styloglossus_dorsum_raising_proxy':clamp(c.dorsum_z/.62),
       'hyoglossus_root_lowering_proxy':clamp((.48-c.root_z)/.48),
       'intrinsic_longitudinal_tongue_shape_proxy':clamp(abs(c.tip_z-c.body_z)/.55),
       'orbicularis_oris_pursing_proxy':clamp(c.lip_protrusion/.5),
       'orbicularis_oris_closure_proxy':clamp((.16-c.lip_open)/.16),
       'digastric_jaw_opening_proxy':clamp(c.jaw_rad/.34),
       'masseter_jaw_closing_proxy':clamp((.29-c.jaw_rad)/.29),
       'levator_veli_palatini_closure_proxy':1.-nasal,
       'velum_nasal_opening_proxy':nasal,
       'glottal_aspiration_proxy':clamp(c.glottal_aspiration),
       'glottal_tenseness_proxy':clamp(c.laryngeal_tense),
       'femMuscleForcesSolved':False,
       'ownerElectromyographyMeasured':False,
    }


def _cyl_between(a,b,radius=0.024,sections=8):
    """3D oriented cylinder vertices/faces in the user-independent rig space."""
    a=np.asarray(a,dtype=float);b=np.asarray(b,dtype=float)
    v=b-a;length=float(np.linalg.norm(v))
    if length<1e-9:raise ValueError('zero-length bone segment')
    direction=v/length
    ref=np.array([0.,0.,1.]) if abs(direction[2])<.90 else np.array([0.,1.,0.])
    normal=np.cross(direction,ref);normal/=np.linalg.norm(normal)
    bi=np.cross(direction,normal)
    angles=np.linspace(0,2*np.pi,sections,endpoint=False)
    ring=np.array([np.cos(t)*normal+np.sin(t)*bi for t in angles])*radius
    points=np.vstack([a+ring,b+ring])
    faces=[]
    for i in range(sections):
        j=(i+1)%sections
        faces.extend([(i,j,sections+i),(j,sections+j,sections+i)])
    return points,np.array(faces,dtype=np.int32)


def bone_and_teeth_meshes(c:RigControls):
    """Explicit 3D bone/teeth approximations; upper teeth do NOT rotate."""
    jaw=jaw_lines(c)
    segment_meshes=[]
    for i in range(len(jaw)-1):segment_meshes.append(_cyl_between(jaw[i],jaw[i+1],radius=.025))
    upper,lower=teeth_points(c)
    # Cuboids are pedagogical approximations rather than scans of real teeth.
    meshes={'mandible':segment_meshes}
    for label,points in [('maxillaryTeeth',upper),('mandibularTeeth',lower)]:
        blocks=[]
        for pt in points:
            cube=np.array([[pt[0]+dx,pt[1]+dy,pt[2]+dz] for dx in [-.024,.024] for dy in [-.020,.020] for dz in [-.036,.036]],dtype=float)
            # corners x0y0z0 x0y0z1 x0y1z0 x0y1z1 x1y0z0 ...
            faces=np.array([(0,1,3),(0,3,2),(4,6,7),(4,7,5),(0,4,5),(0,5,1),
                            (2,3,7),(2,7,6),(0,2,6),(0,6,4),(1,5,7),(1,7,3)],dtype=np.int32)
            blocks.append((cube,faces))
        meshes[label]=blocks
    return meshes

def anatomical_status():
    return {'geometrySpace':'normalized illustration, no millimeter calibration',
            'rigHasReal3DSurfaces':True,'rigHasTongueTipBladeBodyDorsumRoot':True,
            'rigHasPalateTongueContactGuard':True,'rigHasJawHinge':True,
            'rigHasTeethLipsVelumGlottalGesture':True,
            'muscleControlProxyChannels':12,
            'realEMGOrFEMSolved':False,
            'personSpecificTongueFit':False,'personSpecificJawPivot':False,
            '3DScannedTeethTongue':False,'realMuscleFiniteElementSolver':False,
            'audioSynthesisFromShape':False,'phonemeTimingValidated':False}
