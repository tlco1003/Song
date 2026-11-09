"""Prepared integration for a real FLAME/MediaPipe 3D stack; does not fake fitted mesh.

The interface requires explicit observed canonical 3D landmarks and confidence.
It exports separate rigid upper skull, articulated jaw, deformable lip, cheek,
and oral occluder channels. Without a calibrated model there is NO 3D owner fit.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
import json, math
from typing import Optional

@dataclass(frozen=True)
class AnatomyRigChannels:
    pose_yaw_rad:float
    pose_pitch_rad:float
    pose_roll_rad:float
    jaw_hinge_rad:float
    jaw_translation_normalized:float
    upper_lip_open:float
    lower_lip_open:float
    outer_lip_width:float
    inner_aperture_width:float
    inner_aperture_height:float
    lip_pucker:float
    lip_protrusion:float
    cheek_raise_left:float
    cheek_raise_right:float
    nasolabial_fold_left:float
    nasolabial_fold_right:float
    teeth_occlusion:float
    tongue_visibility:float
    skin_elastic_response:float
    observed_3d_landmarks:bool=False
    owner_bone_geometry_calibrated:bool=False


def default_neutral():
    return AnatomyRigChannels(0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0)


def export_3d_job_contract(asset_id:str,channels:AnatomyRigChannels,landmark_file:Optional[str]=None):
    d={'schema':'song-v32-3d-rig-v1','assetId':asset_id,'channels':asdict(channels),
       'modelBindings':{'FLAME':{'jawHinge':'jaw_hinge_rad','upperSkullRigid':True,
                               'expressionChannels':['cheek_raise_left','cheek_raise_right','nasolabial_fold_left','nasolabial_fold_right']},
                        'MediaPipe':{'landmarksExpected':478,'blendshapesExpected':52}},
       'evidence':{'landmarkFile':landmark_file,'owner3DFitPerformed':False,'ownerJawAngleMeasured':False,
                   'hiddenTeethOrTongueReconstructed':False}}
    if channels.observed_3d_landmarks and not landmark_file:
        raise ValueError('Observed 3D landmarks require a provenance file')
    return d


def optional_mediapipe_adapter():
    try: import mediapipe as mp
    except ImportError:
        return {'ready':False,'reason':'mediapipe model/package absent in this offline runtime',
                'required':'face_landmarker.task and user source frames; 3D pose remains unfitted'}
    return {'ready':True,'note':'model file and calibrations still required'}


def articulate_jaw_mesh(vertices, jaw_vertex_weights, hinge_xyz, hinge_angle_rad):
    """Rigid hinged jaw transform in a supplied calibrated mesh coordinate system.

    Vertices: Nx3 numpy array, weights: N values in [0,1]. A vertex with weight
    zero (maxilla, nose, eyes) remains EXACTLY invariant. No 3D geometry is
    inferred here; the caller must supply a legitimate personal mesh and pivot.
    """
    import numpy as np
    v=np.asarray(vertices,dtype=np.float64)
    weights=np.asarray(jaw_vertex_weights,dtype=np.float64)
    hinge=np.asarray(hinge_xyz,dtype=np.float64)
    if v.ndim!=2 or v.shape[1]!=3 or weights.shape!=(v.shape[0],) or hinge.shape!=(3,):
        raise ValueError('Expected Nx3 mesh vertices, N skinning weights, 3D hinge')
    if not np.all(np.isfinite(v)) or not np.all(np.isfinite(weights)):
        raise ValueError('Invalid mesh geometry')
    if np.any(weights<0) or np.any(weights>1):raise ValueError('Skinning weights outside [0,1]')
    if not math.isfinite(hinge_angle_rad):raise ValueError('Bad jaw rotation')
    # Rotation about local x-axis, coordinate conventions supplied by 3D backend.
    c,s=math.cos(hinge_angle_rad),math.sin(hinge_angle_rad)
    rot=np.array([[1,0,0],[0,c,-s],[0,s,c]],dtype=np.float64)
    moved=(v-hinge)@rot.T+hinge
    out=v+(moved-v)*weights[:,None]
    out[weights==0]=v[weights==0]
    return out


def require_owner_calibrated_3d_profile(owner_profile:dict):
    required=('neutralMeshId','jawHingeCalibration','mouthLandmark3D','sourceVideoIds','verifiedRegistration')
    missing=[x for x in required if not owner_profile.get(x)]
    if missing:raise ValueError('3D fit not safe: missing '+','.join(missing))
    return True
