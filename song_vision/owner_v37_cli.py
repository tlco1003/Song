"""SONG AI v37 train/infer command entrypoint.

This is an offline/secured-server runtime. A GitHub Pages static site cannot
execute private Python weights or access an owner's private recording.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path
import numpy as np,soundfile as sf
from owner_v37_train_real_av import train
from owner_v37_runtime_3d import LearnedOwnerArticulator


def main(argv=None):
    p=argparse.ArgumentParser()
    sub=p.add_subparsers(dest='action',required=True)
    t=sub.add_parser('train');t.add_argument('--video',type=Path,required=True);t.add_argument('--output',type=Path,required=True)
    inf=sub.add_parser('infer');inf.add_argument('--wav',type=Path,required=True);inf.add_argument('--weights',type=Path,required=True)
    inf.add_argument('--mapping',type=Path,required=True);inf.add_argument('--start',type=float,required=True);inf.add_argument('--end',type=float,required=True)
    inf.add_argument('--vowel',default=None);inf.add_argument('--onset',default=None);inf.add_argument('--output',type=Path,required=True)
    args=p.parse_args(argv)
    if args.action=='train':
        out=train(args.video,args.output)
        print(json.dumps({'status':'trained_private_local','summary':out},ensure_ascii=False,indent=2))
    else:
        wav,sr=sf.read(args.wav)
        if wav.ndim!=1:raise ValueError('Expected mono 16k PCM')
        model=LearnedOwnerArticulator(args.weights,args.mapping)
        res=model.predict_rig(wav,sr,args.start,args.end,vowel=args.vowel,onset=args.onset,explicit_prompt=True)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(res,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'status':'preview_controls_generated','path':str(args.output),'owner3DAnatomyLearned':False},ensure_ascii=False))

if __name__=='__main__':main()
