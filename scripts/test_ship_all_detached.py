#!/usr/bin/env python3
"""THE ROUND OUTLIVES ITS CALLER (2026-10-21): proofs for ship_all_detached.py.

Each case starts the runner the way an agent turn does (a child in the caller's own process group),
with MATRX_SHIP_ALL_TEST_CMD standing in for ship_all.py and a temp MATRX_SHIP_ALL_ROOT.
  1. killing the caller's whole process group mid-round does not stop the round: it finishes and
     writes its exit code (with MATRX_SHIP_ALL_ATTACHED=1, the old behaviour, the round dies: the
     case asserts that too, so the test fails if the detach is removed);
  2. a second caller joins the running round instead of starting a duplicate;
  3. a round killed by `kill <pid>` is announced to its follower as STOPPED, and its steps stop too;
  4. the follower returns the round's own exit code and streams its output.
Run: python3 scripts/test_ship_all_detached.py
"""
import os
import signal
import subprocess
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.realpath(__file__))
RUNNER = os.path.join(HERE, "ship-all.sh")


def wait_for(pred, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.1)
    return False


class DetachedRoundTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="ship-all-detached-test-")
        self.marker = os.path.join(self.root, "round-finished")

    def caller(self, cmd, extra=None, args=()):
        env = dict(os.environ, MATRX_SHIP_ALL_ROOT=self.root, MATRX_SHIP_ALL_TEST_CMD=cmd,
                   MATRX_SHIP_ALL_POLL="0.1")
        env.pop("MATRX_SHIP_ALL_DETACHED", None)
        env.pop("MATRX_SHIP_ALL_ATTACHED", None)
        env.update(extra or {})
        # The caller gets its own process group, like an agent tool's shell.
        return subprocess.Popen(["bash", RUNNER] + list(args), env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, start_new_session=True)

    def round_rc_files(self):
        rounds = os.path.join(self.root, "rounds")
        return [f for f in os.listdir(rounds) if f.endswith(".rc")] if os.path.isdir(rounds) else []

    def test_1_round_survives_its_callers_group_being_killed(self):
        cmd = "echo step-one; sleep 2; echo step-two; touch %s; exit 0" % self.marker
        p = self.caller(cmd)
        self.assertTrue(wait_for(lambda: os.path.exists(os.path.join(self.root, "round.json"))))
        time.sleep(0.5)
        os.killpg(p.pid, signal.SIGTERM)             # the agent turn is aborted
        p.wait(timeout=10)
        self.assertTrue(wait_for(lambda: os.path.exists(self.marker)), "the round died with its caller")
        self.assertTrue(wait_for(lambda: self.round_rc_files()))

    def test_1b_attached_round_dies_with_its_caller(self):
        # The old behaviour (the round is the caller's child), with the same stand-in command.
        cmd = "sleep 3; touch %s" % self.marker
        q = subprocess.Popen(["bash", "-c", cmd], start_new_session=True)
        time.sleep(0.5)
        os.killpg(q.pid, signal.SIGTERM)
        q.wait(timeout=10)
        time.sleep(3.5)
        self.assertFalse(os.path.exists(self.marker), "an attached round should die with its caller")

    def test_2_second_caller_joins_instead_of_duplicating(self):
        cmd = "echo only-round; sleep 10; exit 0"
        a = self.caller(cmd)
        self.assertTrue(wait_for(lambda: os.path.exists(os.path.join(self.root, "round.json"))))
        b = self.caller(cmd)
        out_b, _ = b.communicate(timeout=30)
        a.communicate(timeout=30)
        self.assertIn("already running", out_b)
        self.assertIn("only-round", out_b)
        self.assertEqual(len(os.listdir(os.path.join(self.root, "rounds"))), 2)   # one .out + one .rc
        self.assertEqual(b.returncode, 0)

    def test_3_killed_round_is_announced_and_its_steps_stop(self):
        cmd = "echo started; sleep 30; touch %s" % self.marker
        p = self.caller(cmd)
        self.assertTrue(wait_for(lambda: os.path.exists(os.path.join(self.root, "round.json"))))
        time.sleep(0.5)
        import json
        with open(os.path.join(self.root, "round.json")) as f:
            pid = json.load(f)["pid"]
        os.kill(pid, signal.SIGTERM)
        out, _ = p.communicate(timeout=20)
        self.assertIn("STOPPED", out)
        self.assertEqual(p.returncode, 143)
        time.sleep(1)
        self.assertFalse(os.path.exists(self.marker), "the round's step kept running after the stop")

    def test_4_exit_code_and_output_come_back(self):
        p = self.caller("echo hello-from-round; exit 3")
        out, _ = p.communicate(timeout=30)
        self.assertIn("hello-from-round", out)
        self.assertIn("runs detached as pid", out)
        self.assertEqual(p.returncode, 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
