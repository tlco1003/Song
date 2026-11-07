"""Trainable lyrics + synchronized singing -> temporal face -> full-face pixels.

Own randomly initialized text model; no hosted LLM or emotion dictionary.
Projected surface rig is a differentiable geometric prior, NOT anatomical
muscle force, skull reconstruction, physical tissue simulation or FLAME.
Existing v13/v14 checkpoint architectures remain unchanged.
"""
from __future__ import annotations
import torch
from torch import nn
from torch.nn import functional as F
from .staged_face_v13 import StagedSingingFaceNet, EXPR_IDS
from .full_face_renderer_v14 import FullFaceVocalRenderer, dynamic_region_masks
from .lyric_context_v16 import LyricContextEncoder
from .word_feelings_v15 import LearnedWordFeeling

MODEL_VERSION = "song-vision-contextual-lyrics-singing-face-v16"


class ProjectedSurfaceRig(nn.Module):
    """Jaw hinge proxy plus learned low-rank surface offsets, in crop units.

    234/454 are external surface points, not measured mandibular joints.
    Rotation angle limit .35 rad and .04 displacement are modeling bounds,
    not physiological constants. Learned skin bases need paired supervision.
    """
    def __init__(self, width=64):
        super().__init__()
        self.jaw = nn.Linear(width, 1)
        self.activation = nn.Linear(width, 24)
        self.skin_basis = nn.Parameter(torch.randn(24,478,3)*.001)

    def forward(self, reference_points, context):
        if reference_points.ndim!=3 or reference_points.shape[1:]!=(478,3):
            raise ValueError("Reference surface points must be B x 478 x 3")
        angle = .35 * torch.tanh(self.jaw(context))
        activation = torch.tanh(self.activation(context))
        skin = .04 * torch.tanh(torch.einsum('btk,knc->btnc', activation, self.skin_basis))
        points = reference_points[:,None].expand(-1,context.shape[1],-1,-1)
        hinge = ((reference_points[:,234]+reference_points[:,454])*.5)[:,None,None]
        centered = points-hinge
        y,z = centered[...,1],centered[...,2]
        c,s = torch.cos(angle),torch.sin(angle)
        rotated = torch.stack((centered[...,0],y*c-z*s,y*s+z*c),dim=-1)+hinge
        # Soft lower-face influence derived only from reference geometry.
        weight = torch.sigmoid((reference_points[...,1]-reference_points[:,1:2,1])*18.)
        jaw_delta = (rotated-points)*weight[:,None,:,None]
        return points+jaw_delta+skin, angle, activation, skin


class ContextualSingingFaceNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.audio_face=StagedSingingFaceNet()
        self.renderer=FullFaceVocalRenderer()
        self.audio_context=nn.Sequential(nn.Linear(38+8,64),nn.GELU())
        self.song_encoder=nn.Sequential(nn.Conv1d(88,64,3,padding=1),nn.GELU(),
                                        nn.Flatten(),nn.Linear(64*16,64),nn.GELU())
        self.lyrics=LyricContextEncoder()
        self.word_feeling=LearnedWordFeeling()
        self.lexical_projection=nn.Linear(64,64)
        self.fusion=nn.GRU(128,64,batch_first=True,bidirectional=True)
        self.expression=nn.Linear(128,len(EXPR_IDS))
        self.affect=nn.Linear(128,4)
        self.surface_context=nn.Linear(128+38,64)
        self.rig=ProjectedSurfaceRig()
        self.iris_delta=nn.Linear(128,4)
        # Direct context conditioning in addition to the motion-to-render path.
        self.render_context=nn.Linear(128,38)
        expr_mask=torch.zeros(38); expr_mask[list(EXPR_IDS)]=1.
        self.register_buffer('expression_mask',expr_mask)

    def forward(self, reference, mel, cues, tokens, active, reference_points,
                *, song_context, progress, lexical_codes, lexical_mask, disable_lyrics=False):
        if (mel.ndim!=4 or mel.shape[2:]!=(80,21) or cues.shape!=(*mel.shape[:2],8,61)
                or reference.shape!=(mel.shape[0],3,96,96)
                or reference_points.shape!=(mel.shape[0],478,3)
                or song_context.shape!=(mel.shape[0],88,16) or progress.shape!=mel.shape[:2]
                or not all(torch.isfinite(x).all() for x in (reference,mel,cues,reference_points,song_context,progress))):
            raise ValueError("Expected finite aligned sequence, static face and reference mesh")
        b,t=mel.shape[:2]
        ref=reference[:,None].expand(-1,t,-1,-1,-1).reshape(b*t,3,96,96)
        base=self.audio_face(ref,mel.reshape(b*t,80,21),cues.reshape(b*t,8,61),stage='fusion')
        original=base['motion'].reshape(b,t,38)
        audio=self.audio_context(torch.cat((original,cues.mean(-1)),dim=-1))
        # Whole-track measured spectral/dynamic trajectory supplies musical context.
        # Progress preserves early/late position without fabricated beat/word labels.
        song=self.song_encoder(song_context)[:,None]
        audio=audio+song*(.5+progress[...,None])
        text,_=self.lyrics(tokens,active,audio)
        if (lexical_codes.ndim!=4 or lexical_codes.shape[0]!=b
                or lexical_codes.shape[2:]!=(32,64) or lexical_mask.shape!=lexical_codes.shape[:3]):
            raise ValueError('Invalid chunked lexical inputs')
        chunks=lexical_codes.shape[1]
        lexical=self.word_feeling(lexical_codes.reshape(b*chunks,32,64),lexical_mask.reshape(b*chunks,32))
        lexical_features=lexical['phraseFeature'].reshape(b,chunks,64)
        chunk_mask=lexical_mask.any(-1).to(text.dtype)
        lexical_summary=(lexical_features*chunk_mask[...,None]).sum(1)/chunk_mask.sum(1,keepdim=True).clamp_min(1.)
        text=text+self.lexical_projection(lexical_summary)[:,None]
        if disable_lyrics:
            text=torch.zeros_like(text)
        fused,_=self.fusion(torch.cat((audio,text),dim=-1))
        delta=torch.zeros_like(original)
        delta[...,list(EXPR_IDS)]=.25*torch.tanh(self.expression(fused))
        # Semantic changes cannot directly replace mouth closure/funnel/opening.
        motion=(original+delta).clamp(-2.,2.)
        surface_context=self.surface_context(torch.cat((fused,motion),dim=-1))
        surface,angle,muscle_proxy,skin=self.rig(reference_points,surface_context)
        iris=base['projectedIrisMotion'].reshape(b,t,4)+.1*torch.tanh(self.iris_delta(fused))
        render_motion=motion+.1*torch.tanh(self.render_context(fused))*self.expression_mask
        rendered=self.renderer(ref,mel.reshape(b*t,80,21),cues.reshape(b*t,8,61),
                               render_motion.reshape(b*t,38),iris.reshape(b*t,4))
        # Skin geometry must affect pixels, not be a detached auxiliary head.
        # Smooth inverse sampling field from projected landmark displacement.
        flow=self.surface_flow(reference_points,surface)
        axis=torch.linspace(-1,1,96,device=reference.device,dtype=reference.dtype)
        yy,xx=torch.meshgrid(axis,axis,indexing='ij')
        grid=torch.stack((xx,yy),dim=-1)[None]+flow.reshape(b*t,96,96,2)
        warped=F.grid_sample(rendered,grid,mode='bilinear',padding_mode='border',align_corners=True)
        mask,_=dynamic_region_masks(reference.device)
        pixels=ref*(1.-mask)+warped*mask
        return dict(frames=pixels.reshape(b,t,3,96,96),motion=motion,
                    baseMotion=original,surface=surface,jawAngleProxy=angle,
                    learnedSurfaceActivations=muscle_proxy,skinResidual=skin,
                    portrayedAffect=torch.tanh(self.affect(fused)),
                    consonantLogits=base['consonantLogits'].reshape(b,t,-1),
                    vowelLogits=base['vowelLogits'].reshape(b,t,-1))

    @staticmethod
    def surface_flow(reference_points, predicted):
        # Downsample grid for tractable differentiable radial basis interpolation.
        axis=torch.linspace(0,1,24,device=predicted.device,dtype=predicted.dtype)
        yy,xx=torch.meshgrid(axis,axis,indexing='ij')
        grid=torch.stack((xx,yy),dim=-1).reshape(1,576,1,2)
        distance=((grid-reference_points[:,None,:,:2])**2).sum(-1)
        weights=torch.softmax(-distance/.008,dim=-1)
        # grid_sample is inverse warp: output -> source, hence minus sign.
        displacement=reference_points[:,None,:,:2]-predicted[...,:2]
        flow=2.*torch.einsum('bgn,btnc->btgc',weights,displacement)
        b,t=predicted.shape[:2]
        flow=F.interpolate(flow.reshape(b*t,24,24,2).permute(0,3,1,2),size=(96,96),mode='bilinear',align_corners=True)
        return flow.permute(0,2,3,1).reshape(b,t,96,96,2)
