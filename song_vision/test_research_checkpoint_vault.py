"""Local-only synthetic checkpoint vault tests; NO actual singer data."""
import json
import tempfile
import unittest
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from song_vision.research_checkpoint_vault import seal, unseal, LICENSE_ID


class ResearchVaultTests(unittest.TestCase):
    def fixture(self, base: Path):
        private = X25519PrivateKey.generate()
        private_file = base / "PRIVATE.pem"
        public_file = base / "PUBLIC.pem"
        private_file.write_bytes(private.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
        public_file.write_bytes(private.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo))
        checkpoint = base / "fake-synthetic-weights.pt"
        checkpoint.write_bytes(b"synthetic fake research checkpoint only " * 120)
        report = base / "fake-synthetic-report.json"
        report.write_text(json.dumps({
            "status": "research_only_not_lipsync_validated",
            "canAcceptPaidJobs": False, "modelVersion": "fake-test"
        }), encoding="utf-8")
        metadata = {
            "dataset": "RAVDESS-Actor-01",
            "license": LICENSE_ID,
            "commercialUseAllowed": False,
            "checkpointCategory": "research_only_not_lipsync_validated",
            "githubRunId": "unit-test-001",
            "modelVersion": "fake-test"
        }
        return private_file, public_file, checkpoint, report, metadata

    def test_full_encrypt_decrypt_roundtrip_and_reject_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private_file, public_file, source, report, metadata = self.fixture(root)
            encrypted = root / "research-model.svault"
            index = seal(source, report, public_file, encrypted, metadata)
            self.assertTrue(index["keyRequiredForDecryption"])
            self.assertFalse(index["commercialUseAllowed"])
            self.assertNotIn("synthetic fake research checkpoint", encrypted.read_text())
            with self.assertRaises(FileExistsError):
                seal(source, report, public_file, encrypted, metadata)
            restored = root / "restored"
            summary = unseal(encrypted, private_file, restored)
            self.assertEqual(summary["license"], LICENSE_ID)
            self.assertEqual((restored / "research-model.pt").read_bytes(), source.read_bytes())
            self.assertEqual(json.loads((restored / "training-report.json").read_text()),
                             json.loads(report.read_text()))
            with self.assertRaises(FileExistsError):
                unseal(encrypted, private_file, restored)

    def test_wrong_key_or_tampered_metadata_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private_file, public_file, source, report, metadata = self.fixture(root)
            encrypted = root / "research-model.svault"
            seal(source, report, public_file, encrypted, metadata)
            bad_private = X25519PrivateKey.generate()
            wrong_key = root / "wrong_private.pem"
            wrong_key.write_bytes(bad_private.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption()))
            with self.assertRaises(InvalidTag):
                unseal(encrypted, wrong_key, root / "should-not-exist")
            self.assertFalse((root / "should-not-exist").exists())

            data = json.loads(encrypted.read_text())
            data["metadata"]["githubRunId"] = "altered-run-id"
            encrypted.write_text(json.dumps(data))
            with self.assertRaises(InvalidTag):
                unseal(encrypted, private_file, root / "tampered")
            self.assertFalse((root / "tampered").exists())

    def test_cannot_mislabel_commercial_permission(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private_file, public_file, source, report, metadata = self.fixture(root)
            metadata["commercialUseAllowed"] = True
            with self.assertRaisesRegex(ValueError, "Commercial use"):
                seal(source, report, public_file, root / "bad.svault", metadata)
            metadata["commercialUseAllowed"] = False
            report.write_text(json.dumps({
                "status": "research_only_not_lipsync_validated",
                "canAcceptPaidJobs": True
            }))
            with self.assertRaisesRegex(ValueError, "paid job gate"):
                seal(source, report, public_file, root / "bad.svault", metadata)


if __name__ == "__main__":
    unittest.main()
