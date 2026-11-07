"""v17 real RAVDESS singing research: disjoint singers, same-audio comparison.

Research-only CC BY-NC-SA 4.0. Original takes stay ephemeral; a short
attributed comparison is intentionally exported for the owner to inspect.
No Korean phoneme timing or commercial inference is established by this run.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader

from .external_ravdess_context_v16 import TRANSCRIPTS, attach_official_context
from .external_ravdess_intensity_v12 import ACTORS, select_condition_balanced_singing, make_v12_manifest
from .external_ravdess_multisinger import download_official_actor_zip
from .real_training import prepare_manifest
from .face_surface_motion import annotate_face_surface_dataset
from .contextual_training_v16 import (ContextualFaceSequences, collate_sequences,
                                      train_contextual, load_contextual, forward_batch)
from .text_audio_plan_v17 import train_given_text_aligner, plan_given_text_vocal
from .text_timed_face_v17 import (TextTimedSingingFaceNet, MODEL_VERSION,
                                  conditioned_training_loss)
from .full_face_renderer_v14 import dynamic_region_masks, region_mae
from .research_vault_v15 import seal_study_model
from .core import decode_audio


class TimedRealSequences(Dataset):
    """Attach PREDICTED v17 alignment to genuine same-source face/audio frames."""
    def __init__(self, prepared: Path, split: str, source_files: dict,
                 aligner: Path):
        self.base=ContextualFaceSequences(prepared/split)
        self.plans={}
        for ci,clip in enumerate(self.base.clips):
            clip_id=clip['index']['clipId']
            if clip_id not in source_files:
                raise ValueError('Missing exact source vocal for '+clip_id)
            vocal=source_files[clip_id]
            if hashlib.sha256(vocal.read_bytes()).hexdigest()!=clip['index']['sourceVocalsSha256']:
                raise ValueError('Video source audio mismatch')
            self.plans[ci]=plan_given_text_vocal(
                vocal, clip['document']['text'], clip['times'], aligner,
                minimum_confidence=0.)
            if self.plans[ci]['alignmentAccuracyValidated']:
                raise ValueError('Predicted alignment may not claim reviewed truth')

    def __len__(self): return len(self.base)

    def __getitem__(self,index):
        ci,ids=self.base.records[index]
        plan=self.plans[ci]
        timing={k:plan[k][ids] for k in
                ('unitIds','wordIndices','prosody','confidence')}
        return self.base[index],timing,plan['lyricsText']


def collate_timed(samples):
    base=collate_sequences([s[0] for s in samples])
    timing={k:torch.stack([s[1][k] for s in samples])
            for k in ('unitIds','wordIndices','prosody','confidence')}
    timing['lyricsText']=[s[2] for s in samples]
    return base,timing


def region_metrics(model, loader):
    model.eval()
    mask,_=dynamic_region_masks()
    totals=dict(v16=0.,v17=0.,staticReference=0.)
    frames=0
    with torch.no_grad():
        for batch,timing in loader:
            got=model(batch,timing)['frames']
            old=forward_batch(model.base,batch)['frames']
            b,t=got.shape[:2]
            pred=got.reshape(-1,3,96,96)
            baseline=old.reshape(-1,3,96,96)
            truth=batch['target'].reshape(-1,3,96,96)
            static=batch['reference'][:,None].expand(-1,t,-1,-1,-1).reshape(-1,3,96,96)
            for name,values in (('v17',pred),('v16',baseline),
                                ('staticReference',static)):
                totals[name]+=float(region_mae(values,truth,mask))*b*t
            frames+=b*t
    if not frames: raise ValueError('No heldout face frames')
    return {**{key:round(val/frames,7) for key,val in totals.items()},
            'frames':frames,
            'beatsV16':totals['v17']<totals['v16'],
            'beatsStaticCopy':totals['v17']<totals['staticReference']}


def render_research_preview(model, timed, source_files, directory: Path):
    """Three-panel *real* holdout preview with the ORIGINAL matching source song."""
    directory.mkdir(parents=True,exist_ok=False)
    ci=0
    clip=timed.base.clips[ci]
    ids_for_clip=[i for i,(index,_) in enumerate(timed.base.records) if index==ci]
    if not ids_for_clip: raise ValueError('No actual heldout frames for preview')
    video=directory/'research-ravdess-v17-v16-recorded-silent.mp4'
    writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'mp4v'),25,(576,192))
    if not writer.isOpened(): raise OSError('Cannot encode actual face comparison')
    times=[]; n=0
    model.eval()
    try:
        with torch.no_grad():
            for idx in ids_for_clip:
                base,timing=collate_timed([timed[idx]])
                v17=model(base,timing)['frames'][0]
                v16=forward_batch(model.base,base)['frames'][0]
                source=base['target'][0]
                for recorded,old,new in zip(source,v16,v17):
                    panels=[]
                    for frame,label in ((recorded,'RECORDED'),(old,'V16 BASE'),(new,'V17 TRAINED')):
                        pixels=(frame.permute(1,2,0).clamp(0,1).numpy()*255).astype(np.uint8)
                        pixels=cv2.resize(pixels,(192,192),interpolation=cv2.INTER_CUBIC)
                        cv2.putText(pixels,label,(4,16),cv2.FONT_HERSHEY_SIMPLEX,.43,
                                    (255,255,255),1,cv2.LINE_AA)
                        cv2.putText(pixels,'RESEARCH ONLY',(4,179),
                                    cv2.FONT_HERSHEY_SIMPLEX,.32,(255,255,255),1,cv2.LINE_AA)
                        panels.append(pixels)
                    writer.write(np.concatenate(panels,axis=1))
                    n+=1
                ci0,frame_ids=timed.base.records[idx]
                times.extend(clip['times'][j] for j in frame_ids)
    finally:
        writer.release()
    if len(times)!=n or not np.allclose(np.diff(times),.04,atol=.002):
        raise ValueError('Do not collapse discontinuous source recording times')
    source=source_files[clip['index']['clipId']]
    raw=decode_audio(source)
    first=int(round(times[0]*16000))
    samples=n*640
    if first+samples>len(raw): raise ValueError('Source vocal truncated')
    mux=directory/'private-lossless-integrity-check.mkv'
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
        '-i',str(video),'-i',str(source),'-map','0:v:0','-map','1:a:0',
        '-af',f'atrim=start_sample={first}:end_sample={first+samples},asetpts=PTS-STARTPTS',
        '-c:v','copy','-c:a','pcm_s16le','-shortest',str(mux)],check=True)
    exact=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
        '-i',str(mux),'-vn','-ac','1','-ar','16000','-f','s16le','-'],
        check=True,capture_output=True).stdout
    signed=(np.clip(raw,-1,1)*32768).round().astype('<i2').tobytes()
    if exact!=signed[2*first:2*(first+samples)]:
        raise ValueError('Preview audio not byte-equal to original source PCM')
    mp4=directory/'SONG_v17_same_audio_real_singer_comparison.mp4'
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
        '-i',str(mux),'-c:v','libx264','-crf','20','-preset','veryfast',
        '-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',
        str(mp4)],check=True)
    # Original research WAV, raw clip, high-fidelity face labels and PCM
    # integrity container are not published. The mp4 is an attributed, lossy
    # viewing derivative under the original research-only sharealike license.
    mux.unlink()
    video.unlink()
    notice=directory/'SOURCE_AND_LIMITATIONS.txt'
    notice.write_text(
        'SOURCE: Livingstone & Russo (2018), RAVDESS, Zenodo 1188976.\n'
        'LICENSE: CC BY-NC-SA 4.0. Noncommercial research viewing only.\n'
        'Three columns are recorded heldout singer / v16 / actually trained v17.\n'
        'Identical source recording and source timestamps for all columns.\n'
        'Video preview transcodes audio to AAC, while a transient PCM audit '
        'verified all '+str(len(exact)//2)+' compared original audio samples.\n'
        'English performed phrases; NO verified Korean song phoneme alignment.\n'
        'This footage and learned weights may NOT be used for paid SONG jobs.\n',
        encoding='utf-8')
    return dict(videoName=mp4.name,sourceAudioSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                startSeconds=times[0],frames=n,fps=25,
                sourcePCMComparedSamples=len(exact)//2,exactSourcePCMVerified=True,
                videoPublicationScope='noncommercial_research_preview',
                audioInMP4Lossy=True)


def run(landmarker: Path,public_key: Path,vault: Path,preview: Path,epochs=2):
    if preview.exists() or (vault.exists() and any(vault.iterdir())):
        raise FileExistsError('Never overwrite research outputs')
    torch.set_num_threads(2)
    with tempfile.TemporaryDirectory(prefix='song-v17-real-research-') as temp:
        root=Path(temp); takes=[]
        for actor in ACTORS:
            archive=root/f'actor-{actor}.zip'
            download_official_actor_zip(actor,archive)
            takes.extend(select_condition_balanced_singing(archive,root,actor))
            archive.unlink()
        manifest=make_v12_manifest(takes,root)
        content=json.loads(manifest.read_text())
        chosen=[c for c in content['clips']
                if c['id'].split('-')[3] in ('03','04')
                and c['id'].split('-')[6]=='01']
        if len(chosen)!=24 or sum(c['split']=='train' for c in chosen)!=16:
            raise ValueError('Only 16 train / 8 heldout official recorded takes')
        content['clips']=chosen
        manifest.write_text(json.dumps(content))
        prepared=root/'prepared'
        prepare_manifest(manifest,prepared,save_acoustic_cues=True)
        annotate_face_surface_dataset(prepared,landmarker,min_coverage=.80)
        attach_official_context(prepared)
        paths={c['id']:root/c['vocals'] for c in chosen}
        # Genuine source WAV + official transcript pairs. CTC alignment is latent,
        # not human-reviewed phone or word alignment.
        records=[(paths[c['id']],TRANSCRIPTS[c['id'].split('-')[5]])
                 for c in chosen if c['split']=='train']
        aligner=root/'v17-english-grapheme-ctc.pt'
        align_report=train_given_text_aligner(records,aligner,epochs=epochs)
        base_checkpoint=root/'v16-fresh-baseline.pt'
        base_report=train_contextual(prepared,base_checkpoint,epochs=1,batch_size=2)
        base,_=load_contextual(base_checkpoint)
        train_data=TimedRealSequences(prepared,'train',paths,aligner)
        val_data=TimedRealSequences(prepared,'val',paths,aligner)
        train_loader=DataLoader(train_data,batch_size=2,shuffle=True,collate_fn=collate_timed)
        val_loader=DataLoader(val_data,batch_size=2,shuffle=False,collate_fn=collate_timed)
        torch.manual_seed(57)
        model=TextTimedSingingFaceNet(base)
        model.freeze_base_for_timing_training()
        parameters=[p for p in model.parameters() if p.requires_grad]
        opt=torch.optim.AdamW(parameters,lr=.0003)
        history=[]
        for epoch in range(epochs):
            model.train();model.base.eval()
            loss_sum=0.;seen=0
            for batch,timing in train_loader:
                output=model(batch,timing)
                loss=conditioned_training_loss(output,batch)
                if not torch.isfinite(loss):raise ValueError('Nonfinite real face loss')
                opt.zero_grad(set_to_none=True);loss.backward()
                torch.nn.utils.clip_grad_norm_(parameters,1.);opt.step()
                seen+=len(batch['reference'])
                loss_sum+=float(loss.detach())*len(batch['reference'])
            metrics=region_metrics(model,val_loader)
            history.append(dict(epoch=epoch+1,trainLoss=loss_sum/seen,**metrics))
            print('SONG_V17_REAL_EPOCH='+json.dumps(history[-1],sort_keys=True),flush=True)
        metrics=region_metrics(model,val_loader)
        preview_report=render_research_preview(model,val_data,paths,preview)
        # Never claim accurate phoneme/timing, meaningful expression or
        # quality pass solely from pixel MAE reductions.
        report=dict(modelVersion=MODEL_VERSION,license='CC-BY-NC-SA-4.0',
            trainActors=['01','02'],heldoutActor='03',trainClips=16,valClips=8,
            trainedOn='real_official_English_singing_video_audio_pairs',
            koreanSingingLearned=False,actualSingerVideoUsed=True,
            ctcTraining=align_report,baseV16=base_report['finalValidation'],
            history=history,heldoutFaceMAE=metrics,sourcePreview=preview_report,
            actualSongFacePairForGithubNara=False,
            alignedPhonesReviewed=False,wordTimingAccuracyValidated=False,
            customerFacing=False,commerciallyValidated=False,canAcceptPaidJobs=False,
            qualityStatus='RESEARCH_ONLY_NOT_KOREAN_LIPSYNC_VALIDATED')
        checkpoint=root/'v17-timed-face-real.pt'
        torch.save(dict(modelVersion=MODEL_VERSION,
            stateDict={k:v.detach().cpu() for k,v in model.state_dict().items()},
            commerciallyValidated=False,sourceDataset='RAVDESS-research-only',
            alignerVocab='english-orthographic-not-phone-labels'),checkpoint)
        checkpoint.with_suffix('.report.json').write_text(
            json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        vault.mkdir(parents=True,exist_ok=False)
        rid=os.getenv('GITHUB_RUN_ID','operator')
        sealed=seal_study_model(checkpoint,checkpoint.with_suffix('.report.json'),public_key,
                    vault/f'song-v17-real-singing-{rid}.svault',
                    dataset='RAVDESS-REAL-SINGING-V17-ENGLISH-CTC',run_id=rid)
        report['encryptedCheckpoint']=sealed
        (preview/'v17_result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        (vault/'v17-study-summary.manifest.json').write_text(
            json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print('SONG_V17_REAL_RESULT='+json.dumps(report,ensure_ascii=False),flush=True)
        return report


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--landmarker-task',required=True,type=Path)
    parser.add_argument('--vault-public-key',required=True,type=Path)
    parser.add_argument('--vault-output-dir',required=True,type=Path)
    parser.add_argument('--preview-output-dir',required=True,type=Path)
    parser.add_argument('--epochs',type=int,default=2)
    parser.add_argument('--acknowledge-noncommercial-research',action='store_true')
    args=parser.parse_args()
    if not args.acknowledge_noncommercial_research:
        parser.error('RAVDESS research-only license acknowledgement is required')
    run(args.landmarker_task,args.vault_public_key,args.vault_output_dir,
        args.preview_output_dir,args.epochs)


if __name__=='__main__': main()
