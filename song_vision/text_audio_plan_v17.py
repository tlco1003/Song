"""Given lyrics + source vocal -> learned CTC timing + measured dynamics.

Hangul decomposition below produces SPELLING units, not verified spoken
phonemes. A supplied/reviewed pronunciation lexicon can replace those units.
Predicted alignments never become human-reviewed training ground truth.
"""
from __future__ import annotations
from dataclasses import dataclass
import math
import unicodedata
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from .vocal_acoustics import CUE_COUNT, CUE_NAMES

ONSETS=tuple('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ')
VOWELS=tuple('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ')
CODAS=('',*tuple('ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'))
UNITS=('<blank>',*dict.fromkeys((*ONSETS,*VOWELS,*CODAS[1:])))
UNIT_TO_ID={s:i for i,s in enumerate(UNITS)}
PROSODY_NAMES=('relativeLevel','attackSlope','releaseSlope','spectralOnset',
               'brightness','flatness','unitProgress','unitDurationSeconds')


@dataclass(frozen=True)
class LyricUnits:
    text: str
    unit_ids: tuple[int,...]
    word_indices: tuple[int,...]
    words: tuple[str,...]
    source: str='orthographic_hangul_not_pronunciation_ground_truth'


def units_from_given_text(text: str) -> LyricUnits:
    """Retain word identity; never invent phonetic assimilation or word timing."""
    if not isinstance(text,str) or not text.strip(): raise ValueError('Given lyrics required')
    text=unicodedata.normalize('NFC',text)
    ids=[]; word_ids=[]; words=text.split()
    if len(text)>8000: raise ValueError('Lyrics too long')
    for wi,word in enumerate(words):
        for char in word:
            n=ord(char)-0xAC00
            if 0<=n<11172:
                onset,rem=divmod(n,21*28); vowel,coda=divmod(rem,28)
                symbols=(ONSETS[onset],VOWELS[vowel],CODAS[coda])
            elif char in UNIT_TO_ID:
                symbols=(char,)
            elif unicodedata.category(char).startswith(('P','S')):
                continue
            else:
                raise ValueError('Supply a supported pronunciation/unit sequence for non-Hangul text')
            for symbol in symbols:
                if symbol:
                    ids.append(UNIT_TO_ID[symbol]); word_ids.append(wi)
    if not ids: raise ValueError('Lyrics contain no supported units')
    return LyricUnits(text,tuple(ids),tuple(word_ids),tuple(words))


class LyricsAcousticAligner(nn.Module):
    """Self-trained audio/unit CTC head; supplied text is the target sequence.

    Needs actual source vocal + transcript pairs to learn weights. Random
    weights or synthetic tests cannot establish timing/phoneme accuracy.
    Input is a 100Hz stream of 80 log-Mel plus 8 measured vocal cue channels.
    """
    def __init__(self):
        super().__init__()
        self.features=nn.Sequential(nn.Conv1d(88,96,5,padding=2),nn.GELU(),
                                    nn.Conv1d(96,96,5,padding=2),nn.GELU())
        self.sequence=nn.GRU(96,64,batch_first=True,bidirectional=True)
        self.head=nn.Linear(128,len(UNITS))

    def forward(self,features,input_lengths=None):
        if features.ndim!=3 or features.shape[1]!=88 or not torch.isfinite(features).all():
            raise ValueError('Expected finite B x 88 x audio_frames')
        encoded=self.features(features).transpose(1,2)
        if input_lengths is not None:
            packed=nn.utils.rnn.pack_padded_sequence(encoded,input_lengths.cpu(),batch_first=True,enforce_sorted=False)
            encoded,_=self.sequence(packed)
            encoded,_=nn.utils.rnn.pad_packed_sequence(encoded,batch_first=True,total_length=features.shape[-1])
        else:
            encoded,_=self.sequence(encoded)
        return F.log_softmax(self.head(encoded),dim=-1)

    def transcript_loss(self,features,input_lengths,targets,target_lengths):
        if input_lengths.shape!=(len(features),) or target_lengths.shape!=(len(features),):
            raise ValueError('CTC lengths must match batch')
        if ((input_lengths<=0).any() or (input_lengths>features.shape[-1]).any()
                or (target_lengths<=0).any() or int(target_lengths.sum())!=targets.numel()
                or targets.ndim!=1 or (targets<=0).any() or (targets>=len(UNITS)).any()):
            raise ValueError('Invalid known-lyrics CTC targets or lengths')
        offset=0
        for n,m in zip(input_lengths.tolist(),target_lengths.tolist()):
            seq=targets[offset:offset+m]; offset+=m
            required=m+int((seq[1:]==seq[:-1]).sum())
            if n<required: raise ValueError('Audio too short for repeated-unit CTC target')
        probs=self(features,input_lengths)
        loss=F.ctc_loss(probs.transpose(0,1),targets,input_lengths,target_lengths,
                        blank=0,reduction='mean',zero_infinity=False)
        if not torch.isfinite(loss): raise ValueError('Nonfinite known-lyrics alignment loss')
        return loss


def forced_align_units(log_probs: torch.Tensor,units: LyricUnits,*,hop_seconds=.01,
                       minimum_confidence=.1,maximum_cells=5_000_000,source_offset_seconds=0.) -> dict:
    """Viterbi CTC alignment constrained to the GIVEN lyric unit sequence.

    Blank frames remain blank. Long vowels may occupy many audio frames;
    no equal-duration word splitting or loudness-threshold word timing.
    Confidence threshold is an engineering control, not a calibrated accuracy.
    """
    x=log_probs.detach().to('cpu',dtype=torch.float64)
    ids=units.unit_ids
    if (x.ndim!=2 or x.shape[0]<1 or x.shape[1]!=len(UNITS) or not torch.isfinite(x).all()
            or not math.isfinite(hop_seconds) or hop_seconds<=0
            or not 0<=minimum_confidence<=1 or not math.isfinite(source_offset_seconds) or source_offset_seconds<0 or not ids
            or len(ids)!=len(units.word_indices)
            or any(type(i) is not int or not 0<i<len(UNITS) for i in ids)
            or any(type(i) is not int or not 0<=i<len(units.words) for i in units.word_indices)):
        raise ValueError('Invalid source acoustic probabilities or given lyrics')
    if not torch.allclose(torch.logsumexp(x,-1),torch.zeros(len(x),dtype=x.dtype),atol=1e-4):
        raise ValueError('Expected normalized acoustic log probabilities')
    states=[0]
    for unit in ids: states.extend((unit,0))
    t,n=x.shape[0],len(states)
    if t*n>maximum_cells: raise ValueError('Align in a bounded verse window with an explicit source-time offset')
    neg=-float('inf'); score=torch.full((n,),neg,dtype=x.dtype)
    score[0]=x[0,0]; score[1]=x[0,states[1]]
    back=torch.full((t,n),-1,dtype=torch.int8)
    state_symbols=torch.tensor(states,dtype=torch.long)
    can_skip=torch.zeros(n,dtype=torch.bool)
    for j in range(2,n): can_skip[j]=states[j]!=0 and states[j]!=states[j-2]
    for time in range(1,t):
        stay=score
        advance=F.pad(score[:-1],(1,0),value=neg)
        skip=F.pad(score[:-2],(2,0),value=neg).masked_fill(~can_skip,neg)
        best,choice=torch.stack((stay,advance,skip)).max(dim=0)
        score=best+x[time,state_symbols]; back[time]=choice.to(torch.int8)
    final=n-1 if score[-1]>=score[-2] else n-2
    if not torch.isfinite(score[final]): raise ValueError('No feasible alignment for the supplied lyrics')
    path=[]; j=final
    for time in range(t-1,-1,-1):
        path.append(j)
        if time: j-=int(back[time,j])
    path.reverse()
    segments=[]; frame_unit=[]; frame_token=[]
    for state in path:
        frame_unit.append(states[state]); frame_token.append((state-1)//2 if state%2 else -1)
    confidences=[]
    for i,unit in enumerate(ids):
        times=[f for f,state in enumerate(path) if state==2*i+1]
        if not times: raise ValueError('Given lyric unit was not aligned')
        confidence=float(x[times,unit].exp().mean()); confidences.append(confidence)
        segments.append(dict(unitId=unit,unit=UNITS[unit],wordIndex=units.word_indices[i],
                             startSeconds=source_offset_seconds+times[0]*hop_seconds,endSeconds=source_offset_seconds+(times[-1]+1)*hop_seconds,
                             confidence=confidence))
    if min(confidences)<minimum_confidence:
        raise ValueError('Low-confidence predicted lyric alignment; do not invent precise timings')
    return dict(status='model_predicted_alignment_not_reviewed_truth',unitSource=units.source,
                hopSeconds=hop_seconds,sourceOffsetSeconds=source_offset_seconds,segments=segments,frameUnitIds=frame_unit,
                frameTokenIndices=frame_token,minimumUnitConfidence=min(confidences),
                humanReviewed=False)


def plan_at_video_times(alignment: dict,cues: np.ndarray,seconds) -> dict:
    """Sample unit timing and vocal dynamics on the SAME source-audio clock."""
    cues=np.asarray(cues,dtype=np.float32)
    hop=alignment['hopSeconds']; offset=alignment.get('sourceOffsetSeconds',0.); units=alignment['frameUnitIds']; tokens=alignment['frameTokenIndices']
    if (cues.ndim!=2 or cues.shape[0]!=CUE_COUNT or cues.shape[1]!=len(units)
            or len(tokens)!=len(units) or not np.isfinite(cues).all()):
        raise ValueError('Vocal dynamics and alignment must share one audio frame clock')
    ids=[]; word_ids=[]; values=[]; confidence=[]
    segments=alignment['segments']
    for second in seconds:
        if not math.isfinite(second) or not offset<=second<offset+len(units)*hop:
            raise ValueError('Face timestamp outside source vocal alignment')
        frame=min(int(math.floor((second-offset)/hop+1e-7)),len(units)-1)
        token=tokens[frame]; unit=units[frame]; cue=cues[:,frame]
        if token>=0:
            segment=segments[token]; duration=segment['endSeconds']-segment['startSeconds']
            progress=(second-segment['startSeconds'])/duration
            word=segment['wordIndex']; conf=segment['confidence']
        else: duration=progress=conf=0.; word=-1
        ids.append(unit); word_ids.append(word); confidence.append(conf)
        # Relative recording level is NOT calibrated vocal effort or muscle force.
        values.append((cue[0],max(0.,float(cue[1])),max(0.,-float(cue[1])),
                       cue[2],cue[3],cue[7],min(1.,max(0.,progress)),duration))
    return dict(unitIds=torch.tensor(ids,dtype=torch.long),wordIndices=torch.tensor(word_ids),
                prosody=torch.tensor(values,dtype=torch.float32),confidence=torch.tensor(confidence),
                prosodyNames=PROSODY_NAMES,sourceTimeSeconds=torch.tensor(seconds),
                timingSource='predicted_ctc_not_reviewed_truth')

ALIGN_VERSION='song-known-lyrics-audio-ctc-v17'


def source_audio_features(vocal_file):
    from .core import decode_audio,audio_features
    from .vocal_acoustics import analyze_vocal_cues
    audio=decode_audio(vocal_file)
    mel=audio_features(audio); cues=analyze_vocal_cues(audio)
    if mel.shape[1]!=cues.shape[1]: raise ValueError('Source audio clocks disagree')
    return torch.from_numpy(np.concatenate((mel,cues),axis=0)),cues


def train_given_text_aligner(records,checkpoint,*,epochs=2):
    """Train on actual (vocal path, given transcript) pairs without word timing.

    Training transcriptions are supervision; alignment accuracy requires an
    independent reviewed timing set. This routine does not claim that accuracy.
    """
    from pathlib import Path
    import hashlib,json
    checkpoint=Path(checkpoint)
    if checkpoint.exists() or checkpoint.with_suffix('.report.json').exists():
        raise FileExistsError('Preserve prior alignment checkpoints')
    if not records or not 1<=epochs<=30: raise ValueError('Source vocal/transcript records required')
    torch.manual_seed(47); torch.set_num_threads(2)
    examples=[]; hashes=set()
    for vocal,text in records:
        vocal=Path(vocal); sha=hashlib.sha256(vocal.read_bytes()).hexdigest()
        if sha in hashes: raise ValueError('Duplicate source vocal training records')
        hashes.add(sha); units=units_from_given_text(text); features,_=source_audio_features(vocal)
        if features.shape[1]>6000: raise ValueError('Train on source-time-bounded vocal/lyric verses up to 60s')
        examples.append((features,torch.tensor(units.unit_ids,dtype=torch.long)))
    model=LyricsAcousticAligner(); opt=torch.optim.AdamW(model.parameters(),lr=.0003)
    steps=0; history=[]
    for epoch in range(epochs):
        model.train(); total=0.
        for features,targets in examples:
            loss=model.transcript_loss(features[None],torch.tensor([features.shape[1]]),targets,torch.tensor([len(targets)]))
            opt.zero_grad(set_to_none=True); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(),1.); opt.step()
            steps+=1; total+=float(loss.detach())
        history.append(dict(epoch=epoch+1,meanTrainingCTCLoss=total/len(examples)))
    checkpoint.parent.mkdir(parents=True,exist_ok=True)
    torch.save(dict(modelVersion=ALIGN_VERSION,stateDict=model.state_dict(),trainingSteps=steps,
                    unitVocabulary=UNITS,commerciallyValidated=False,timingAccuracyValidated=False),checkpoint)
    report=dict(modelVersion=ALIGN_VERSION,trainingPairs=len(examples),trainingSteps=steps,history=history,
                targetSource='given_lyrics_orthographic_hangul_not_verified_phone_boundaries',
                wordTimingAccuracyValidated=False,phonemeAccuracyValidated=False,
                sourceAudioSha256=sorted(hashes),commerciallyValidated=False)
    checkpoint.with_suffix('.report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    return report


def plan_given_text_vocal(vocal_file,text,video_seconds,alignment_checkpoint,*,minimum_confidence=.1):
    """Public input contract: given lyrics + actual vocal + video clock -> plan."""
    import hashlib
    from pathlib import Path
    payload=torch.load(alignment_checkpoint,map_location='cpu',weights_only=True)
    if (payload.get('modelVersion')!=ALIGN_VERSION or payload.get('trainingSteps',0)<=0
            or tuple(payload.get('unitVocabulary',()))!=UNITS
            or payload.get('commerciallyValidated') is not False):
        raise ValueError('Matching actually trained research alignment checkpoint required')
    features,cues=source_audio_features(vocal_file); units=units_from_given_text(text)
    model=LyricsAcousticAligner(); model.load_state_dict(payload['stateDict'],strict=True); model.eval()
    with torch.no_grad(): log_probs=model(features[None])[0]
    alignment=forced_align_units(log_probs,units,minimum_confidence=minimum_confidence)
    plan=plan_at_video_times(alignment,cues,video_seconds)
    plan.update(alignment=alignment,lyricsText=units.text,
                vocalSha256=hashlib.sha256(Path(vocal_file).read_bytes()).hexdigest(),
                alignmentAccuracyValidated=False)
    return plan
