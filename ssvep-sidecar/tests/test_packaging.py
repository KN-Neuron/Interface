from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_support import patch_scipy_cleanup
from smoke_test import verify


class PackagingTests(unittest.TestCase):
    def test_doc_cleanup_is_safe_when_no_doc_variables_exist(self):
        original = "result = 42\nfor obj in []:\n    pass\ndel obj\n"
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "original.py"
            source.write_text(original, encoding="utf-8")
            datas = [("scipy/stats/_distn_infrastructure.py", str(source), "DATA")]
            patched = patch_scipy_cleanup(datas, directory)
            namespace = {}
            exec(Path(patched[0][1]).read_text(), namespace)
            self.assertEqual(namespace["result"], 42)
            self.assertNotIn("obj", namespace)
            self.assertEqual(source.read_text(), original)

    def test_build_fails_if_expected_source_is_missing(self):
        with self.assertRaisesRegex(RuntimeError, "not collected as source"):
            patch_scipy_cleanup([], "unused")

    def test_existing_cleanup_variable_is_still_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "original.py"
            source.write_text("obj = 1\ndel obj\n", encoding="utf-8")
            patched = patch_scipy_cleanup([("scipy\\stats\\_distn_infrastructure.py", str(source), "DATA")], directory)
            namespace = {}
            exec(Path(patched[0][1]).read_text(), namespace)
            self.assertNotIn("obj", namespace)

    @patch("smoke_test.subprocess.run")
    def test_smoke_test_reports_packaged_import_crash(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, "", "NameError: obj")
        with self.assertRaisesRegex(RuntimeError, "NameError: obj"):
            verify(["classifier.exe"])

    @patch("smoke_test.subprocess.run")
    def test_smoke_test_rejects_successful_exit_without_protocol(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, "", "")
        with self.assertRaisesRegex(RuntimeError, "Missing protocol"):
            verify(["classifier.exe"])

    @patch("smoke_test.subprocess.run")
    def test_smoke_test_has_a_timeout(self, run):
        run.side_effect = subprocess.TimeoutExpired([], 90)
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            verify(["classifier.exe"])


if __name__ == "__main__":
    unittest.main()
