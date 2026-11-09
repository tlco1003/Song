"""SONG AI v38: real engine input (lyrics + music + still) -> 3D-rigged MP4.

This *calls the owner-trained v37 checkpoint at every rendered time step*, and
uses the existing v35 jaw/lips/tongue control rig. It never substitutes manually
composited samples for neural inference. It does NOT claim person-specific 3D
jaw/tongue anatomy or verified Korean syllable alignment.

Run in the authorized *private* source workspace with the public SONG AI
modules on PYTHONPATH. Private learned weights are never embedded in MP4.
"""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

import cv2
import numpy as np
import soundfile as sf

try:
    from owner_v37_runtime_3d import LearnedOwnerArticulator
    from owner_v35_articulatory_3d import vowel_pose, consonant_pose, tongue_mesh, lips_mesh, teeth_points
except ImportError as exc:
    raise ImportError('SONG AI v35/v37 runtime not installed beside v38 renderer; no silent fallback') from exc

ONSETS = tuple('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ')
VOWELS = tuple('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ')
CODAS = ('',) + tuple('ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ')


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as src:
        for chunk in iter(lambda: src.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def lyric_syllables(lyrics: str) -> list[dict]:
    parts=[]
    for line_no,line in enumerate(unicodedata.normalize('NFC',lyrics).splitlines()):
        for ch in line:
            value=ord(ch)-0xAC00
            if 0<=value<11172:
                lead,rest=divmod(value,588)
                middle,tail=divmod(rest,28)
                parts.append({'glyph':ch,'onset':ONSETS[lead], 'vowel':VOWELS[middle],
                              'coda':CODAS[tail], 'line':line_no})
            elif ch.isspace() or unicodedata.category(ch)[0] in ('P','S'):
                continue
            else:
                raise ValueError(f'Unexpected lyric character U+{ord(ch):04X} at line {line_no+1}: {ch}')
    if not parts:
        raise ValueError('Lyric file has no Hangul syllables')
    return parts


def decode_audio(audio_path:Path,output_path:Path) -> tuple[np.ndarray,int,float]:
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                    '-i',str(audio_path),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(output_path)],
                   check=True)
    wave,sr=sf.read(output_path)
    if wave.ndim!=1 or sr!=16000:
        raise RuntimeError('Expected 16kHz mono wav after ffmpeg decode')
    if not 10<=len(wave)/sr<=1800:
        raise ValueError('Audio must be 10s-30min')
    return wave,sr,len(wave)/sr


def timing_contract(lyrics: list[dict], duration: float, alignment_path:Path|None,
                    allow_preview_draft: bool):
    if alignment_path:
        data=json.loads(alignment_path.read_text(encoding='utf-8'))
        if data.get('schema')!='SONG_AI_VERIFIED_SYLLABLES_V1':
            raise ValueError('Unsupported alignment schema')
        intervals=data.get('syllables')
        if not isinstance(intervals,list) or len(intervals)!=len(lyrics):
            raise ValueError('Timing needs one verified entry per written Hangul syllable')
        prev=0.0
        for syllable,e in zip(lyrics,intervals):
            if e.get('glyph')!=syllable['glyph'] or e.get('source')!='human_verified':
                raise ValueError('Verified timing does not match lyric or lacks human verification')
            a,b=e.get('start'),e.get('end')
            if not all(isinstance(x,(int,float)) and math.isfinite(x) for x in (a,b)):
                raise ValueError('Nonfinite timing')
            if a < prev-1e-6 or b<=a or b>duration+.001:
                raise ValueError('Overlapping or out-of-bounds timing')
            prev=b
        return [(float(e['start']),float(e['end'])) for e in intervals], 'human_verified'
    if not allow_preview_draft:
        raise ValueError('No human-verified syllable alignment. Use --draft-preview for clearly marked research-only video.')
    # A bounded, explicit rough draft. Audio loudness is NEVER used as phoneme
    # identity, and this timing is NOT called speech recognition or forced alignment.
    # Syllable slots spread across a 10-90% song span; replace with verified G2P
    # and temporal alignment before any quality/accuracy claim or production.
    start=min(duration*.10,12.0)
    end=max(start+.1,duration*.90)
    total=end-start
    weights=np.array([1.0 + (.2 if s['coda'] else 0) for s in lyrics],np.float64)
    cumulative=np.r_[0,np.cumsum(weights)];cumulative/=cumulative[-1]
    return [(float(start+total*a),float(start+total*b)) for a,b in zip(cumulative[:-1],cumulative[1:])], 'draft_NOT_aligned'


def load_portrait(photo_path:Path, width:int, height:int):
    img=cv2.imread(str(photo_path))
    if img is None:raise ValueError('Cannot read reference image')
    H,W=img.shape[:2]
    scale=max(width/W,height/H)
    z=cv2.resize(img,(int(math.ceil(W*scale)),int(math.ceil(H*scale))),interpolation=cv2.INTER_AREA if scale<1 else cv2.INTER_CUBIC)
    X=(z.shape[1]-width)//2;Y=(z.shape[0]-height)//2
    img=z[Y:Y+height,X:X+width]
    cascade=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    gray=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
    faces=cascade.detectMultiScale(gray,scaleFactor=1.08,minNeighbors=4,minSize=(max(44,width//10),max(44,width//10)))
    if len(faces)==0:
        raise ValueError('No frontal face detected; cannot safely rig arbitrary photo')
    x,y,w,h=max(faces,key=lambda b:b[2]*b[3])
    if x < 3 or y < 3 or x+w > width-3 or y+h > height-3:
        raise ValueError('Detected face clipped by image border')
    return img,np.array([x,y,w,h],dtype=np.float32)


class Visible3DFaceRenderer:
    """3D XYZ lower-face mesh with jaw hinge and projected oral surfaces.

    The photo is a source texture on the rigid upper face and movable lower
    surface. This is *not* a learned volumetric person-specific renderer; the
    hidden tongue and teeth are v35 research geometry, not measured ground truth.
    """
    def __init__(self,photo:np.ndarray, face_box:np.ndarray):
        self.reference=photo.copy();self.box=face_box
        self.H,self.W=photo.shape[:2]
        y,x=np.mgrid[:self.H,:self.W].astype(np.float32)
        self.xx=x;self.yy=y
        fx,fy,fw,fh=face_box
        self.X=(x-fx)/fw
        self.Y=(y-fy)/fh
        self.mask=np.exp(-.5*((self.X-.50)/.44)**8-.5*((self.Y-.60)/.62)**8).astype(np.float32)
        self.border=np.minimum.reduce([self.X/.08,(1-self.X)/.08,self.Y/.09,(1-self.Y)/.08])
        self.mask*=np.clip(self.border,0,1)
        self.z=.14*np.sqrt(np.clip(1-((self.X-.5)/.56)**2-((self.Y-.46)/.75)**2,0,1))
        self.last=None

    @staticmethod
    def ease(x):
        t=np.clip(x,0,1);return t*t*(3-2*t)

    def _face_skin_from_3d(self,state):
        """Project bone-controlled 3D jaw hinge to camera-plane inverse map."""
        # Positive jaw_rad lowers mandible. x is horizontal across face, y image-down,
        # z depth toward camera. Maxilla/upper nose remain unchanged by construction.
        a=float(state.jaw_rad)
        weight=self.ease((self.Y-.61)/.27)*np.exp(-.5*((self.X-.50)/.43)**6)
        hinge_y=.62
        local_y=np.maximum(0,self.Y-hinge_y)
        local_z=.30+self.z
        projected_down=((local_y*(1-np.cos(a)))+local_z*np.sin(a))*.56
        dy=(projected_down*weight)*float(self.box[3])
        # Orbicularis, buccinator, risorius/zygomatic are *coupled artist controls*.
        # No claim of predicting personal muscle forces or skin elasticity.
        roundness=float(state.lip_protrusion)
        lip_w=float(state.lip_width)
        mid=np.exp(-.5*(((self.X-.5)/.17)**2+((self.Y-.76)/.09)**2))
        cheek=np.exp(-.5*(((np.abs(self.X-.5)-.30)/.13)**2+((self.Y-.65)/.13)**2))
        dx=(.5-self.X)*(roundness*.11) * mid * float(self.box[2])
        dx += (self.X-.5)*(lip_w-.3)*.06*cheek*float(self.box[2])
        dy+=((self.Y-.76)*.13*state.lip_open*mid)*float(self.box[3])
        dx*=self.mask;dy*=self.mask
        remapped=cv2.remap(self.reference,(self.xx-dx).astype(np.float32),
                          (self.yy-dy).astype(np.float32),cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REFLECT_101)
        # Outside face oval, every pixel is identical to original.
        alpha=np.clip(self.mask*1.35,0,1)
        return np.clip(self.reference.astype(np.float32)*(1-alpha[...,None])+
                       remapped.astype(np.float32)*alpha[...,None],0,255).astype(np.uint8)

    def _project_3d_mouth(self,face,state):
        """Project v35 actual 3D lip ring and tooth point cloud onto face image.

        The visible oral cavity is a synthetic unmeasured layer and must be
        marked in metadata, never passed off as the owner's real oral pixels.
        """
        _,_,ring=lips_mesh(state,sections=48)
        upper,lower=teeth_points(state)
        fx,fy,fw,fh=map(float,self.box)
        center_x=fx+fw*.50;center_y=fy+fh*.755
        # v35 X runs rear-to-front; Y is lateral; Z upward.
        def project(mesh):
            mesh=np.asarray(mesh,float)
            factor=np.clip(3.8/(3.8-mesh[:,0]),.70,1.4)
            px=center_x+(mesh[:,1]*fw*.84)*factor
            py=center_y-(mesh[:,2]+.06)*fh*.88*factor
            return np.stack([px,py],axis=1).astype(np.int32)
        r=project(ring)
        if not np.all(np.isfinite(r)):
            raise RuntimeError('Invalid 3D lip projection')
        # Prevent geometry from leaving lower facial envelope, nose, and crop.
        r[:,0]=np.clip(r[:,0],int(fx+.20*fw),int(fx+.80*fw))
        r[:,1]=np.clip(r[:,1],int(fy+.655*fh),int(fy+.865*fh))
        draw=face.copy()
        if state.lip_open>.015:
            overlay=draw.copy()
            cv2.fillPoly(overlay,[r],(41,22,35),lineType=cv2.LINE_AA)
            cv2.addWeighted(overlay,.85,draw,.15,0,draw)
            if state.lip_open>.09:
                t=project(upper);t[:,1]+=int(fh*.008)
                for tx,ty in t:
                    if fy+.685*fh<ty<fy+.835*fh:
                        cv2.ellipse(draw,(int(tx),int(ty)),(max(1,int(fw*.012)),max(1,int(fh*.014))),0,0,360,(208,216,220),-1,cv2.LINE_AA)
        # Red/pink vermillion edge uses the 3D ring, not a copied horizontal line.
        cv2.polylines(draw,[r],True,(118,101,175),max(1,int(fw*.009)),cv2.LINE_AA)
        return draw

    def render(self,state):
        state.validate()
        skinned=self._face_skin_from_3d(state)
        finished=self._project_3d_mouth(skinned,state)
        return finished


def active_interval(intervals:list[tuple[float,float]],t:float):
    # Binary search on sorted start times. None means no lyric is active.
    import bisect
    starts=[r[0] for r in intervals]
    idx=bisect.bisect_right(starts,t)-1
    if idx<0 or t>=intervals[idx][1]:return None
    return idx


def create_mp4(*,audio_path:Path,lyrics_path:Path,image_path:Path,weights_path:Path,
               mapping_path:Path,training_report:Path,output:Path,start:float,seconds:float,
               alignment_path:Path|None=None,draft_preview:bool=False,
               fps:int=24,width:int=512,height:int=512):
    if not (1<=seconds<=120) or fps not in (20,24,25,30):
        raise ValueError('Preview limited to 1-120 seconds, 20/24/25/30 fps')
    if not (256<=width<=1280 and 256<=height<=1280 and width%2==0 and height%2==0):
        raise ValueError('Dimensions must be even and within 256..1280')
    for f in (audio_path,lyrics_path,image_path,weights_path,mapping_path,training_report):
        if not f.is_file() or f.stat().st_size==0:raise FileNotFoundError(f)
    training_data=json.loads(training_report.read_text(encoding='utf-8'))
    if (training_data.get('trainedFromUserVoiceAndVideo') is not True
        or training_data.get('featureRows',0)<100 or training_data.get('observed3DTongue') is not False):
        raise ValueError('A real owner audio/visual training report is required (no demo weights / false tongue claim)')
    with np.load(weights_path,allow_pickle=False) as weight_metadata:
        if 'modelVersion' not in weight_metadata or str(weight_metadata['modelVersion'][0])!='v37_owner_actual_audio_video':
            raise ValueError('Not the owner v37 trained checkpoint')
    lyric=lyrics_path.read_text(encoding='utf-8-sig')
    parts=lyric_syllables(lyric)
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='song_v38_') as td:
        tmp=Path(td)
        wave,sr,duration=decode_audio(audio_path,tmp/'owner_track.wav')
        if start<0 or start+seconds>duration+1e-4:
            raise ValueError(f'Requested clip {start}..{start+seconds}s outside audio {duration}s')
        intervals,align_status=timing_contract(parts,duration,alignment_path,draft_preview)
        model=LearnedOwnerArticulator(weights_path,mapping_path)
        photo,box=load_portrait(image_path,width,height)
        visual=Visible3DFaceRenderer(photo,box)
        writer=cv2.VideoWriter(str(tmp/'silent.mp4'),cv2.VideoWriter_fourcc(*'mp4v'),fps,(width,height))
        if not writer.isOpened():raise RuntimeError('Could not open v38 frame writer')
        n=round(seconds*fps)
        prev=None
        state_records=[];visual_motion=[];prior_frame=None
        try:
            for i in range(n):
                t=start+i/fps
                idx=active_interval(intervals,t)
                if idx is None:
                    # No spurious sounds during gaps; jaw, lip rest still retained.
                    v='ㅡ';onset='ㅇ';fraction=0.
                else:
                    row=parts[idx];v=row['vowel'];onset=row['onset']
                    a,b=intervals[idx];fraction=np.clip((t-a)/max(b-a,.001),0,1)
                # The owner-trained *real* audio model must be called here.
                a=max(0,t-.11);b=min(duration,t+.12)
                inferred=model.predict_rig(wave,sr,a,b,vowel=v,onset=None,explicit_prompt=align_status=='human_verified')
                from owner_v35_articulatory_3d import RigControls
                state=RigControls(**inferred['rigControls'])
                if idx is not None and fraction<.21 and onset!='ㅇ':
                    consonant=consonant_pose(onset,v)
                    state=dataclasses.replace(state,
                      tip_z=(consonant.tip_z*(1-fraction/.21)+state.tip_z*fraction/.21),
                      blade_z=(consonant.blade_z*(1-fraction/.21)+state.blade_z*fraction/.21),
                      dorsum_z=(consonant.dorsum_z*(1-fraction/.21)+state.dorsum_z*fraction/.21),
                      velum_open=(consonant.velum_open*(1-fraction/.21)),
                      glottal_aspiration=consonant.glottal_aspiration*(1-fraction/.21),
                      laryngeal_tense=consonant.laryngeal_tense*(1-fraction/.21),
                      oral_closure=consonant.oral_closure if fraction<.08 else 'none',
                      oral_stricture=consonant.oral_stricture if fraction<.08 else 0.,
                      lip_open=.003 if consonant.oral_closure=='bilabial' and fraction<.13 else state.lip_open)
                # Smooth movement of learned controls, while preserving hard
                # consonant closures and user-provided text identity.
                if prev is not None:
                    tau=.24 if idx is not None else .14
                    state=dataclasses.replace(state,
                        jaw_rad=float(tau*state.jaw_rad+(1-tau)*prev.jaw_rad),
                        lip_width=float(tau*state.lip_width+(1-tau)*prev.lip_width),
                        lip_open=float(tau*state.lip_open+(1-tau)*prev.lip_open))
                state.validate()
                # This is a live 3D tongue computation (not a decorative label).
                # v35 enforces a hard-palate nonpenetration guard on the hidden
                # tongue. The coordinates are articulatory priors, not imaged
                # anatomical labels from the private recording.
                tongue_vertices,tongue_faces,tongue_qa=tongue_mesh(state)
                if len(tongue_vertices)<100 or tongue_qa['minPostClampPalateClearance'] < -1e-6:
                    raise RuntimeError('3D hidden tongue mesh/collision guard failed')
                frame=visual.render(state)
                if prior_frame is not None:
                    region=frame[int(box[1]+box[3]*.65):int(box[1]+box[3]*.94),
                                 int(box[0]+box[2]*.28):int(box[0]+box[2]*.72)]
                    old=prior_frame[int(box[1]+box[3]*.65):int(box[1]+box[3]*.94),
                                    int(box[0]+box[2]*.28):int(box[0]+box[2]*.72)]
                    if region.size:visual_motion.append(float(np.mean(np.abs(region.astype(np.int16)-old.astype(np.int16)))))
                prior_frame=frame
                writer.write(frame)
                if i%max(1,fps//2)==0:
                    state_records.append({'second':round(float(t),3),'glyph':parts[idx]['glyph'] if idx is not None else '',
                      'onset':onset if idx is not None else '', 'vowel':v if idx is not None else '',
                      'jawProxyRad':round(state.jaw_rad,5),'mouthOpening':round(state.lip_open,5),
                      'trainedOwnerAudioModelUsed':inferred['owner2DAudioVisualModelUsed'],
                      'tonguePersonSpecificObserved':False})
                prev=state
        finally:
            writer.release()
        if n>1 and (not visual_motion or np.mean(visual_motion)<.035):
            raise RuntimeError('Video visual articulation appears static; refusing to publish as trained animation')
        final=tmp/'finished.mp4'
        subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(tmp/'silent.mp4'),
                        '-ss',str(start),'-t',str(seconds),'-i',str(audio_path),'-map','0:v:0','-map','1:a:0',
                        '-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-c:a','aac',
                        '-b:a','160k','-t',str(seconds),'-movflags','+faststart',str(final)],check=True)
        if final.stat().st_size<3_000:raise RuntimeError('Encoded video unexpectedly small')
        import shutil
        shutil.copy2(final,output)
    summary={
      'model':'SONG_AI_V38_OWNER_AUDIO_CONDITIONED_3D_FACE_ENGINE',
      'mp4CreatedBySongEngine':True,
      'sourceAudio':audio_path.name,'sourceAudioSHA256':sha256(audio_path),
      'lyrics':lyrics_path.name,'lyricsSHA256':sha256(lyrics_path),
      'portrait':image_path.name,'trainedWeightsSHA256':sha256(weights_path),
      'seconds':seconds,'start':start,'fps':fps,'frameCount':n,
      'videoWidth':width,'videoHeight':height,'videoSizeBytes':output.stat().st_size,
      'mouthMotionAdjacentMAE255':round(float(np.mean(visual_motion)),5),
      'lyricsSyllableCount':len(parts),'lyricsAlignmentStatus':align_status,
      'ownerRealAudioToVisibleFaceWeightsUsed':True,
      'rigCalculatedPerFrame':True,
      'rigJawMotionAndLip3D':True,
      'hidden3DTongueMeshEvaluatedEveryFrame':True,
      'tongueHardPalateContactGuardExecuted':True,
      'v35HiddenTongueIsUnmeasuredPrior':True,
      'faceSkinMotionPhysicallyValidated':False,
      'perPhonemeLipSyncValidated':False,
      'privateOwnerFaceTrainingModelExposedInPublicPage':False,
      'artificialMouthInteriorLayer':True,
      'commercialQualityApproved':False,
      'outputPath':str(output)
    }
    output.with_suffix('.validation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    return summary


def main(argv=None):
    p=argparse.ArgumentParser(description='Actual SONG AI v38 owner-trained 3D MP4 generator')
    for arg in ('audio','lyrics','portrait','weights','mapping','training-report','output'):
        p.add_argument('--'+arg,type=Path,required=True)
    p.add_argument('--alignment',type=Path)
    p.add_argument('--draft-preview',action='store_true',help='Unverified lyric timing for research only')
    p.add_argument('--start',type=float,default=0)
    p.add_argument('--seconds',type=float,default=8)
    p.add_argument('--fps',type=int,default=24)
    p.add_argument('--width',type=int,default=512)
    p.add_argument('--height',type=int,default=512)
    a=p.parse_args(argv)
    res=create_mp4(audio_path=a.audio,lyrics_path=a.lyrics,image_path=a.portrait,
           weights_path=a.weights,mapping_path=a.mapping,training_report=a.training_report,output=a.output,
           start=a.start,seconds=a.seconds,alignment_path=a.alignment,
           draft_preview=a.draft_preview,fps=a.fps,width=a.width,height=a.height)
    print(json.dumps(res,ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
