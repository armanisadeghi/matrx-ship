#!/usr/bin/env python3
"""THE STALE-RELEASE ALARM (2026-10-21): proofs for ship_all.stale_release_alarm.

A real temp repo stands in for matrx-frontend (origin/main is a real ref); the served commit, the clock
and the mail are injected. Each case can fail: the alarm must fire when the site is stalled and stay
silent when it is not.
  1. site serves origin/main: silent;
  2. site behind main but unchanged for under 90 min: silent;
  3. unchanged for 90+ min while main has newer commits: the line is returned and ONE mail goes;
  4. the next round during the same stall returns the line and sends no second mail;
  5. the site moves (new served commit): the stall ends; a later stall mails again;
  6. a failed mail is not counted as announced: the next round tries again;
  7. a repo other than matrx-frontend is never judged.
Run: python3 scripts/test_ship_all_stale_release.py
"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)
import ship_all  # noqa: E402


def sh(cwd, *a):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class StaleReleaseAlarm(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="stale-release-test-")
        self.repo = os.path.join(self.tmp, "repo")
        os.makedirs(self.repo)
        sh(self.repo, "git", "init", "-q", "-b", "main")
        sh(self.repo, "git", "config", "user.email", "t@t")
        sh(self.repo, "git", "config", "user.name", "t")
        self.commits = []
        for n in range(3):
            self.commit(n)
        self.state = os.path.join(self.tmp, "state.json")
        self.sent = []
        self.info = {"repo": "matrx-frontend", "path": self.repo}

    def commit(self, n):
        with open(os.path.join(self.repo, "f"), "w") as f:
            f.write(str(n))
        sh(self.repo, "git", "add", "f")
        sh(self.repo, "git", "commit", "-qm", "c%d" % n, "--date", "2020-01-01T00:00:00")
        sha = sh(self.repo, "git", "rev-parse", "HEAD")
        sh(self.repo, "git", "update-ref", "refs/remotes/origin/main", sha)
        self.commits.append(sha)

    def alarm(self, served, t, ok=True, info=None):
        def mail(msg):
            self.sent.append(msg)
            return ok
        return ship_all.stale_release_alarm(info or self.info, served=served, mail=mail, now=lambda: t, state_path=self.state)

    def test_the_whole_story(self):
        head, old = self.commits[-1], self.commits[0]
        T = 10_000_000_000
        # 1. serving main: silent
        self.assertIsNone(self.alarm(head, T))
        self.assertIsNone(self.alarm(head, T + 10 * 3600))
        self.assertEqual(self.sent, [])
        # 2. behind main, first seen now (the commit date is ancient, but "since" is clamped to when it began):
        #    the stall clock starts at the served commit's own date, so seed state to model "just moved".
        os.unlink(self.state)
        with open(self.state, "w") as f:
            f.write('{"commit": "%s", "since": %d, "alarmed": false}' % (old, T))
        self.assertIsNone(self.alarm(old, T + 89 * 60))
        self.assertEqual(self.sent, [])
        # 3. 90+ minutes: line + exactly one mail
        line = self.alarm(old, T + 91 * 60)
        self.assertIn(old[:10], line)
        self.assertIn("2 newer commit", line)
        self.assertEqual(len(self.sent), 1)
        self.assertIn("RELEASE STALLED", self.sent[0])
        # 4. same stall, next round: still reported, not mailed again
        self.assertIn(old[:10], self.alarm(old, T + 150 * 60))
        self.assertEqual(len(self.sent), 1)
        # 5. the site moves: stall over; stalls again later: mailed again
        mid = self.commits[1]
        self.assertIsNone(self.alarm(mid, T + 151 * 60))
        self.assertIsNotNone(self.alarm(mid, T + 151 * 60 + 100 * 60))
        self.assertEqual(len(self.sent), 2)

    def test_failed_mail_is_retried(self):
        old = self.commits[0]
        with open(self.state, "w") as f:
            f.write('{"commit": "%s", "since": 0, "alarmed": false}' % old)
        self.assertIsNotNone(self.alarm(old, 10_000, ok=False))
        self.assertIsNotNone(self.alarm(old, 10_100, ok=True))
        self.assertEqual(len(self.sent), 2)
        self.assertIsNotNone(self.alarm(old, 10_200, ok=True))
        self.assertEqual(len(self.sent), 2)

    def test_other_repos_and_unreadable_site_are_never_judged(self):
        self.assertIsNone(self.alarm(self.commits[0], 10**10, info={"repo": "aidream", "path": self.repo}))
        real, ship_all.served_commit = ship_all.served_commit, lambda url=None: None
        try:
            self.assertIsNone(ship_all.stale_release_alarm(self.info, mail=lambda m: True, now=lambda: 10**10, state_path=self.state))
        finally:
            ship_all.served_commit = real
        self.assertEqual(self.sent, [])

    def test_unknown_served_commit_counts_as_behind(self):
        with open(self.state, "w") as f:
            f.write('{"commit": "%s", "since": 0, "alarmed": false}' % ("a" * 40))
        self.assertIsNotNone(self.alarm("a" * 40, 10**6))


if __name__ == "__main__":
    unittest.main()
