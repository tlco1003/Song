import json,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train_pronunciation_v33 import VOWELS,generate_script,detect_speech,mouth_face_crop,extract_mouth

class PronunciationV33Tests(unittest.TestCase):
    def test_requested_script_exact_counts(self):
        script=generate_script()
        self.assertEqual(len(script),140)
        self.assertEqual([x['syllable'] for x in script[:10]],list('아야어여오요우유으이'))
        self.assertEqual([x['syllable'] for x in script[10:20]],list('가갸거겨고교구규그기'))
        self.assertEqual([x['syllable'] for x in script[20:30]],list('나냐너녀노뇨누뉴느니'))
        self.assertEqual(script[-1]['syllable'],'히')
        self.assertFalse(any(x['targetStatus']=='human_verified' for x in script))

    def test_speech_timing_from_real_audio(self):
        import soundfile as sf
        wav=Path('/mnt/data/song_v33_pronunciation/results/pronunciation_audio_16k.wav')
        self.assertTrue(wav.exists())
        x,sr=sf.read(str(wav))
        items,groups,db=detect_speech(x,sr)
        self.assertEqual(len(groups[0]),10)
        self.assertGreaterEqual(len(items),140)
        self.assertEqual(items[0]['syllable'],'아')
        self.assertFalse(any(x['audioLabelVerified'] for x in items))
        self.assertTrue(all(x['endSec']>x['startSec'] for x in items))

    def test_face_crop_local_mask(self):
        import cv2
        cap=cv2.VideoCapture('/mnt/data/pronunciation_25mb.mp4')
        cap.set(cv2.CAP_PROP_POS_MSEC,6000);ok,frame=cap.read();cap.release()
        self.assertTrue(ok)
        fc=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
        face,_=mouth_face_crop(frame,fc)
        emb,props,roi,mask=extract_mouth(face)
        self.assertEqual(face.shape,(256,256,3))
        self.assertEqual(len(emb),48*32)
        self.assertGreater(props['mouthROIWidthPx'],70)
        self.assertLess(props['oralDarkCandidateAreaPx'],3000)
        self.assertEqual(mask.shape[:2],roi.shape[:2])

    def test_provisional_annotations_never_claim_verified(self):
        r=Path('/mnt/data/song_v33_pronunciation/results')
        report=json.loads((r/'V33_TRAINING_REPORT.json').read_text())
        segments=json.loads((r/'V33_AUDIO_SEGMENT_REVIEW.json').read_text())['segments']
        self.assertEqual(report['confirmedPhonemeTimingCount'],0)
        self.assertEqual(report['expectedUserScriptSyllables'],140)
        self.assertEqual(len(segments),169)
        self.assertFalse(any(x.get('audioLabelVerified') for x in segments))
        self.assertEqual(len([x for x in segments if x.get('syllable')]),10)
        self.assertEqual(report['trainingEventCount']+report['holdoutEventCount'],report['validMouthSegmentFeatures'])

    def test_real_pca_file_and_preview_replay(self):
        r=Path('/mnt/data/song_v33_pronunciation/results')
        with np.load(r/'OWNER_V33_MOUTH_MOTION_PRIOR_PRIVATE.npz') as z:
            self.assertEqual(z['pca_components'].shape,(12,1536))
            self.assertEqual(len(z['vowel_prototype_labels']),10)
        for name in ['SONG_V33_FIRST_TEN_VOWELS_ACTUAL_SPEECH.mp4','SONG_V33_ALL_GROUPS_SPEECH_REVIEW.mp4']:
            p=r/name
            self.assertGreater(p.stat().st_size,150000)
            self.assertEqual(p.read_bytes()[4:8],b'ftyp')

if __name__=='__main__':unittest.main(verbosity=2)
