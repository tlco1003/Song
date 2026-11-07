/**
 * Public non-secret status only. Local PyTorch model is not an online paid API.
 * An operator must train and validate the local model before any commercial use.
 */
export const SONG_VISION_MODEL_VERSION = 'song-vision-mouth-v1';

export function songVisionReadiness() {
  return Object.freeze({
    engine: 'song-vision-self-hosted',
    modelVersion: SONG_VISION_MODEL_VERSION,
    runtime: 'local-python-pytorch',
    externalVideoApiRequired: false,
    checkpointIncludedInRepository: false,
    researchCliAvailable: true,
    synchronizedVideoVocalTrainingPipeline: true,
    faceSurfaceGeometryResearchCliAvailable: true,
    localAudioRmsMouthWarpPrototypeAvailable: true,
    koreanVisemeManualTimelineAvailable: true,
    operatorAlignmentRequired: true,
    acousticForcedAlignmentImplemented: false,
    realSingerVisemeQualityValidated: false,
    maskedReferenceRetrainingAvailable: true,
    maskedReferenceRealSingerQualityValidated: false,
    jointFaceSurfaceTrainingPipelineAvailable: true,
    cheekAndJawSurfaceMotionTargetsAvailable: true,
    jointFaceSurfaceQualityValidated: false,
    fullCheekJawImageRendererReady: false,
    skinEyePerioralAcousticTrainingAvailable: true,
    skinEyePerioralAcousticQualityValidated: false,
    speechAcousticsFromFaceOnlyAvailable: false,
    existingSongVocalToFaceDynamicsResearchPipelineAvailable: true,
    acousticStrengthAndPhoneticSpectrumControlsAvailable: true,
    vocalAudioSynthesisImplemented: false,
    acousticPhonemeClassificationValidated: false,
    vocalToFaceRealSingerQualityValidated: false,
    normalVsStrongExpressionSingingDataAvailable: true,
    normalVsStrongExpressionSingingQualityValidated: false,
    physiologicalMuscleEffortMeasured: false,
    stagedArticulationProsodyEmotionFusionResearchAvailable: true,
    korean13Consonant5VowelReviewedAnnotationContractAvailable: true,
    koreanConsonantVowelTrainingValidated: false,
    emotionalSkinMotionFullFaceRendererValidated: false,
    projectedIrisMotionTrainingAvailable: true,
    trueEyeGazeTargetValidated: false,
    phonemeAccurateLipsyncVerified: false,
    actualBoneStructureEstimation: false,
    clipDisjointValidationImplemented: true,
    realSingerTrainingDataProvided: false,
    trainedCheckpointVerified: false,
    customerFaceSwapModelReady: false,
    videoQualityVerified: false,
    orderQueueConnected: false,
    customerUploadsEnabled: false,
    canAcceptCustomerJobs: false,
    commercialReadiness: 'blocked',
    reason: 'Training data, trained checkpoint, quality gate, and authenticated paid job queue are not yet validated.'
  });
}

export function assertSongVisionPaidJobReady() {
  throw new Error('SONG-Vision is a research engine; no paid customer video jobs may be submitted.');
}
