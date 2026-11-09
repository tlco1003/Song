"""Owner-only self-supervised 2D observed-skin-motion prior (NOT personal 3D bone fit).

Learn a low-rank basis of registered lower-face optical-flow fields from the
owner's clips. Chronological recording/session split is used for a probe;
projection to heldout flow is diagnostic (it uses heldout target flow), not an
audio-conditioned forecasting claim. No phoneme labels are invented.
"""
from __future__ import annotations
import json,sys
from pathlib import Path
import numpy as np,cv2
from owner_v32_oral_segmentation import OwnerMouthAtlas

ROOT=Path(__file__).resolve().parent;OUT=ROOT/'results';OUT.mkdir(parents=True,exist_ok=True)

def extract_field(base,im,shape=(24,40)):
    H,W=base.shape[:2]
    cut=(int(.58*H),int(.96*H),int(.23*W),int(.77*W))
    y0,y1,x0,x1=cut
    a=cv2.cvtColor(base,cv2.COLOR_BGR2GRAY)[y0:y1,x0:x1]
    b=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)[y0:y1,x0:x1]
    flow=cv2.calcOpticalFlowFarneback(a,b,None,.5,4,19,3,5,1.1,0)
    small=cv2.resize(flow,(shape[1],shape[0]),interpolation=cv2.INTER_AREA)
    # prevent noise in mouth and cheeks carrying motion into rigid upper face
    return small.astype(np.float32).flatten()

def learn(root:Path):
    atlas=OwnerMouthAtlas.from_user_videos(root)
    roles=list(atlas.images)
    X=np.stack([extract_field(atlas.base,atlas.images[k]) for k in roles])
    train_idx=[i for i,k in enumerate(roles) if atlas.meta[k].filename=='IMG_0853.mp4']
    held_idx=[i for i,k in enumerate(roles) if atlas.meta[k].filename=='IMG_0854.mp4']
    if len(train_idx)<4 or not held_idx:raise RuntimeError('Need two distinct source recordings')
    Xtrain=X[train_idx];mean=Xtrain.mean(axis=0)
    _,ss,Vt=np.linalg.svd(Xtrain-mean,full_matrices=False)
    rank=min(3,len(train_idx)-1)
    bases=Vt[:rank]
    train_projection=(Xtrain-mean)@bases.T@bases+mean
    held_projection=(X[held_idx]-mean)@bases.T@bases+mean
    # Explain that reconstructing heldout using *its own* optical flow is an upper bound
    # on representability; this is not a forecast from text/audio.
    def mae(a,b):return float(np.mean(np.abs(a-b)))
    report={'model':'SONG-v32 owner optical-flow PCA, 2D not 3D',
     'trainSource':'IMG_0853.mp4','probeSource':'IMG_0854.mp4',
     'trainRoles':[roles[i] for i in train_idx],'heldoutRoles':[roles[i] for i in held_idx],
     'numTrainingStates':len(train_idx),'numProbeStates':len(held_idx),
     'motionFieldGrid':[24,40,2],'principalComponents':rank,
     'trainReconstructionMAE':mae(train_projection,Xtrain),
     'heldoutProjectionMAE':mae(held_projection,X[held_idx]),
     'heldoutZeroMotionBaselineMAE':mae(np.zeros_like(X[held_idx]),X[held_idx]),
     'heldoutProjectionUsesGroundTruthFlow':True,
     'audioConditionedPredictionTrained':False,
     'jawBone3DLearned':False,'phonemeLabelsLearned':False,
     'qualityWarning':'This is a source-face motion basis; it cannot predict future movement without a verified input-to-motion model'}
    np.savez_compressed(OUT/'OWNER_V32_2D_FLOW_PRIOR_PRIVATE.npz',mean=mean,bases=bases,sourceRoles=np.array(roles),grid=np.array([24,40,2]))
    (OUT/'OWNER_V32_2D_MOTION_TRAINING_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return report

if __name__=='__main__':learn(Path('/mnt/data'))
