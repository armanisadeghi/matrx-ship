#!/usr/bin/env python3
"""The ship CLI (cli/ship.ts, distributed to every repo by `ship:update`) refuses to commit or push
while the repo's own scripts/sync-main.py reports a sync pause, and is unchanged where sync-main is
absent or too old to know --pause-active.

Each case runs the real CLI with tsx against a throwaway git repo (bare origin + clone) holding a
stub sync-main. The ship API points at a refused 127.0.0.1 port, so a run that gets past the check
stops at "Failed to create version" before staging — nothing leaves the machine.

SHIP_TS_PATH overrides the CLI under test (prove red against an older copy).
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parent.parent
SHIP_TS = Path(os.environ.get("SHIP_TS_PATH", REPO / "cli" / "ship.ts"))
TSX = REPO / "node_modules" / ".bin" / "tsx"

PAUSED_STUB = """import os, sys
open(os.environ['SYNC_STUB_MARK'], 'w').write(' '.join(sys.argv[1:]))
if '--pause-active' in sys.argv:
    print('SYNC PAUSED by tree-move until 2099-01-01T00:00:00Z', file=sys.stderr)
    sys.exit(3)
"""
NOT_PAUSED_STUB = """import os, sys
open(os.environ['SYNC_STUB_MARK'], 'w').write(' '.join(sys.argv[1:]))
if '--pause-active' in sys.argv:
    sys.exit(0)
"""
# An older sync-main: no flag support, every invocation is a full sync run.
OLD_STUB = """import os, sys
open(os.environ['SYNC_STUB_MARK'], 'w').write(' '.join(sys.argv[1:]))
"""


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


class ShipCliSyncPauseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        origin = base / "origin.git"
        git(base, "init", "--bare", "-b", "main", str(origin))
        self.clone = base / "clone"
        git(base, "clone", str(origin), str(self.clone))
        git(self.clone, "config", "user.email", "ship-test@example.invalid")
        git(self.clone, "config", "user.name", "ship test")
        (self.clone / "README.md").write_text("seed\n")
        git(self.clone, "add", "README.md")
        git(self.clone, "commit", "-m", "seed")
        git(self.clone, "push", "-u", "origin", "main")
        self.home = base / "home"
        self.home.mkdir()
        self.mark = base / "sync-main-called"

    def tearDown(self):
        self.tmp.cleanup()

    def stub(self, body):
        scripts = self.clone / "scripts"
        scripts.mkdir(exist_ok=True)
        path = scripts / "sync-main.py"
        path.write_text(body)
        git(self.clone, "add", "scripts/sync-main.py")
        git(self.clone, "commit", "-m", "stub sync-main")
        git(self.clone, "push")
        return path

    def ship(self):
        (self.clone / "change.txt").write_text("work in progress\n")
        env = {**os.environ, "HOME": str(self.home),
               "SYNC_STUB_MARK": str(self.mark),
               "MATRX_SHIP_URL": "http://127.0.0.1:9", "MATRX_SHIP_API_KEY": "sk_ship_test_refused"}
        return subprocess.run([str(TSX), str(SHIP_TS), "ship pause test"], cwd=self.clone, env=env,
                              capture_output=True, text=True, timeout=120)

    def assert_nothing_written(self):
        self.assertEqual(git(self.clone, "log", "--format=%s", "-1").strip(), "stub sync-main"
                         if (self.clone / "scripts").exists() else "seed")
        self.assertEqual(git(self.clone, "status", "--porcelain").strip(), "?? change.txt")

    def test_paused_refuses_with_exit_3_and_the_pause_line(self):
        self.stub(PAUSED_STUB)
        result = self.ship()
        out = result.stdout + result.stderr
        self.assertEqual(result.returncode, 3, out)
        self.assertIn("SYNC PAUSED by tree-move until", out)
        self.assertIn("nothing was committed or pushed", out)
        self.assertNotIn("Creating version", out)
        self.assertEqual(self.mark.read_text(), "--pause-active")
        self.assert_nothing_written()

    def test_not_paused_proceeds_to_shipping(self):
        self.stub(NOT_PAUSED_STUB)
        result = self.ship()
        out = result.stdout + result.stderr
        self.assertTrue(self.mark.exists(), "sync-main --pause-active was never asked")
        self.assertNotIn("SYNC PAUSED", out)
        self.assertIn("Creating version", out)
        self.assertIn("Failed to create version", out)
        self.assert_nothing_written()

    def test_old_sync_main_without_the_flag_is_never_run(self):
        self.stub(OLD_STUB)
        result = self.ship()
        out = result.stdout + result.stderr
        self.assertFalse(self.mark.exists(),
                         "an old sync-main was invoked — it would run a full sync, not answer")
        self.assertNotIn("SYNC PAUSED", out)
        self.assertNotIn("sync-pause check could not run", out)
        self.assertIn("Creating version", out)

    def test_repo_without_sync_main_is_unchanged(self):
        result = self.ship()
        out = result.stdout + result.stderr
        self.assertNotIn("SYNC PAUSED", out)
        self.assertNotIn("sync-pause", out)
        self.assertIn("Creating version", out)
        self.assert_nothing_written()


if __name__ == "__main__":
    unittest.main()
