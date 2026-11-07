"""Executable v16 sequence dataset, training, ablation evaluation and checkpoints."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import Dataset, DataLoader
from .core import tensor_patch, mel_window
from .vocal_acoustics import cue_window
from .lyric_context_v16 import read_lyrics, text_at_times, encode_text, lexical_chunks
from .contextual_face_v16 import ContextualSingingFaceNet, MODEL_VERSION
from .full_face_renderer_v14 import face_region_loss, region_mae, dynamic_region_masks
from .staged_face_v13 import EXPR_IDS, MODEL_VERSION as MOTION_VERSION
from .full_face_renderer_v14 import MODEL_VERSION as RENDER_VERSION
from .phoneme_targets_v13 import read_reviewed_phone_timeline, labels_at_second


class ContextualFaceSequences(Dataset):
    def __init__(self, split_folder: Path, sequence_length=4):
        if type(sequence_length) is not int or not 2 <= sequence_length <= 32:
            raise ValueError("Sequence length must be 2..32")
        self.clips=[]; self.records=[]; self.subjects=set(); self.audio_hashes=set()
        self.text_hashes=set(); self.sequence_length=sequence_length
        for path in sorted(split_folder.glob('*/index.json')):
            folder=path.parent
            index=json.loads(path.read_text(encoding='utf-8'))
            frames=index['frames']; times=[float(x['seconds']) for x in frames]
            if len(frames)<sequence_length+1 or not all(np.isfinite(times)) or any(b<=a for a,b in zip(times,times[1:])):
                raise ValueError("Ordered source video clock required")
            subject=index.get('consentSubjectId')
            if not subject: raise ValueError("Performer identity for disjoint validation required")
            sha=index.get('sourceVocalsSha256','')
            document=read_lyrics(folder/'lyrics-context-v16.json',sha,times[-1])
            with np.load(folder/'face-surface-v1.npz',allow_pickle=False) as data:
                valid=data['valid'].copy(); points=data['surfacePoints'].copy().astype(np.float32)
                motion=np.concatenate((data['motion'],data['expressionMotion']),axis=1).astype(np.float32)
            mel=np.load(folder/'mel.npy',allow_pickle=False)
            cues=np.load(folder/'vocal-cues-v1.npy',allow_pickle=False)
            if (valid.shape!=(len(frames),) or points.shape!=(len(frames),478,3)
                    or motion.shape!=(len(frames),38) or mel.ndim!=2 or mel.shape[0]!=80
                    or cues.shape!=(8,mel.shape[1]) or not all(np.isfinite(x).all() for x in (points[valid],motion[valid],mel,cues))):
                raise ValueError("Corrupt or unaligned real face/audio labels")
            # The source frame is never a target frame; it is fixed per clip.
            good=np.flatnonzero(valid)
            if not len(good): raise ValueError("Missing reference geometry")
            ref=int(good[0]); ref_image=self.image(folder,frames[ref])
            phones_file=folder/'phones-reviewed-v13.json'
            phones=read_reviewed_phone_timeline(phones_file,sha) if phones_file.exists() else None
            ci=len(self.clips)
            self.clips.append(dict(folder=folder,index=index,times=times,document=document,
                                   points=points,motion=motion,mel=mel,cues=cues,ref=ref,
                                   reference=ref_image,phones=phones))
            for start in range(ref+1,len(frames)-sequence_length+1,sequence_length):
                ids=list(range(start,start+sequence_length))
                if valid[ids].all() and np.allclose(np.diff(np.array(times)[ids]),.04,atol=.002):
                    self.records.append((ci,ids))
            self.subjects.add(subject); self.audio_hashes.add(sha)
            self.text_hashes.add(hashlib.sha256(document['text'].encode()).hexdigest())
        if not self.records: raise ValueError("No valid contextual sequence training examples")

    @staticmethod
    def image(folder,row):
        image=cv2.imread(str(folder/'frames'/row['file']))
        if image is None or image.shape!=(96,96,3): raise ValueError("Missing aligned 96px frame")
        return tensor_patch(image)

    def __len__(self): return len(self.records)

    def __getitem__(self,i):
        ci,ids=self.records[i]; clip=self.clips[ci]; times=[clip['times'][j] for j in ids]
        tokens,active,affect,affect_valid=text_at_times(clip['document'],times)
        mel=clip['mel']; cues=clip['cues']
        # True time-shifted source signal, not arbitrary random noise.
        duration=mel.shape[1]*.01
        wrong=[(s+.32)%duration for s in times]
        labels=[labels_at_second(clip['phones'],s) for s in times]
        lexical_codes,lexical_mask=lexical_chunks(clip['document']['text'])
        def windows(array,clock,fn): return torch.from_numpy(np.stack([fn(array,s) for s in clock]))
        return dict(reference=clip['reference'],reference_points=torch.from_numpy(clip['points'][clip['ref']].copy()),
                    mel=windows(mel,times,mel_window),cues=windows(cues,times,cue_window),
                    wrong_mel=windows(mel,wrong,mel_window),wrong_cues=windows(cues,wrong,cue_window),
                    tokens=tokens,active=active,affect=affect,affect_valid=affect_valid,
                    lexical_codes=lexical_codes,lexical_mask=lexical_mask,
                    song_context=F.adaptive_avg_pool1d(torch.from_numpy(np.concatenate((mel,cues),axis=0))[None],16)[0],
                    progress=torch.tensor(times,dtype=torch.float32)/clip["document"]["durationSeconds"],
                    target=torch.stack([self.image(clip['folder'],clip['index']['frames'][j]) for j in ids]),
                    motion=torch.from_numpy(clip['motion'][ids].copy()),surface=torch.from_numpy(clip['points'][ids].copy()),
                    consonants=torch.tensor([p[0] for p in labels]),vowels=torch.tensor([p[1] for p in labels]),
                    clip_index=torch.tensor(ci))


def collate_sequences(items):
    length=max(len(x['tokens']) for x in items)
    result={k:torch.stack([x[k] for x in items]) for k in items[0] if k not in ('tokens','active','lexical_codes','lexical_mask')}
    result['tokens']=torch.stack([F.pad(x['tokens'],(0,length-len(x['tokens']))) for x in items])
    result['active']=torch.stack([F.pad(x['active'],(0,length-len(x['tokens']))) for x in items])
    chunks=max(x['lexical_codes'].shape[0] for x in items)
    result['lexical_codes']=torch.stack([F.pad(x['lexical_codes'],(0,0,0,0,0,chunks-x['lexical_codes'].shape[0])) for x in items])
    result['lexical_mask']=torch.stack([F.pad(x['lexical_mask'],(0,0,0,chunks-x['lexical_mask'].shape[0])) for x in items])
    return result


def forward_batch(model,batch,**kwargs):
    return model(batch['reference'],batch['mel'],batch['cues'],batch['tokens'],batch['active'],batch['reference_points'],song_context=batch['song_context'],progress=batch['progress'],lexical_codes=batch['lexical_codes'],lexical_mask=batch['lexical_mask'],**kwargs)


def supervised_loss(output,batch):
    pred=output['frames']; b,t=pred.shape[:2]
    image=face_region_loss(pred.reshape(-1,3,96,96),batch['target'].reshape(-1,3,96,96))
    surface=F.l1_loss(output['surface'],batch['surface'])
    motion=F.l1_loss(output['motion'],batch['motion'])
    velocity=F.l1_loss(pred[:,1:]-pred[:,:-1],batch['target'][:,1:]-batch['target'][:,:-1])
    geometry_velocity=F.l1_loss(output['surface'][:,1:]-output['surface'][:,:-1],batch['surface'][:,1:]-batch['surface'][:,:-1])
    valid=batch['affect_valid']
    affect=F.l1_loss(output['portrayedAffect'][valid],batch['affect'][valid]) if valid.any() else output['portrayedAffect'].sum()*0.
    phone=pred.sum()*0.
    for key,target in (('consonantLogits','consonants'),('vowelLogits','vowels')):
        label=batch[target].flatten(); available=label!=-100
        if available.any(): phone=phone+F.cross_entropy(output[key].reshape(b*t,-1)[available],label[available])
    # Fitting displacements and changes, rather than smoothing all motion to zero.
    return image+.3*motion+.8*surface+.15*velocity+.2*geometry_velocity+.1*affect+.1*phone+.01*output['skinResidual'].square().mean()


def _counterfactual_lyrics(batch,dataset):
    # Choose a genuinely different transcript; identical strings are not negatives.
    documents=[x['document']['text'] for x in dataset.clips]
    wrong=[]; available=[]; lexical=[]
    for ci in batch['clip_index'].tolist():
        text=documents[ci]
        replacement=next((s for s in documents if s!=text),None)
        available.append(replacement is not None)
        phrase=replacement if replacement is not None else text
        wrong.append(encode_text(phrase)); lexical.append(lexical_chunks(phrase))
    width=max(len(x) for x in wrong)
    tokens=torch.stack([F.pad(x,(0,width-len(x))) for x in wrong]).to(batch['tokens'].device)
    # Compare GLOBAL context symmetrically, not true word timing vs absent timing.
    max_chunks=max(x[0].shape[0] for x in lexical)
    codes=torch.stack([F.pad(x[0],(0,0,0,0,0,max_chunks-len(x[0]))) for x in lexical]).to(tokens.device)
    masks=torch.stack([F.pad(x[1],(0,0,0,max_chunks-len(x[1]))) for x in lexical]).to(tokens.device)
    return tokens,torch.tensor(available,device=tokens.device,dtype=torch.bool),codes,masks


def evaluate_context(model,loader,device='cpu'):
    model.eval(); sums={}; count=wrong_count=affect_count=0
    whole,zones=dynamic_region_masks(device)
    with torch.no_grad():
        for packed in loader:
            batch={k:v.to(device) for k,v in packed.items()}; b,t=batch['mel'].shape[:2]
            out=forward_batch(model,batch)
            no_text=forward_batch(model,batch,disable_lyrics=True)
            shifted=forward_batch(model,{**batch,'mel':batch['wrong_mel'],'cues':batch['wrong_cues']})
            flat=lambda x:x.reshape(-1,3,96,96)
            target=flat(batch['target']); actual=flat(out['frames'])
            mae=lambda x,roi=whole:float(region_mae(flat(x),target,roi))
            values=dict(dynamicROIMAE=mae(out['frames']),copyReferenceMAE=mae(batch['reference'][:,None].expand(-1,t,-1,-1,-1)),
                        withoutLyricsMAE=mae(no_text['frames']),shiftedAudioMAE=mae(shifted['frames']),
                        mouthMAE=mae(out['frames'],zones[2:3]),eyesBrowMAE=mae(out['frames'],zones[0:1]),cheeksMAE=mae(out['frames'],zones[1:2]),
                        surfaceMAE=float(F.l1_loss(out['surface'],batch['surface'])),
                        motionMAE=float(F.l1_loss(out['motion'],batch['motion'])),
                        temporalPixelDeltaMAE=float(F.l1_loss(out['frames'][:,1:]-out['frames'][:,:-1],batch['target'][:,1:]-batch['target'][:,:-1])),
                        lyricOutputSensitivity=float((out['frames']-no_text['frames']).abs().mean()))
            for k,v in values.items(): sums[k]=sums.get(k,0.)+v*b*t
            count+=b*t
            tokens,available,wrong_codes,wrong_masks=_counterfactual_lyrics(batch,loader.dataset)
            if available.any():
                matched_global=forward_batch(model,{**batch,'active':torch.zeros_like(batch['active'])})
                wrong_global=forward_batch(model,{**batch,'tokens':tokens,'active':torch.zeros(b,t,tokens.shape[1],device=device,dtype=torch.bool),'lexical_codes':wrong_codes,'lexical_mask':wrong_masks})
                true=flat(batch['target'][available])
                correct=region_mae(flat(matched_global['frames'][available]),true,whole)
                wrong=region_mae(flat(wrong_global['frames'][available]),true,whole)
                n=int(available.sum())*t
                sums['wrongLyricsGain']=sums.get('wrongLyricsGain',0.)+float(wrong-correct)*n
                wrong_count+=n
            valid=batch['affect_valid']
            if valid.any():
                n=int(valid.sum()); affect_count+=n
                sums['reviewedContextAffectMAE']=sums.get('reviewedContextAffectMAE',0.)+float(F.l1_loss(out['portrayedAffect'][valid],batch['affect'][valid]))*n
    if not count: raise ValueError("No heldout sequences")
    result={k:round(v/count,7) for k,v in sums.items() if k not in ('wrongLyricsGain','reviewedContextAffectMAE')}
    result.update(evaluatedFrames=count,wrongLyricsFrames=wrong_count,
                  wrongLyricsGain=round(sums.get('wrongLyricsGain',0.)/wrong_count,7) if wrong_count else None,
                  reviewedContextAffectFrames=affect_count,
                  reviewedContextAffectMAE=round(sums.get('reviewedContextAffectMAE',0.)/affect_count,7) if affect_count else None)
    return result


def train_contextual(dataset: Path,checkpoint: Path,*,epochs=2,batch_size=2,device='cpu',seed=45,
                     motion_checkpoint=None,renderer_checkpoint=None,word_checkpoint=None,sequence_length=4):
    if checkpoint.exists() or checkpoint.with_suffix('.report.json').exists():
        raise FileExistsError("Preserve previous checkpoints and reports")
    if not 1<=epochs<=30 or not 1<=batch_size<=16: raise ValueError("Invalid train settings")
    torch.manual_seed(seed); np.random.seed(seed); torch.set_num_threads(2)
    train=ContextualFaceSequences(dataset/'train',sequence_length)
    val=ContextualFaceSequences(dataset/'val',sequence_length)
    if train.subjects & val.subjects: raise ValueError("Train/validation performers overlap")
    if train.audio_hashes & val.audio_hashes: raise ValueError("Train/validation audio sources overlap")
    model=ContextualSingingFaceNet().to(device)
    warm={}
    for file,version,module,key in ((motion_checkpoint,MOTION_VERSION,model.audio_face,'motion'),(renderer_checkpoint,RENDER_VERSION,model.renderer,'renderer')):
        if file is not None:
            payload=torch.load(file,map_location='cpu',weights_only=True)
            if payload.get('modelVersion')!=version or payload.get('commerciallyValidated') is not False:
                raise ValueError("Only matching research checkpoint may warm-start")
            module.load_state_dict(payload['stateDict'],strict=True)
            warm[key]=hashlib.sha256(Path(file).read_bytes()).hexdigest()
    if word_checkpoint is not None:
        from .word_feelings_v15 import VERSION as WORD_VERSION
        word_payload=torch.load(word_checkpoint,map_location='cpu',weights_only=True)
        if word_payload.get('modelVersion')!=WORD_VERSION or word_payload.get('commerciallyValidated') is not False:
            raise ValueError('Only matching trained lexical research checkpoint accepted')
        model.word_feeling.load_state_dict(word_payload['stateDict'],strict=True)
        # Preserve learned lexical ratings; face supervision tunes the projection.
        for parameter in model.word_feeling.parameters(): parameter.requires_grad_(False)
        warm['wordFeeling']=hashlib.sha256(Path(word_checkpoint).read_bytes()).hexdigest()
    train_loader=DataLoader(train,batch_size=batch_size,shuffle=True,collate_fn=collate_sequences)
    val_loader=DataLoader(val,batch_size=batch_size,shuffle=False,collate_fn=collate_sequences)
    optimizer=torch.optim.AdamW(model.parameters(),lr=.0003)
    best=float('inf'); history=[]
    for epoch in range(epochs):
        model.train(); total=seen=0
        for packed in train_loader:
            batch={k:v.to(device) for k,v in packed.items()}
            out=forward_batch(model,batch)
            loss=supervised_loss(out,batch)+.01*model.lyrics.masked_language_loss(batch['tokens'])
            if not torch.isfinite(loss): raise ValueError("Nonfinite training loss")
            optimizer.zero_grad(set_to_none=True); loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.); optimizer.step()
            total+=float(loss.detach())*len(batch['reference']); seen+=len(batch['reference'])
        metrics=evaluate_context(model,val_loader,device)
        stats=dict(epoch=epoch+1,trainLoss=round(total/seen,7),**metrics); history.append(stats)
        print('SONG_V16_EPOCH='+json.dumps(stats,sort_keys=True),flush=True)
        if metrics['dynamicROIMAE']<best:
            best=metrics['dynamicROIMAE']; checkpoint.parent.mkdir(parents=True,exist_ok=True)
            torch.save(dict(modelVersion=MODEL_VERSION,stateDict={k:v.detach().cpu() for k,v in model.state_dict().items()},
                            commerciallyValidated=False,sequenceLength=sequence_length,seed=seed,
                            status='research_only_contextual_face',warmStartSha256=warm),checkpoint)
    weights=torch.load(checkpoint,map_location=device,weights_only=True); model.load_state_dict(weights['stateDict'])
    final=evaluate_context(model,val_loader,device)
    overlap=train.text_hashes & val.text_hashes
    flags=['SEMANTIC_GENERALIZATION_NOT_ESTABLISHED','ANATOMICAL_MUSCLES_NOT_VALIDATED','PHOTOREALISM_NOT_VALIDATED']
    if overlap: flags.append('TRAIN_VAL_LYRICS_OVERLAP')
    if final['dynamicROIMAE']>=final['copyReferenceMAE']: flags.append('WORSE_THAN_STATIC_REFERENCE')
    if final['shiftedAudioMAE']<=final['dynamicROIMAE']: flags.append('AUDIO_ALIGNMENT_GAIN_NOT_SHOWN')
    if final['wrongLyricsGain'] is None or final['wrongLyricsGain']<=0: flags.append('CORRECT_LYRICS_ADVANTAGE_NOT_SHOWN')
    if not final['reviewedContextAffectFrames']: flags.append('NO_REVIEWED_CONTEXT_MEANING_TARGETS')
    phone_counts={split:sum(int((ds[i]['consonants']!=-100).sum()+(ds[i]['vowels']!=-100).sum()) for i in range(len(ds))) for split,ds in (('train',train),('val',val))}
    if not phone_counts['train'] or not phone_counts['val']: flags.append('SINGING_PHONE_ACCURACY_NOT_VALIDATED')
    report=dict(modelVersion=MODEL_VERSION,status='research_only_not_lipsync_validated',implementationStatus='implemented_and_trained_research_only',history=history,finalValidation=final,
                trainSequences=len(train),valSequences=len(val),sequenceLength=sequence_length,
                trainDistinctContexts=len(train.text_hashes),valDistinctContexts=len(val.text_hashes),overlappingContexts=len(overlap),
                performerDisjoint=True,audioSourceDisjoint=True,phoneLabeledFrames=phone_counts,
                wordTimingAvailable=all(bool(c['document'].get('words')) for c in train.clips+val.clips),
                semanticGeneralizationValidated=False,physicalMuscleForceInferred=False,photorealismValidated=False,
                commerciallyValidated=False,canAcceptPaidJobs=False,diagnosticFlags=flags,
                checkpointSha256=hashlib.sha256(checkpoint.read_bytes()).hexdigest(),warmStartSha256=warm)
    checkpoint.with_suffix('.report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report


def load_contextual(checkpoint: Path,device='cpu'):
    payload=torch.load(checkpoint,map_location=device,weights_only=True)
    if payload.get('modelVersion')!=MODEL_VERSION or payload.get('commerciallyValidated') is not False:
        raise ValueError("Invalid v16 research checkpoint")
    model=ContextualSingingFaceNet().to(device); model.load_state_dict(payload['stateDict'],strict=True); model.eval()
    return model,payload


def main():
    p=argparse.ArgumentParser(description='Train self-hosted contextual singing-face model')
    p.add_argument('--dataset',type=Path,required=True); p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--epochs',type=int,default=2); p.add_argument('--batch-size',type=int,default=2)
    p.add_argument('--motion-checkpoint',type=Path); p.add_argument('--renderer-checkpoint',type=Path); p.add_argument('--word-checkpoint',type=Path)
    args=p.parse_args(); print(json.dumps(train_contextual(args.dataset,args.checkpoint,epochs=args.epochs,batch_size=args.batch_size,motion_checkpoint=args.motion_checkpoint,renderer_checkpoint=args.renderer_checkpoint,word_checkpoint=args.word_checkpoint),ensure_ascii=False))

if __name__=='__main__': main()
