"""Actual user-authored AM 6:30 lyric text, WITHOUT fictitious song timing."""
import unittest
from owner_v21_text_viseme import syllables,preview_intervals,pose_at

class AM630TextContract(unittest.TestCase):
    def test_actual_lyric_is_decomposed_character_by_character(self):
        sentence="어두운 밤이 지나면"
        chars=syllables(sentence)
        self.assertEqual("".join(c.glyph for c in chars),"어두운밤이지나면")
        self.assertEqual(tuple(c.vowel for c in chars),tuple("ㅓㅜㅜㅏㅣㅣㅏㅕ"))
        self.assertEqual(chars[3].coda,"ㅁ")
        self.assertEqual(chars[-1].vowel,"ㅕ")

    def test_no_unreviewed_am630_lyric_time_claim(self):
        cues=preview_intervals("어두운 밤이 지나면",each_seconds=.6)
        p,state=pose_at(cues,1.88)
        self.assertEqual(state["status"],"PREVIEW_UNALIGNED")
        self.assertFalse(state["alignmentVerified"])

if __name__=="__main__":unittest.main()
