"""Read-only closeup comparison from v23 face render (no re-training)."""
from pathlib import Path
import json, subprocess
import cv2
import numpy as np

import argparse

def configure(source:Path,output:Path):
    return source,output,output.with_name('_v23_mouth_silent.mp4')


def main(source:Path,output:Path):
    SOURCE,OUT,TEMP=configure(source,output)
    cap=cv2.VideoCapture(str(SOURCE))
    fps=cap.get(cv2.CAP_PROP_FPS)
    count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w,h=1200,520
    writer=cv2.VideoWriter(str(TEMP),cv2.VideoWriter_fourcc(*'mp4v'),fps,(w,h))
    if not writer.isOpened():raise OSError('Video writer unavailable')
    stats=[]
    try:
        for i in range(count):
            ok,frame=cap.read()
            if not ok:break
            # The original v23 scene: face A=[70,470), face B=[610,1010), y=[118,518)
            # Lip+jaw ROI only: preserve the rest of the source in comparison.
            left=frame[385:484,185:355]
            right=frame[385:484,725:895]
            if left.shape!=(99,170,3) or right.shape!=left.shape:
                raise RuntimeError('Corrupt ROI coordinates')
            diff=cv2.absdiff(left,right)
            difference_mask=cv2.applyColorMap(np.clip(diff.mean(axis=2)*28,0,255).astype(np.uint8),cv2.COLORMAP_MAGMA)
            panels=[left,right,difference_mask]
            canvas=np.full((h,w,3),(29,27,35),np.uint8)
            for j,patch in enumerate(panels):
                zoom=cv2.resize(patch,(366,300),interpolation=cv2.INTER_CUBIC)
                canvas[96:396,18+j*396:384+j*396]=zoom
            font=cv2.FONT_HERSHEY_SIMPLEX
            for j,label in enumerate(['OWNER FACE / SOURCE','V23 TEXT-DRIVEN MOUTH','DIFFERENCE MAP x28']):
                cv2.putText(canvas,label,(19+j*396,50),font,.53,(244,239,234),1,cv2.LINE_AA)
            cv2.putText(canvas,'AM 6:30 actual audio; lyric timing draft UNVERIFIED; no measured Korean phone sync',
                        (19,442),font,.56,(243,206,209),1,cv2.LINE_AA)
            cv2.putText(canvas,f'SONG-Vision v23  |  time {i/fps:05.2f}s  |  boundary and rigid zones locked',
                        (19,483),font,.54,(224,225,227),1,cv2.LINE_AA)
            writer.write(canvas)
            stats.append(float(diff.mean()))
    finally:
        cap.release();writer.release()
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
        '-i',str(TEMP),'-i',str(SOURCE),'-map','0:v:0','-map','1:a:0',
        '-c:v','libx264','-threads','2','-preset','ultrafast','-crf','27',
        '-pix_fmt','yuv420p','-c:a','copy','-shortest','-movflags','+faststart',str(OUT)],check=True)
    TEMP.unlink(missing_ok=True)
    return {'file':OUT.name,'frames':len(stats),'fps':fps,
            'meanMouthROIDifferenceRGB255':float(np.mean(stats)),
            'hasVisiblePixelChange':bool(np.mean(stats)>.01),
            'humanVerifiedPhoneAccuracy':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(main(args.source,args.output),ensure_ascii=False,indent=2),flush=True)