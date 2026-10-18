import argparse
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import launcher


class LifecycleTests(unittest.TestCase):
    def exercise(self, already_running=False, fail_start=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for device in ("brainaccess", "brainlink"):
                (root / (f"{device}-bridge.exe" if sys.platform == "win32" else f"{device}-bridge")).touch()
            args = argparse.Namespace(project=root, binaries=root, browser=None, keep_container=False, profile=root / "profile")
            server = MagicMock()
            server.__enter__.return_value = server
            server.claim_ticket = "single-use-ticket"
            server.lease_expired.wait.side_effect = [False, False]
            server.heartbeat_seen.is_set.return_value = True
            process = MagicMock()
            process.poll.side_effect = [None, None, 0, 0, 0]
            results = ['{"services":{"app":{"ports":[{"published":"8080","target":8080,"host_ip":"127.0.0.1"}]}}}', "existing-container" if already_running else "", RuntimeError("Docker failed") if fail_start else "", ""]
            with patch.object(launcher, "BridgeServer", return_value=server), patch.object(launcher, "browser_path", return_value="browser"), patch.object(launcher, "compose_command", return_value=["docker", "compose"]), patch.object(launcher, "run_command", side_effect=results) as command, patch.object(launcher.subprocess, "Popen", return_value=process) as spawn, patch.object(launcher.threading, "Thread"):
                if fail_start:
                    with self.assertRaisesRegex(RuntimeError, "Docker failed"):
                        launcher.run(args)
                    spawn.assert_not_called()
                else:
                    launcher.run(args)
                    browser_args = spawn.call_args.args[0]
                    self.assertIn("--app=http://localhost:8080/#kneuron-launch=single-use-ticket", browser_args)
                    self.assertTrue(any(arg.startswith("--user-data-dir=") for arg in browser_args))
                server.shutdown.assert_called_once()
                server.server_close.assert_called_once()
                stops = [call for call in command.call_args_list if call.args[0][-2:] == ["stop", "app"]]
                self.assertEqual(len(stops), 0 if already_running else 1)

    def test_owned_container_stops_when_window_closes(self):
        self.exercise()

    def test_existing_container_is_preserved(self):
        self.exercise(already_running=True)

    def test_start_failure_cleans_up_bridge_and_owned_container(self):
        self.exercise(fail_start=True)

    def test_missing_browser_is_actionable(self):
        with self.assertRaisesRegex(RuntimeError, "does not exist"):
            launcher.browser_path("/does/not/exist")
