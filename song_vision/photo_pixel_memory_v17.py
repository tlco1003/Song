"""Frame-by-frame pixel learning from a single permitted reference photograph.

The acoustic v17 model predicts initial face pixels; this distinct, trainable
memory stage learns HOW frame t should inherit identity from the original
photo and motion from the previous generated frame. It never reads a ground
truth target during inference. Both source frames and supervised video targets
are real, but no anatomical or phoneme accuracy is claimed from this alone.

Only 96x96 research frames are supported; bicubic upscaling is NOT HD detail.
"""
from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional as F
from .full_face_renderer_v14 import dynamic_region_masks, face_region_loss

MODEL_VERSION="song-vision-v17-photo-pixel-temporal-memory-v1"


class PhotoPixelFrameMemory(nn.Module):
    """Learned reference/photo and previous-frame pixel conditioning.

    State is local to one call; it resets for each clip/sequence. Current
    source-audio conditioning comes entirely from the upstream v17 network.
    The network cannot observe future target frames or original singer identity.
    """
    def __init__(self):
        super().__init__()
        self.motion_flow=nn.Linear(38,2*8*8)
        self.refine=nn.Sequential(
            nn.Conv2d(12,32,3,padding=1),nn.GELU(),
            nn.Conv2d(32,32,3,padding=1),nn.GELU(),
            nn.Conv2d(32,24,3,padding=1),nn.GELU(),
            nn.Conv2d(24,4,3,padding=1),
        )
        self.register_buffer("schema_version",torch.tensor([1],dtype=torch.long))

    def forward(self,reference,raw_frames,motions):
        if (reference.ndim!=4 or reference.shape[1:]!=(3,96,96)
                or raw_frames.ndim!=5 or raw_frames.shape[0]!=reference.shape[0]
                or raw_frames.shape[2:]!=(3,96,96)
                or motions.shape!=(*raw_frames.shape[:2],38)
                or raw_frames.shape[1]<1
                or not all(torch.isfinite(x).all() for x in
                           (reference,raw_frames,motions))):
            raise ValueError("Reference photo, consecutive face frames and 38D motion required")
        b,t=raw_frames.shape[:2]
        mask,_=dynamic_region_masks(reference.device)
        mask=mask.to(dtype=reference.dtype).expand(b,-1,-1,-1)
        axis=torch.linspace(-1,1,96,device=reference.device,dtype=reference.dtype)
        yy,xx=torch.meshgrid(axis,axis,indexing="ij")
        coords=torch.stack((xx,yy),dim=-1)[None]
        previous=reference
        old_motion=motions[:,0]
        output=[]
        for frame in range(t):
            current=raw_frames[:,frame]
            delta=motions[:,frame]-old_motion
            flow=self.motion_flow(delta).reshape(b,2,8,8)
            flow=.025*torch.tanh(F.interpolate(flow,size=(96,96),
                                                mode="bilinear",align_corners=True))
            warped=F.grid_sample(previous,coords+flow.permute(0,2,3,1),
                                 mode="bilinear",padding_mode="border",
                                 align_corners=True)
            inp=torch.cat((reference,current,warped,mask,flow),dim=1)
            learned=self.refine(inp)
            # Limited recurrent carry prevents freezing the face to the
            # reference image. Pixel residual learns corrections from actual
            # paired video targets and can improve or degrade heldout MAE.
            carry=.35*torch.sigmoid(learned[:,3:4])
            corrected=((1.-carry)*current+carry*warped+
                        .12*torch.tanh(learned[:,:3])).clamp(0.,1.)
            result=current*(1.-mask)+corrected*mask
            output.append(result)
            previous=result
            old_motion=motions[:,frame]
        return torch.stack(output,dim=1)


def supervised_pixel_memory_loss(predicted,raw,truth):
    """Genuine frame-level photo loss plus velocity and small residual prior."""
    if predicted.shape!=raw.shape or predicted.shape!=truth.shape:
        raise ValueError("Pixel memory supervision requires aligned video truth")
    if not torch.isfinite(truth).all():
        raise ValueError("Invalid source face target")
    b,t=predicted.shape[:2]
    still=face_region_loss(predicted.reshape(-1,3,96,96),
                           truth.reshape(-1,3,96,96))
    residual=(predicted-raw).abs().mean()
    velocity=(F.l1_loss(predicted[:,1:]-predicted[:,:-1],
                        truth[:,1:]-truth[:,:-1]) if t>1 else
              predicted.sum()*0.)
    return still+.15*velocity+.015*residual
