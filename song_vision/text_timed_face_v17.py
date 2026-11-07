"""Known-text timing + measured dynamics -> articulation correction on v16.

The base model still learns contextual expression. This branch learns how
unit identity, duration and dynamics jointly change mouth/jaw/surface motion.
No rule maps loudness directly to mouth opening or a word directly to a smile.
New weights need genuine paired performances; code tests are not quality proof.
"""
import torch
from torch import nn
from torch.nn import functional as F
from .contextual_face_v16 import ContextualSingingFaceNet,ProjectedSurfaceRig
from .contextual_training_v16 import forward_batch
from .full_face_renderer_v14 import dynamic_region_masks
from .text_audio_plan_v17 import UNITS,PROSODY_NAMES

MODEL_VERSION='song-vision-given-lyrics-timing-dynamics-face-v17'


def bind_timed_word_context(batch,timing):
    """Bind predicted current words to contextual token attention, never GT labels."""
    import re
    from .lyric_context_v16 import encode_text
    if 'lyricsText' not in timing:
        return batch
    texts=timing['lyricsText']
    if isinstance(texts,str): texts=[texts]
    b,t=batch['mel'].shape[:2]
    if len(texts)!=b or timing['wordIndices'].shape!=(b,t):
        raise ValueError('Given lyrics and predicted word clock must match batch')
    active=torch.zeros_like(batch['active'])
    for bi,text in enumerate(texts):
        encoded=encode_text(text).to(batch['tokens'].device)
        actual=batch['tokens'][bi]; actual=actual[actual!=0]
        if not torch.equal(encoded,actual):
            raise ValueError('Timed lyrics differ from contextual lyrics')
        spans=[(len(text[:m.start()].encode('utf-8')),len(text[:m.end()].encode('utf-8')))
               for m in re.finditer(r'\S+',text)]
        for ti,wi in enumerate(timing['wordIndices'][bi].tolist()):
            if wi == -1: continue
            if not 0<=wi<len(spans): raise ValueError('Word index outside given lyrics')
            a,z=spans[wi]; active[bi,ti,a:z]=True
    return {**batch,'active':active}


class TextTimedSingingFaceNet(nn.Module):
    def __init__(self,base=None):
        super().__init__()
        self.base=base if base is not None else ContextualSingingFaceNet()
        self.rig=ProjectedSurfaceRig()
        self.units=nn.Embedding(len(UNITS),48,padding_idx=0)
        self.dynamics=nn.Sequential(nn.Linear(len(PROSODY_NAMES),32),nn.GELU())
        self.temporal=nn.GRU(80,48,batch_first=True,bidirectional=True)
        self.motion=nn.Linear(96,38)
        self.surface=nn.Sequential(nn.Linear(96+38,64),nn.GELU())
        self.texture=nn.Sequential(nn.Linear(96,24*6*6),nn.GELU(),
                                   nn.Unflatten(1,(24,6,6)),
                                   nn.ConvTranspose2d(24,24,4,2,1),nn.GELU(),
                                   nn.ConvTranspose2d(24,16,4,2,1),nn.GELU(),
                                   nn.ConvTranspose2d(16,8,4,2,1),nn.GELU(),
                                   nn.ConvTranspose2d(8,3,4,2,1),nn.Tanh())

    def freeze_base_for_timing_training(self):
        for parameter in self.base.parameters(): parameter.requires_grad_(False)

    def forward(self,batch,timing):
        b,t=batch['mel'].shape[:2]
        ids=timing['unitIds']; prosody=timing['prosody']; confidence=timing['confidence']
        if (ids.shape!=(b,t) or ids.dtype!=torch.long or prosody.shape!=(b,t,len(PROSODY_NAMES))
                or confidence.shape!=(b,t) or (ids<0).any() or (ids>=len(UNITS)).any()
                or not torch.isfinite(prosody).all() or not torch.isfinite(confidence).all()
                or (confidence<0).any() or (confidence>1).any()):
            raise ValueError('Time-aligned units, dynamics and confidence must match face frames')
        batch=bind_timed_word_context(batch,timing)
        base=forward_batch(self.base,batch)
        context,_=self.temporal(torch.cat((self.units(ids),self.dynamics(prosody)),dim=-1))
        # Low acoustic confidence attenuates uncertain timing-conditioned corrections.
        # This is a confidence gate, not a loudness-to-mouth rule.
        context=context*confidence[...,None]
        delta=.2*torch.tanh(self.motion(context))*confidence[...,None]
        motion=(base['motion']+delta).clamp(-2.,2.)
        surface_context=self.surface(torch.cat((context,motion),dim=-1))
        geometry,angle,activity,skin=self.rig(batch['reference_points'],surface_context)
        displacement=(geometry-batch['reference_points'][:,None])*confidence[...,None,None]
        # Apply only the additional deformation; avoid applying the v16 warp twice.
        extra_surface=batch['reference_points'][:,None]+displacement
        flow=self.base.surface_flow(batch['reference_points'],extra_surface)
        axis=torch.linspace(-1,1,96,device=prosody.device,dtype=prosody.dtype)
        yy,xx=torch.meshgrid(axis,axis,indexing='ij')
        grid=torch.stack((xx,yy),dim=-1)[None]+flow.reshape(b*t,96,96,2)
        pixels=base['frames'].reshape(b*t,3,96,96)
        generated=F.grid_sample(pixels,grid,padding_mode='border',align_corners=True)
        correction=.04*self.texture(context.reshape(b*t,96))*confidence.reshape(b*t,1,1,1)
        region,_=dynamic_region_masks(prosody.device)
        generated=(generated+correction).clamp(0,1)
        frames=pixels*(1-region)+generated*region
        return {**base,'frames':frames.reshape(b,t,3,96,96),'motion':motion,
                'surface':base['surface']+displacement,'timedArticulationDelta':delta,
                'timedUnitIds':ids,'timingConfidence':confidence,
                'alignmentIsReviewedTruth':False}


def conditioned_training_loss(output,batch):
    """Existing paired pixel/surface/velocity/phone losses supervise new branch."""
    from .contextual_training_v16 import supervised_loss
    return supervised_loss(output,batch)
