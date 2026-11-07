"""Render an actual AM 6:30 audio+text experiment under conservative v23 face guards.

The real lyrics are source text. Every cue is UNREVIEWED estimated draft: the
result is visually inspectable but MUST NOT be described as accurate singing
synchronization. Audio affects the jaw opening magnitude only.
"""
from __future__ import annotations
import argparse, hashlib, json, math, subprocess, time
from pathlib import Path
import numpy as np
import cv2
from PIL import Image,ImageDraw,ImageFont
try:
    from .owner_v22_constrained_viseme import load_face_frame,learn_owner_motion_caps,pose_at
    from .owner_v23_lyrics_safeguarded import (FULL_LYRICS_EXCERPT,make_draft_intervals,face_warp_safeguarded,classify_displacements)
except ImportError:
    from owner_v22_constrained_viseme import load_face_frame,learn_owner_motion_caps,pose_at
    from owner_v23_lyrics_safeguarded import (FULL_LYRICS_EXCERPT,make_draft_intervals,face_warp_safeguarded,classify_displacements)
try:
    from .owner_v21_audio_loudness import mono_from_audio,rms_envelope
except ImportError:
    try:
        from owner_v21_audio_loudness import mono_from_audio,rms_envelope
    except ImportError:
        from sys import path as syspath
        syspath.insert(0,str(Path(__file__).resolve().parent.parent/'song_v21_src'))
        from owner_v21_audio_loudness import mono_from_audio,rms_envelope

FONTS='/usr/share/fonts/truetype/nanum/'

def font(name:str,size:int):
    return ImageFont.truetype(str(Path(FONTS)/name),size)


def render(song:Path,owner_video:Path,training_videos:list[Path],destination:Path,
           fps=25.,duration=14.0):
    destination.mkdir(parents=True,exist_ok=True)
    clock=time.monotonic()
    print('PHASE 1 motion caps',round(time.monotonic()-clock,2),flush=True)
    caps_report=learn_owner_motion_caps(training_videos, destination/'owner_v23_motion_caps.json')
    print('PHASE 1 complete',round(time.monotonic()-clock,2),flush=True)
    caps=caps_report['caps']
    face=load_face_frame(owner_video,second=.2,size=400)
    timeline=make_draft_intervals(song_start=.75,line_seconds=(5.7,6.0),between_lines=.35)
    print('PHASE 2 audio decode',flush=True)
    samples=mono_from_audio(song)
    print('PHASE 2 audio decoded',len(samples),flush=True)
    sound=rms_envelope(samples)
    print('PHASE 2 rms complete',round(time.monotonic()-clock,2),flush=True)
    assert timeline[-1].end < duration
    silent=destination/'_owner_v23_silent_intermediate.mp4'
    video=destination/'AM630_v23_TEXT_FIRST_CONSTRAINED_FACE_UNALIGNED.mp4'
    writer=cv2.VideoWriter(str(silent),cv2.VideoWriter_fourcc(*'mp4v'),float(fps),(1080,760))
    if not writer.isOpened():raise OSError('Cannot create review video')
    fhead=font('NanumSquareB.ttf',37)
    fbody=font('NanumSquareR.ttf',23)
    fsmall=font('NanumSquareR.ttf',18)
    frame_count=round(duration*fps)
    # Cache all Korean font rendering once; per-frame drawing is NumPy/OpenCV only.
    tile_glyphs=sorted({cue.syllable.glyph for cue in timeline}|{'—'})
    static_tiles={}
    for glyph in tile_glyphs:
        card=Image.new('RGB',(1080,760),(21,27,34))
        draw=ImageDraw.Draw(card)
        draw.text((70,22),'내 스피킹 영상 · 기준 얼굴',font=fhead,fill=(235,231,222))
        draw.text((610,22),'AM 6:30 · 가사 기반 v23',font=fhead,fill=(199,241,235))
        draw.text((70,541),'원본 사진 / 고정된 얼굴 경계',font=fbody,fill=(225,217,228))
        draw.text((610,541),f'글자: {glyph}',font=fbody,fill=(252,236,174))
        draw.text((70,590),'어두운 밤이 지나면',font=fbody,fill=(230,225,232))
        draw.text((70,632),'아침은 다시 찾아오겠지',font=fbody,fill=(230,225,232))
        draw.text((70,703),'시간 정렬 미검증 · 가사 시작 시각 초안 · 실제 해부학 3D 아님',font=fsmall,fill=(243,176,168))
        draw.rectangle((70,673,1010,679),fill=(65,63,74))
        static_tiles[glyph]=cv2.cvtColor(np.asarray(card),cv2.COLOR_RGB2BGR)
    print('CACHED TEXT TILES',round(time.monotonic()-clock,2),flush=True)
    face_motion=[];surfaces=[];current_syllables=[];energy_sample=[]
    previous=None
    try:
        for i in range(frame_count):
            if i%50==0: print('PHASE 3 render frame',i,'/',frame_count,'elapsed',round(time.monotonic()-clock,2),flush=True)
            t=i/fps
            energy=float(sound.at(t))
            pose,status=pose_at(timeline,t,energy=energy)
            warped,meta=face_warp_safeguarded(face,pose,caps)
            metric=classify_displacements(face,warped)
            if any(metric[k]!=0. for k in ('outsideFacePixelDifference','boundaryPixelDifference','rigidCorePixelDifference')):
                raise RuntimeError('Face safety guard violated at frame '+str(i))
            if previous is not None:
                face_motion.append(float(np.mean(np.abs(warped.astype(np.float32)-previous.astype(np.float32)))))
            previous=warped
            if i%25==0:surfaces.append({'t':round(t,2),'glyph':status.get('glyph',''),
                 'vowel':status.get('vowel',''),'energy':round(energy,4),
                 'mouthPixelDelta':round(metric['mouthPixelDifference'],4),
                 'jawPixelDelta':round(metric['jawPixelDifference'],4),
                 'maxSourceDisplacementPx':round(meta['maxDisplacementPx'],4)})
            current_syllables.append(status.get('glyph') or '')
            energy_sample.append(energy)
            card=static_tiles[status.get('glyph') or '—'].copy()
            card[118:518,70:470]=face
            card[118:518,610:1010]=warped
            cv2.putText(card,f'vowel: {status.get("vowel") or "REST"}  RMS: {energy:.2f}',
                (610,597),cv2.FONT_HERSHEY_SIMPLEX,.50,(235,221,221),1,cv2.LINE_AA)
            cv2.putText(card,f'00:{t:05.2f}  boundary 0px  RIGID CORE 0px',
                (610,636),cv2.FONT_HERSHEY_SIMPLEX,.48,(234,201,219),1,cv2.LINE_AA)
            cv2.rectangle(card,(70,673),(70+int((i+1)/frame_count*940),679),(202,175,213),-1)
            writer.write(card)
    finally:writer.release()
    print('PHASE 3 video frames encoded',flush=True)
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
        '-i',str(silent),'-ss','0','-t',str(duration),'-i',str(song),'-map','0:v:0','-map','1:a:0',
        '-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-crf','27','-preset','ultrafast',
        '-c:a','aac','-b:a','112k','-shortest','-movflags','+faststart',str(video)],check=True)
    silent.unlink(missing_ok=True)
    estimated_events=[{'glyph':cue.syllable.glyph,'vowel':cue.syllable.vowel,
                       'start':round(cue.start,3),'end':round(cue.end,3),
                       'source':'estimated_unreviewed_not_aligned'} for cue in timeline]
    (destination/'AM630_v23_LYRICS_TIMING_DRAFT_NOT_VERIFIED.json').write_text(
        json.dumps({'source':'AM630 published source lyric TXT, unreviewed editor timings',
                    'audioFilename':song.name,'previewSongClockStart':0,
                    'lines':list(FULL_LYRICS_EXCERPT),'verified':False,
                    'events':estimated_events},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    report={
      'version':'SONG_v23_lyric_text_and_owner_motion_caps',
      'status':'RESEARCH_PREVIEW_UNALIGNED_NOT_PRODUCTION_LIPSYNC',
      'sourceOwnerVideo':owner_video.name,
      'sourceOwnerVideoSHA256':hashlib.sha256(owner_video.read_bytes()).hexdigest(),
      'audioSong':'AM 6:30','audioSHA256':hashlib.sha256(song.read_bytes()).hexdigest(),
      'verifiedActualSongPhonemeTimes':False,
      'usedExactSourceLyricText':True,'lyrics':list(FULL_LYRICS_EXCERPT),
      'syllables':len(timeline),'estimatedStarts':True,
      'audioControls':'only_relative_jaw_opening_amplitude_not_vowel_identity',
      'observedOwnerMotionCaps':caps_report,'fps':fps,'frames':frame_count,
      'duration':duration,'video':video.name,'encodedIncludesOriginalAudio':True,
      'averageAdjacentFaceChangeRGB255':round(float(np.mean(face_motion)),6),
      'observedGuardViolations':0,
      'boundaryAndRigidStillPixelGuard':'strict 0 in face crop for every frame',
      'actualFaceMask':'conservative oval proxy not individual face outline landmarks',
      'localJawRotation':'2D approximation NOT 3D temporomandibular mechanics',
      'surfaceSamples':surfaces,
      'recordedUserVowelGroundTruthMatched':False,
      'statusProductionApproved':False,
    }
    (destination/'SONG_V23_AM630_FACE_SAFETY_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--song',type=Path,required=True)
    ap.add_argument('--owner-video',type=Path,required=True)
    ap.add_argument('--training-videos',nargs='+',type=Path,required=True)
    ap.add_argument('--output',type=Path,required=True)
    a=ap.parse_args()
    r=render(a.song,a.owner_video,a.training_videos,a.output)
    print(json.dumps({k:r[k] for k in ['version','frames','duration','video','averageAdjacentFaceChangeRGB255','observedGuardViolations','verifiedActualSongPhonemeTimes']},ensure_ascii=False,indent=2))