"""Synthetic regression for actual NSMC sentence context training pipeline.

All unit-test sentences/word ratings are invented to test functionality.
The live GitHub Action later downloads genuine human-labelled data.
"""
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

import torch

from song_vision.word_feelings_v15 import train_word_meanings,LearnedWordFeeling
from song_vision.korean_context_pretrain_v15 import (
    select_balanced_review_contexts,train_contextual_korean,VERSION,
    ContextualPolarityFaceMeaning
)
from song_vision.korean_context_vault_v15 import SOURCE_ID,SOURCE_DETAIL
from song_vision.research_vault_v15 import SOURCES


class KoreanSentenceLearningTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    @staticmethod
    def fake_word_norms(count=360):
        rows=["lexicon,representative,prototypicality,familiarity,valence,arousal"]
        for i in range(count):
            word="감정"+chr(0xAC00+i)
            rows.append(
                f"{word},False,2.50,2.00,{1.+((i*17)%300)/100.:.2f},"
                f"{1.+((i*29)%320)/100.:.2f}")
        return ("\\n".join(rows)+"\\n").encode("utf-8")

    @staticmethod
    def fake_reviews(suffix,n=45):
        lines=["id\tdocument\tlabel"]
        for i in range(n):
            lines.append(f"{suffix}-{i}-p\t영화는 재미있었는데 {suffix} 배우 연기 {i}\t1")
            lines.append(f"{suffix}-{i}-n\t영화는 지루했지만 {suffix} 연출 장면 {i}\t0")
        return ("\n".join(lines)+"\n").encode()

    def test_sentences_are_real_supervised_units_no_fixed_word_emotion_rule(self):
        train=self.fake_reviews("train")
        val=self.fake_reviews("test")
        samples=select_balanced_review_contexts(train,limit_per_polarity=20)
        self.assertEqual(len(samples),40)
        self.assertEqual({label for text,label in samples},{0,1})
        with self.assertRaises(ValueError):
            select_balanced_review_contexts(b"bad TSV",16)
        with self.assertRaises(ValueError):
            select_balanced_review_contexts(train,100)

    def test_finetune_actual_word_encoder_with_contextual_sentence_loss(self):
        raw=self.fake_word_norms()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            word=root/"known-real-shape-word.pt"
            train_word_meanings(raw,word,epochs=1)
            context=root/"independent-reviewed-context-v15.pt"
            report=train_contextual_korean(
                self.fake_reviews("train"),self.fake_reviews("test"),raw,
                word,context,epochs=1,train_each=20,holdout_each=16)
            self.assertEqual(report["bestMovieReviewHoldout"]["unseenDistinctSentences"],32)
            self.assertFalse(report["actualLyricsToFacialMotionPairsLearned"])
            self.assertFalse(report["canAcceptPaidJobs"])
            self.assertTrue(context.is_file())
            checkpoint=torch.load(context,map_location="cpu",weights_only=True)
            self.assertEqual(checkpoint["modelVersion"],
                             "song-v15-korean-contextual-semantic-affect-v1")
            self.assertIn("reviewPolarityHeadStateDict",checkpoint)
            enc=LearnedWordFeeling()
            enc.load_state_dict(checkpoint["stateDict"],strict=True)
            self.assertEqual(len(SOURCE_DETAIL)>0,True)
            self.assertTrue(SOURCE_ID.startswith("KOREAN-"))
            with self.assertRaises(ValueError):
                train_contextual_korean(
                    self.fake_reviews("train"),self.fake_reviews("test"),raw,
                    word,context,epochs=1,train_each=20,holdout_each=16)


if __name__=="__main__":
    unittest.main()
