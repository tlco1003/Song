"""Offline Korean Seoul phoneme parser and real PyTorch head tests.

This unit test contains deliberately synthetic phones/tensors; it proves
parser, class mapping, optimizer and independent-speaker evaluation mechanics,
NOT actual Seoul Corpus download or Korean singing accuracy.
"""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from song_vision.phoneme_targets_v13 import CONSONANTS, VOWELS
from song_vision.korean_seoul_phones_v14 import (
    SEOUL_TO_KOREAN, _group_speaker, _member_basename,
    parse_long_textgrid, train_korean_phones, VERSION,
)
from song_vision.seoul_research_vault_v14 import seal_seoul
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives import serialization


def textgrid_fixture():
    return '''File type = "ooTextFile"
Object class = "TextGrid"
xmin = 0
xmax = 1
tiers? <exists>
size = 2
item []:
    item [1]:
        class = "IntervalTier"
        name = "utterances"
        xmin = 0
        xmax = 1
        intervals: size = 1
        intervals [1]:
            xmin = 0
            xmax = 1
            text = "마음"
    item [2]:
        class = "IntervalTier"
        name = "phoneme"
        xmin = 0
        xmax = 1
        intervals: size = 3
        intervals [1]:
            xmin = 0
            xmax = 0.1
            text = "mm"
        intervals [2]:
            xmin = 0.1
            xmax = 0.6
            text = "aa"
        intervals [3]:
            xmin = 0.6
            xmax = 1
            text = "ng"
'''


class KoreanPhoneSourceTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    def test_published_phone_table_exact_13_consonants_5_vowels(self):
        self.assertEqual(len(SEOUL_TO_KOREAN),18)
        self.assertEqual(set(SEOUL_TO_KOREAN.values()), set(CONSONANTS)|set(VOWELS))
        self.assertEqual(SEOUL_TO_KOREAN["ng"],"ㅇ")
        self.assertEqual(SEOUL_TO_KOREAN["ee"],"ㅔ")
        self.assertNotIn("ㅇ", ("silent-orthographic-onset",))
        self.assertEqual(_group_speaker("sound/s01/fakesong-s01-clip.flac"),"s01")
        self.assertEqual(_member_basename("speaker/s03-42.TextGrid"),"s03-42")

    def test_parse_REAL_form_long_textgrid_and_refuse_fake_phonemes(self):
        phones=parse_long_textgrid(textgrid_fixture())
        self.assertEqual(phones,[(0.,.1,"mm"),(.1,.6,"aa"),(.6,1.,"ng")])
        with self.assertRaisesRegex(ValueError,"phoneme tier"):
            parse_long_textgrid(textgrid_fixture().replace(
                'name = "phoneme"','name = "orthography"'))
        with self.assertRaisesRegex(ValueError,"Overlapping"):
            parse_long_textgrid(textgrid_fixture().replace("xmin = 0.1", "xmin = 0.05"))

    def test_phone_only_real_learning_path_and_correct_legal_vault(self):
        rng=np.random.default_rng(7)
        mel_train=rng.normal(0,1,(80,210)).astype(np.float32)
        mel_hold=rng.normal(0,1,(80,210)).astype(np.float32)
        training=[]
        holdout=[]
        for i in range(160):
            phone=CONSONANTS[i%len(CONSONANTS)] if i%2==0 else VOWELS[i%len(VOWELS)]
            training.append((mel_train,float(i)/100,phone))
        for i in range(64):
            phone=CONSONANTS[i%len(CONSONANTS)] if i%2==0 else VOWELS[i%len(VOWELS)]
            holdout.append((mel_hold,float(i)/100,phone))
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            model=root/"seoul-synthetic-phonemes.pt"
            report=train_korean_phones(training,holdout,model,epochs=1)
            self.assertEqual(report["modelVersion"],VERSION)
            self.assertEqual(report["independentSpeakerHoldoutFrames"],64)
            self.assertFalse(report["actualSingingPhonemeAccuracyProven"])
            weights=torch.load(model,map_location="cpu",weights_only=True)
            self.assertEqual(weights["sourceLicense"],"CC-BY-NC-2.0")
            self.assertTrue("consonant_head.weight" in weights["stateDict"])
            key=X25519PrivateKey.generate().public_key().public_bytes(
                encoding=serialization.Encoding.PEM,format=serialization.PublicFormat.SubjectPublicKeyInfo)
            public=root/"owner-public.pem"
            public.write_bytes(key)
            sealed=seal_seoul(model,model.with_suffix(".report.json"),
                               public,root/"academic-seoul.svault",run="unit-test")
            self.assertEqual(sealed["license"],"CC-BY-NC-2.0")
            envelope=json.loads((root/"academic-seoul.svault").read_text())
            self.assertEqual(envelope["metadata"]["dataset"],"SeoulCorpus-OpenSLR-113")
            self.assertNotIn("CC-BY-NC-SA-4.0",(root/"academic-seoul.svault").read_text())
            with self.assertRaises(FileExistsError):
                seal_seoul(model,model.with_suffix(".report.json"),
                           public,root/"academic-seoul.svault",run="unit-test")


if __name__=="__main__":
    unittest.main()
