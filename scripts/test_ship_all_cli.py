#!/usr/bin/env python3
"""Focused regression tests for the ship-all command boundary."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import time


MODULE_PATH = Path(__file__).with_name("ship_all.py")
SPEC = importlib.util.spec_from_file_location("ship_all", MODULE_PATH)
ship_all = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ship_all)
# The suite never reads the machine's real cutover stop file (a cutover may be running).
ship_all.CUTOVER_STOP = str(Path(tempfile.gettempdir(), "ship-all-test-no-stop-%d" % time.time_ns()))


class ShipAllCliTests(unittest.TestCase):
    def test_fetch_retries_a_concurrent_remote_ref_update(self):
        race = (1, "", "error: cannot lock ref 'refs/remotes/origin/main': is at new but expected old")
        with patch.object(ship_all, "run", side_effect=[race, (0, "fresh", "")]) as run:
            self.assertEqual(ship_all.git("/repo", "fetch", "origin", timeout=90), (0, "fresh", ""))
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0], run.call_args_list[1])

    def test_fetch_ref_race_retries_are_bounded(self):
        race = (1, "", "cannot lock ref 'refs/remotes/origin/main': is at new but expected old")
        with patch.object(ship_all, "run", return_value=race) as run:
            self.assertEqual(ship_all.git("/repo", "fetch", "origin"), race)
        self.assertEqual(run.call_count, 3)

    def test_other_git_failures_are_not_retried(self):
        for args, error in [(('fetch', 'origin'), 'authentication failed'),
                            (('fetch', 'origin'), "cannot lock ref 'x': Unable to create x.lock: File exists"),
                            (('push', 'origin'), "cannot lock ref 'x': is at new but expected old")]:
            with self.subTest(args=args, error=error), patch.object(ship_all, "run", return_value=(1, "", error)) as run:
                self.assertEqual(ship_all.git("/repo", *args), (1, "", error))
                self.assertEqual(run.call_count, 1)

    def test_release_liveness_accepts_verified_satellite_skips(self):
        sha = "a" * 40
        commits = "%s\t%d\tweb-release-all: v1 - sweep\n" % (sha, int(time.time()))
        rows = ("ai-matrx\tREADY\tmain-id\turl\tmain-id\n"
                "ai-matrx-manage\tSKIPPED_BY_DESIGN\tadmin-id\turl\t\n"
                "ai-matrx-demos\tSKIPPED_BY_DESIGN\tdemos-id\turl\t\n"
                "ai-matrx-lab\tREADY\tlab-id\turl\tlab-id\n")
        with patch.object(ship_all.os.path, "isfile", return_value=True), \
             patch.object(ship_all, "git", return_value=(0, commits, "")), \
             patch.object(ship_all.subprocess, "run", return_value=SimpleNamespace(stdout=rows)):
            self.assertEqual(ship_all.release_liveness({"path": "/unused/frontend"}), [])

        # A canceled satellite without its deployment-log skip marker remains a failed release.
        with patch.object(ship_all.os.path, "isfile", return_value=True), \
             patch.object(ship_all, "git", return_value=(0, commits, "")), \
             patch.object(ship_all.subprocess, "run", return_value=SimpleNamespace(
                 stdout=rows.replace("SKIPPED_BY_DESIGN", "CANCELED", 1))):
            self.assertIn("CANCELED", " ".join(ship_all.release_liveness({"path": "/unused/frontend"})))

        for served in ("", "different-id"):
            with self.subTest(served=served), \
                 patch.object(ship_all.os.path, "isfile", return_value=True), \
                 patch.object(ship_all, "git", return_value=(0, commits, "")), \
                 patch.object(ship_all.subprocess, "run", return_value=SimpleNamespace(
                     stdout=rows.replace("main-id\n", served + "\n", 1))):
                self.assertIn("READY-NOT-SERVING", " ".join(
                    ship_all.release_liveness({"path": "/unused/frontend"})))

        with patch.object(ship_all.os.path, "isfile", return_value=True), \
             patch.object(ship_all, "git", return_value=(0, commits, "")), \
             patch.object(ship_all.subprocess, "run", return_value=SimpleNamespace(stdout="")):
            self.assertIn("UNVERIFIED", " ".join(
                ship_all.release_liveness({"path": "/unused/frontend"})))

        older = "%s\t%d\tweb-release-all: v0 - earlier\n" % ("b" * 40, int(time.time()) - 1800)
        with patch.object(ship_all.os.path, "isfile", return_value=True), \
             patch.object(ship_all, "git", return_value=(0, commits + older, "")), \
             patch.object(ship_all.subprocess, "run", side_effect=[
                 SimpleNamespace(stdout=rows.replace("ai-matrx\tREADY", "ai-matrx\tBUILDING", 1)),
                 SimpleNamespace(stdout="")]):
            self.assertIn("BUILDING", " ".join(
                ship_all.release_liveness({"path": "/unused/frontend"})))

    def test_liveness_shell_classifies_only_verified_satellite_skip(self):
        with tempfile.TemporaryDirectory() as d:
            scripts = Path(d, "scripts")
            scripts.mkdir()
            Path(scripts, "release-outcome.sh").write_text("""
release_outcome_targets() { echo 'main admin'; }
release_outcome_would_build() { return 0; }
release_outcome_project_id() { echo "$1"; }
release_outcome_project_name() { echo "$1"; }
release_outcome_fetch() {
  if [ "$1" = main ]; then printf '%s\\t%s\\t%s\\n' "${MAIN_STATE:-READY}" main-id url;
  else printf 'CANCELED\\tadmin-id\\turl\\n'; fi
}
release_outcome_satellite_skipped() { [ "${SKIP_MARKER:-}" = present ]; }
release_outcome_serving() { echo main-id; }
""")

            def rows(main_state, marker):
                env = dict(ship_all.os.environ, MAIN_STATE=main_state, SKIP_MARKER=marker)
                result = subprocess.run(["bash", "-c", ship_all.LIVE_CHECK_SH,
                                         "x", "a" * 40, "web-release-all: v1 - sweep"],
                                        cwd=d, env=env, capture_output=True, text=True, check=True)
                return result.stdout

            self.assertIn("admin\tSKIPPED_BY_DESIGN\tadmin-id", rows("READY", "present"))
            self.assertIn("admin\tCANCELED\tadmin-id", rows("READY", ""))
            self.assertIn("main\tCANCELED\tmain-id", rows("CANCELED", "present"))

    @staticmethod
    def graphql_history(workflow="Release", status="COMPLETED", conclusion="SUCCESS"):
        return json.dumps({"data": {"repository": {"defaultBranchRef": {"target": {
            "history": {"pageInfo": {"hasNextPage": False}, "nodes": [{"oid": "abc",
                "checkSuites": {"pageInfo": {"hasNextPage": False}, "nodes": [{
                    "id": "suite", "createdAt": "2026-10-08T20:00:00Z", "status": status,
                    "conclusion": conclusion, "url": "https://example.test/check", "workflowRun": {
                        "databaseId": 42, "workflow": {"name": workflow}}}]}}]}}}}}})

    def assert_non_mutating_exit(self, args, expected_exit):
        with patch.object(ship_all, "inspect") as inspect, \
             patch.object(ship_all.os, "makedirs") as makedirs, \
             patch.object(ship_all.os, "listdir") as listdir, \
             patch.object(ship_all, "say"):
            self.assertEqual(ship_all.main(args), expected_exit)
        inspect.assert_not_called()
        makedirs.assert_not_called()
        listdir.assert_not_called()

    def test_ship_sh_survives_its_own_sync_rewriting_it(self):
        import subprocess, tempfile
        with tempfile.TemporaryDirectory() as d:
            Path(d, "ship.sh").write_text(
                'echo "note=$1"\n'
                'printf "echo broken (\\n%.0s" $(seq 1 40) > ship.sh\n'
                'echo finished\n'
                'exit 7\n')
            out = subprocess.run(ship_all.SHIP_CMD + ["ship-all x"], cwd=d,
                                 capture_output=True, text=True)
        self.assertEqual(out.returncode, 7, out.stderr)
        self.assertIn("note=ship-all x", out.stdout)
        self.assertIn("finished", out.stdout)

    def test_help_returns_before_any_repository_or_output_work(self):
        self.assert_non_mutating_exit(["--help"], 0)

    def test_unknown_flag_returns_before_any_repository_or_output_work(self):
        self.assert_non_mutating_exit(["--definitely-not-a-flag"], 2)

    def test_empty_or_comma_only_only_value_returns_before_any_work(self):
        for value in ("", ",", ",,,"):
            with self.subTest(value=value):
                self.assert_non_mutating_exit(["--only", value], 2)

    def test_repeated_only_returns_before_any_work(self):
        self.assert_non_mutating_exit(["--only", "matrx-frontend", "--only", ""], 2)

    def test_aidream_active_workflow_blocks_another_release(self):
        info = {"repo": "aidream", "path": "/unused/aidream"}
        with patch.object(ship_all, "run", return_value=(0, json.dumps([
                {"status": "in_progress", "displayTitle": "AI Dream release v1"}]), "")):
            self.assertIn("active or queued", ship_all.active_release_slot(info))

    def test_matrx_local_active_off_host_release_blocks_another_release(self):
        info = {"repo": "matrx-local", "path": "/unused/matrx-local"}
        with patch.object(ship_all, "run", return_value=(0, '[{"status":"pending"}]', "")) as run:
            self.assertIn("Matrx Local has an active or queued", ship_all.active_release_slot(info))
            self.assertIn("off-host-release.yml", run.call_args.args[0])

    def test_matrx_local_active_legacy_release_blocks_after_off_host_scan(self):
        info = {"repo": "matrx-local", "path": "/unused/matrx-local"}

        def release_status(cmd, cwd, timeout):
            workflow = cmd[4]
            return (0, '[{"status":"pending"}]' if workflow == "release.yml" else "[]", "")

        with patch.object(ship_all, "run", side_effect=release_status) as run:
            self.assertIn("Matrx Local has an active or queued", ship_all.active_release_slot(info))
            workflows = [call.args[0][4] for call in run.call_args_list]
            self.assertEqual(workflows, ["off-host-release.yml", "release.yml"])

    def test_matrx_local_unverified_slot_fails_closed(self):
        info = {"repo": "matrx-local", "path": "/unused/matrx-local"}
        with patch.object(ship_all, "run", return_value=(1, "", "provider unavailable")):
            self.assertIn("could not be verified", ship_all.active_release_slot(info))

    def test_frontend_active_release_blocks_but_ordinary_build_does_not(self):
        info = {"repo": "matrx-frontend", "path": "/unused/matrx-frontend"}
        ordinary = {"state": "BUILDING", "meta": {"githubCommitMessage": "feat: ordinary edit"}}
        release = {"state": "BUILDING", "meta": {"githubCommitMessage": "web-release-all: v1"}}
        with patch.object(ship_all, "run", side_effect=[
                (0, json.dumps({"deployments": [ordinary], "pagination": {}}), ""),
                (0, json.dumps({"deployments": [release], "pagination": {}}), "")]) as run:
            self.assertIn("ai-matrx-manage", ship_all.active_release_slot(info))
            self.assertEqual(run.call_count, 2)

    def test_frontend_unverified_slot_fails_closed(self):
        info = {"repo": "matrx-frontend", "path": "/unused/matrx-frontend"}
        with patch.object(ship_all, "run", return_value=(1, "", "provider unavailable")):
            self.assertIn("could not be verified", ship_all.active_release_slot(info))

    def test_frontend_paginates_filtered_active_builds(self):
        info = {"repo": "matrx-frontend", "path": "/unused/matrx-frontend"}
        first = {"deployments": [{"state": "BUILDING", "meta": {"githubCommitMessage": "feat: edit"}}],
                 "pagination": {"next": 123}}
        second = {"deployments": [{"state": "BUILDING", "meta": {"githubCommitMessage": "web-release-all: v2"}}],
                  "pagination": {}}
        with patch.object(ship_all, "run", side_effect=[
                (0, json.dumps(first), ""), (0, json.dumps(second), "")]) as run:
            self.assertIn("active or queued", ship_all.active_release_slot(info))
            self.assertIn("--status", run.call_args_list[0].args[0])
            self.assertIn("--next", run.call_args_list[1].args[0])

    def test_malformed_provider_shape_fails_closed(self):
        info = {"repo": "matrx-frontend", "path": "/unused/matrx-frontend"}
        with patch.object(ship_all, "run", return_value=(0, '{"deployments": null}', "")):
            self.assertIn("unexpected shape", ship_all.active_release_slot(info))
        with patch.object(ship_all, "run", return_value=(0, '{"deployments": [], "pagination": []}', "")):
            self.assertIn("unexpected shape", ship_all.active_release_slot(info))

    def test_only_aidream_and_frontend_ride_the_release_train(self):
        # Release cadence (Arman, 2026-10-11): every other repo is synced, never released.
        self.assertEqual(ship_all.RELEASE_TRAIN, {"aidream", "matrx-frontend"})
        for name in ("aidream", "matrx-frontend"):
            self.assertEqual(ship_all.ship_cmd({"repo": name, "path": "/unused"}, "n"), ship_all.SHIP_CMD + ["n"])
        with tempfile.TemporaryDirectory() as d:
            Path(d, "ship.sh").write_text('python3 "$ROOT/scripts/sync-main.py" --skip-matrx-packages\nbash scripts/release.sh\n')
            for name in ("matrx-local", "matrx-vscode", "matrx-claude-plugin", "matrx-extend"):
                cmd = ship_all.ship_cmd({"repo": name, "path": d}, "n")
                self.assertNotIn("./ship.sh", " ".join(cmd))
                self.assertIn("scripts/sync-main.py", cmd[2])
                self.assertNotRegex(cmd[2], r"release\.sh|dispatch|gh workflow")
                self.assertEqual(cmd[-1], "--skip-matrx-packages")
            # The sync-only command really runs the sync and prints ship-all's summary line.
            Path(d, "scripts").mkdir()
            Path(d, "scripts", "sync-main.py").write_text("import sys; print('synced', sys.argv[1:])\n")
            out = subprocess.run(ship_all.ship_cmd({"repo": "matrx-local", "path": d}, "n"), cwd=d,
                                 capture_output=True, text=True)
            self.assertEqual(out.returncode, 0)
            self.assertIn("synced ['--skip-matrx-packages']", out.stdout)
            self.assertIn("ship.sh: sync exit 0, release exit 0 (sync only)", out.stdout)

    def test_package_consumers_ship_only_after_the_source_and_its_publish_runs(self):
        # THE PACKAGE ORDER (2026-10-16): matrx-frontend read npm four minutes before aidream pushed.
        events = []
        def info(name, dirty):
            return {"repo": name, "path": "/x/" + name, "branch": "main", "has_ship": True, "fetch_ok": True,
                    "dirty": dirty, "ahead": 0, "behind": 0, "stale_packages": [], "origin_before": "a",
                    "local_branches": [], "extra_worktrees": [], "remote_branches": [], "open_prs": []}
        infos = {n: info(n, d) for n, d in (("aidream", 3), ("matrx-frontend", 2), ("matrx-extend", 0),
                                            ("common-docs", 1))}
        def fake_ship(i, out_dir, stamp):
            events.append(("ship", i["repo"]))
            i["ship_started"], i["status"] = time.time(), "shipped"
        with tempfile.TemporaryDirectory() as code, tempfile.TemporaryDirectory() as out_root:
            for n in infos:
                Path(code, n, ".git").mkdir(parents=True)
            with patch.object(ship_all, "CODE", code), patch.object(ship_all, "OUT_ROOT", out_root), \
                 patch.object(ship_all, "inspect", side_effect=lambda p: infos[Path(p).name]), \
                 patch.object(ship_all, "ship", side_effect=fake_ship), \
                 patch.object(ship_all, "is_consumer", side_effect=lambda p: Path(p).name in ("matrx-frontend", "matrx-extend")), \
                 patch.object(ship_all, "source_pushed", return_value=True), \
                 patch.object(ship_all, "wait_for_publish_runs", side_effect=lambda since: events.append(("wait",)) or "waited"), \
                 patch.object(ship_all, "stale_packages", side_effect=lambda p: ["."] if p.endswith("matrx-extend") else []), \
                 patch.object(ship_all, "land_github_work"), \
                 patch.object(ship_all, "release_liveness", return_value=[]), \
                 patch.object(ship_all, "failed_release_workflows", return_value=[]), \
                 patch.object(ship_all, "npm_publish_lag", return_value=[]), \
                 patch.object(ship_all, "open_items", return_value=[]), \
                 patch.object(ship_all, "held_files", return_value=[]), \
                 patch.object(ship_all, "say"):
                ship_all.main([])
        wait = events.index(("wait",))
        self.assertLess(events.index(("ship", "aidream")), wait)
        self.assertLess(events.index(("ship", "common-docs")), wait)
        self.assertGreater(events.index(("ship", "matrx-frontend")), wait)
        # in sync before aidream published, behind after: shipped once, in wave 2
        self.assertGreater(events.index(("ship", "matrx-extend")), wait)
        self.assertEqual(len(events), 5)

    def test_failed_release_is_loud_but_never_holds_a_ship(self):
        # Arman, 2026-10-23: "NOTHING EVER STOPS MY releASeS" (supersedes the 2026-10-07 hold).
        def info(name):
            return {"repo": name, "path": "/x/" + name, "branch": "main", "has_ship": True,
                    "fetch_ok": True, "dirty": 1, "ahead": 0, "behind": 0,
                    "stale_packages": [], "local_branches": [], "extra_worktrees": [],
                    "remote_branches": [], "open_prs": []}
        infos = {name: info(name) for name in ("aidream", "matrx-frontend", "common-docs")}
        with tempfile.TemporaryDirectory() as code, tempfile.TemporaryDirectory() as out_root:
            for name in infos:
                Path(code, name, ".git").mkdir(parents=True)
            with patch.object(ship_all, "CODE", code), patch.object(ship_all, "OUT_ROOT", out_root), \
                 patch.object(ship_all, "inspect", side_effect=lambda p: infos[Path(p).name]), \
                 patch.object(ship_all, "ship") as ship, \
                 patch.object(ship_all, "land_github_work") as land, \
                 patch.object(ship_all, "release_liveness", side_effect=lambda i: ["v3447 ERROR"] if i["repo"] == "matrx-frontend" else []), \
                 patch.object(ship_all, "failed_release_workflows", return_value=[]), \
                 patch.object(ship_all, "test_run_verdict", return_value=([], [])), \
                 patch.object(ship_all, "npm_publish_lag", return_value=[]), \
                 patch.object(ship_all, "stale_release_alarm", return_value=None), \
                 patch.object(ship_all, "open_items", return_value=[]), \
                 patch.object(ship_all, "held_files", return_value=[]), \
                 patch.object(ship_all, "is_consumer", return_value=False), \
                 patch.object(ship_all, "source_pushed", return_value=False), \
                 patch.object(ship_all, "say") as say:
                result = ship_all.main([])
            self.assertEqual(result, 1)                      # still reported as a failure
            self.assertEqual(ship.call_count, len(infos))    # but every repo shipped
            said = " ".join(str(c.args[0]) for c in say.call_args_list if c.args)
            self.assertIn("FAILED BUILD", said)
            self.assertIn("v3447 ERROR", said)
            summary = json.loads(Path(out_root, "latest.json").read_text())
            frontend = next(r for r in summary["repos"] if r["repo"] == "matrx-frontend")
            self.assertEqual(frontend["not_live"], ["v3447 ERROR"])
            self.assertFalse(any(r["status"] == "held: failed build" for r in summary["repos"]))

    def test_publish_wait_ignores_runs_started_by_later_pushes(self):
        t = [1_000_000.0]
        def fake_run(cmd, cwd, timeout=120):
            iso = lambda x: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(x))
            # one run from the source's push (done) and one from a later push (still going)
            return 0, json.dumps([{"databaseId": 1, "status": "completed", "createdAt": iso(t[0] - 60)},
                                  {"databaseId": 2, "status": "in_progress", "createdAt": iso(t[0] + 300)}]), ""
        def fake_sleep(s):
            t[0] += s
        with patch.object(ship_all, "run", side_effect=fake_run):
            line = ship_all.wait_for_publish_runs(t[0] - 120, now=lambda: t[0], sleep=fake_sleep)
        self.assertIn("finished", line)

    def test_off_train_repo_never_checks_a_release_slot_or_releases(self):
        info = {"repo": "matrx-local", "path": "/unused/matrx-local", "dirty": 0, "ahead": 0, "behind": 0,
                "origin_before": ""}
        fake = SimpleNamespace(stdout=iter(["ship.sh: sync exit 0, release exit 0 (sync only)\n"]),
                               wait=lambda: 0, returncode=0)
        with tempfile.TemporaryDirectory() as out_dir, \
             patch.object(ship_all, "active_release_slot") as slot, \
             patch.object(ship_all.subprocess, "Popen", return_value=fake) as popen, \
             patch.object(ship_all, "say"):
            result = ship_all._ship_locked(info, out_dir, "stamp")
        slot.assert_not_called()
        self.assertNotIn("./ship.sh", " ".join(popen.call_args.args[0]))
        self.assertEqual(result["status"], "shipped")

    def test_busy_slot_never_spawns_ship_script(self):
        info = {"repo": "aidream", "path": "/unused/aidream"}
        with patch.object(ship_all, "active_release_slot", return_value="busy"), \
             patch.object(ship_all.subprocess, "Popen") as popen, \
             patch.object(ship_all, "say"):
            result = ship_all._ship_locked(info, "/unused/output", "stamp")
        self.assertEqual(result["status"], "RELEASE SLOT BUSY")
        self.assertEqual(result["release_slot_blocker"], "busy")
        popen.assert_not_called()

    def test_release_workflow_rest_rate_limit_uses_graphql_failure_verdict(self):
        info = {"repo": "example", "path": "/unused/example"}

        def responses(cmd, cwd, timeout):
            if cmd[:3] == ["gh", "run", "list"]:
                return 1, "", "HTTP 403: API rate limit exceeded"
            if cmd[:4] == ["git", "config", "--get", "remote.origin.url"]:
                return 0, "git@github.com:owner/example.git\n", ""
            if cmd[:3] == ["gh", "api", "graphql"]:
                return 0, self.graphql_history(conclusion="FAILURE"), ""
            self.fail("unexpected command: %r" % (cmd,))

        with patch.object(ship_all.os.path, "isdir", return_value=True), \
             patch.object(ship_all, "run", side_effect=responses):
            problems = ship_all.failed_release_workflows(info)
        self.assertEqual(len(problems), 1)
        self.assertIn("workflow 'Release' failure", problems[0])
        self.assertIn("GraphQL run 42", problems[0])

    def test_release_workflow_rest_rate_limit_keeps_graphql_unknown_unverified(self):
        info = {"repo": "example", "path": "/unused/example"}

        def responses(cmd, cwd, timeout):
            if cmd[:3] == ["gh", "run", "list"]:
                return 1, "", "HTTP 403: API rate limit exceeded"
            if cmd[:4] == ["git", "config", "--get", "remote.origin.url"]:
                return 0, "https://github.com/owner/example.git\n", ""
            if cmd[:3] == ["gh", "api", "graphql"]:
                return 0, self.graphql_history(status="IN_PROGRESS", conclusion=None), ""
            self.fail("unexpected command: %r" % (cmd,))

        with patch.object(ship_all.os.path, "isdir", return_value=True), \
             patch.object(ship_all, "run", side_effect=responses):
            problems = ship_all.failed_release_workflows(info)
        self.assertEqual(len(problems), 1)
        self.assertIn("UNVERIFIED", problems[0])
        self.assertIn("still IN_PROGRESS", problems[0])

    def test_release_workflow_rest_rate_limit_keeps_truncated_history_unverified(self):
        info = {"repo": "example", "path": "/unused/example"}
        history = json.loads(self.graphql_history())
        history["data"]["repository"]["defaultBranchRef"]["target"]["history"]["pageInfo"]["hasNextPage"] = True

        def responses(cmd, cwd, timeout):
            if cmd[:3] == ["gh", "run", "list"]:
                return 1, "", "HTTP 403: API rate limit exceeded"
            if cmd[:4] == ["git", "config", "--get", "remote.origin.url"]:
                return 0, "https://github.com/owner/example.git\n", ""
            if cmd[:3] == ["gh", "api", "graphql"]:
                return 0, json.dumps(history), ""
            self.fail("unexpected command: %r" % (cmd,))

        with patch.object(ship_all.os.path, "isdir", return_value=True), \
             patch.object(ship_all, "run", side_effect=responses):
            problems = ship_all.failed_release_workflows(info)
        self.assertIn("UNVERIFIED", problems[0])
        self.assertIn("history is incomplete", problems[0])

    def test_release_workflow_rest_rate_limit_never_treats_graphql_success_as_complete_census(self):
        info = {"repo": "example", "path": "/unused/example"}

        def responses(cmd, cwd, timeout):
            if cmd[:3] == ["gh", "run", "list"]:
                return 1, "", "HTTP 403: API rate limit exceeded"
            if cmd[:4] == ["git", "config", "--get", "remote.origin.url"]:
                return 0, "https://github.com/owner/example.git\n", ""
            if cmd[:3] == ["gh", "api", "graphql"]:
                return 0, self.graphql_history(conclusion="SUCCESS"), ""
            self.fail("unexpected command: %r" % (cmd,))

        with patch.object(ship_all.os.path, "isdir", return_value=True), \
             patch.object(ship_all, "run", side_effect=responses):
            problems = ship_all.failed_release_workflows(info)
        self.assertIn("UNVERIFIED", problems[0])
        self.assertIn("complete release-workflow census", problems[0])

    def test_release_workflow_non_rate_rest_error_does_not_fallback(self):
        info = {"repo": "example", "path": "/unused/example"}
        with patch.object(ship_all.os.path, "isdir", return_value=True), \
             patch.object(ship_all, "run", return_value=(1, "", "provider unavailable")) as run:
            problems = ship_all.failed_release_workflows(info)
        self.assertIn("gh could not answer", problems[0])
        self.assertEqual(run.call_count, 1)


class CutoverStopTests(unittest.TestCase):
    """THE CUTOVER STOP: ~/.matrx/cutover/STOP-SHIP holds every round, new or running."""

    def info(self, name):
        return {"repo": name, "path": "/x/" + name, "branch": "main", "has_ship": True,
                "fetch_ok": True, "dirty": 1, "ahead": 0, "behind": 0,
                "stale_packages": [], "local_branches": [], "extra_worktrees": [],
                "remote_branches": [], "open_prs": []}

    def test_new_round_exits_zero_before_any_repository_work(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as out_root:
            stop = Path(d, "STOP-SHIP")
            stop.write_text("monorepo cutover 2026-10-22\n")
            said = []
            with patch.object(ship_all, "CUTOVER_STOP", str(stop)), patch.object(ship_all, "OUT_ROOT", out_root), \
                 patch.object(ship_all, "inspect") as inspect, patch.object(ship_all, "ship") as ship, \
                 patch.object(ship_all, "land_github_work") as land, \
                 patch.object(ship_all, "say", side_effect=said.append):
                self.assertEqual(ship_all.main([]), 0)
            inspect.assert_not_called(); ship.assert_not_called(); land.assert_not_called()
            self.assertIn("cutover in progress, skipping", said[0])
            self.assertIn("monorepo cutover 2026-10-22", said[0])
            summary = json.loads(Path(out_root, "latest.json").read_text())
            self.assertEqual((summary["held"], summary["repos"]), ("cutover", []))

    def test_running_round_ships_nothing_once_the_stop_appears(self):
        with tempfile.TemporaryDirectory() as d:
            stop = Path(d, "STOP-SHIP")
            stop.write_text("")
            with patch.object(ship_all, "CUTOVER_STOP", str(stop)), \
                 patch.object(ship_all, "OUT_ROOT", d), \
                 patch.object(ship_all, "active_release_slot") as slot, \
                 patch.object(ship_all.subprocess, "Popen") as popen, patch.object(ship_all, "say"):
                result = ship_all.ship({"repo": "aidream", "path": "/unused"}, d, "stamp")
            self.assertEqual(result["status"], "held: cutover")
            slot.assert_not_called(); popen.assert_not_called()

    def test_running_round_lands_no_github_work_once_the_stop_appears(self):
        infos = {name: self.info(name) for name in ("aidream", "common-docs")}
        with tempfile.TemporaryDirectory() as code, tempfile.TemporaryDirectory() as out_root:
            for name in infos:
                Path(code, name, ".git").mkdir(parents=True)
            stop = Path(out_root, "STOP-SHIP")
            def ship_then_freeze(info, out_dir, stamp):
                stop.write_text("frozen mid-round\n")   # the freeze lands while this round ships
                info["status"] = "shipped"
                return info
            with patch.object(ship_all, "CODE", code), patch.object(ship_all, "OUT_ROOT", out_root), \
                 patch.object(ship_all, "CUTOVER_STOP", str(stop)), \
                 patch.object(ship_all, "inspect", side_effect=lambda p: infos[Path(p).name]), \
                 patch.object(ship_all, "ship", side_effect=ship_then_freeze), \
                 patch.object(ship_all, "is_consumer", return_value=False), \
                 patch.object(ship_all, "source_pushed", return_value=False), \
                 patch.object(ship_all, "land_github_work") as land, \
                 patch.object(ship_all, "release_liveness", return_value=[]), \
                 patch.object(ship_all, "failed_release_workflows", return_value=[]), \
                 patch.object(ship_all, "test_run_verdict", return_value=([], [])), \
                 patch.object(ship_all, "npm_publish_lag", return_value=[]), \
                 patch.object(ship_all, "stale_release_alarm", return_value=None), \
                 patch.object(ship_all, "open_items", return_value=[]), \
                 patch.object(ship_all, "held_files", return_value=[]), \
                 patch.object(ship_all, "say"):
                ship_all.main([])
            land.assert_not_called()

    def test_absent_stop_file_changes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(ship_all, "CUTOVER_STOP", str(Path(d, "STOP-SHIP"))):
                self.assertIsNone(ship_all.cutover_stop())
            fake = SimpleNamespace(stdout=iter(["ship.sh: sync exit 0, release exit 0\n"]), wait=lambda: 0, returncode=0)
            with patch.object(ship_all, "CUTOVER_STOP", str(Path(d, "STOP-SHIP"))), patch.object(ship_all, "OUT_ROOT", d), \
                 patch.object(ship_all, "active_release_slot", return_value=None), \
                 patch.object(ship_all.subprocess, "Popen", return_value=fake) as popen, \
                 patch.object(ship_all, "git", return_value=(0, "", "")), patch.object(ship_all, "say"):
                info = {"repo": "aidream", "path": "/unused", "dirty": 0, "ahead": 0, "behind": 0, "origin_before": ""}
                self.assertEqual(ship_all.ship(info, d, "s")["status"], "shipped")
            popen.assert_called_once()


class WorkspaceRootTests(unittest.TestCase):
    """THE CODE FOLDER is never derived from where ship lives (ship moves into aidream/infra/matrx-ship)."""

    def test_env_wins(self):
        with patch.dict(ship_all.os.environ, {"MATRX_CODE_DIR": "/some/code"}):
            self.assertEqual(ship_all.workspace_root(), "/some/code")

    def test_home_code_wins_over_ships_own_location(self):
        with tempfile.TemporaryDirectory() as home:
            code = Path(home, "code")
            nested = Path(code, "aidream", "infra", "matrx-ship", "scripts")
            nested.mkdir(parents=True)
            env = {k: v for k, v in ship_all.os.environ.items() if k != "MATRX_CODE_DIR"}
            with patch.dict(ship_all.os.environ, env, clear=True), patch.object(ship_all, "HERE", str(nested)), \
                 patch.object(ship_all.os.path, "expanduser",
                              side_effect=lambda p: p.replace("~", home, 1) if p.startswith("~") else p):
                self.assertEqual(ship_all.workspace_root(), str(code))   # never .../aidream/infra

    def test_a_symlink_into_a_host_is_part_of_it_never_a_second_repo(self):
        said = []
        with tempfile.TemporaryDirectory() as code:
            Path(code, "aidream", ".git").mkdir(parents=True)
            Path(code, "aidream", "common-docs", ".git").mkdir(parents=True)   # a stray .git left behind
            Path(code, "aidream", "infra", "matrx-ship").mkdir(parents=True)
            Path(code, "aidream", "apps", "matrx-frontend").mkdir(parents=True)
            Path(code, "matrx-extend", ".git").mkdir(parents=True)
            Path(code, "common-docs").symlink_to(Path(code, "aidream", "common-docs"))
            Path(code, "matrx-ship").symlink_to(Path(code, "aidream", "infra", "matrx-ship"))
            repos = [str(Path(code, d)) for d in ("aidream", "common-docs", "matrx-extend")]
            repos.append(str(Path(code, "aidream", "apps", "matrx-frontend")))   # a NESTED_TRAIN app
            with patch.object(ship_all, "CODE", code), patch.object(ship_all, "say", side_effect=said.append):
                kept = ship_all.parts_of_hosts(repos)
        self.assertEqual([Path(r).name for r in kept], ["aidream", "matrx-extend", "matrx-frontend"])
        text = "\n".join(said)
        self.assertIn("common-docs: inside aidream (common-docs)", text)
        self.assertIn("matrx-ship: part of aidream (infra/matrx-ship/)", text)

    def test_round_never_inspects_a_symlinked_part(self):
        inspected = []
        with tempfile.TemporaryDirectory() as code, tempfile.TemporaryDirectory() as out_root:
            Path(code, "aidream", ".git").mkdir(parents=True)
            Path(code, "aidream", "common-docs", ".git").mkdir(parents=True)
            Path(code, "common-docs").symlink_to(Path(code, "aidream", "common-docs"))
            def fake_inspect(p):
                inspected.append(Path(p).name)
                return {"repo": Path(p).name, "path": p, "branch": "main", "has_ship": True, "fetch_ok": True,
                        "dirty": 0, "ahead": 0, "behind": 0, "stale_packages": [], "local_branches": [],
                        "extra_worktrees": [], "remote_branches": [], "open_prs": []}
            with patch.object(ship_all, "CODE", code), patch.object(ship_all, "OUT_ROOT", out_root), \
                 patch.object(ship_all, "inspect", side_effect=fake_inspect), \
                 patch.object(ship_all, "ship"), patch.object(ship_all, "land_github_work"), \
                 patch.object(ship_all, "release_liveness", return_value=[]), \
                 patch.object(ship_all, "failed_release_workflows", return_value=[]), \
                 patch.object(ship_all, "test_run_verdict", return_value=([], [])), \
                 patch.object(ship_all, "npm_publish_lag", return_value=[]), \
                 patch.object(ship_all, "stale_release_alarm", return_value=None), \
                 patch.object(ship_all, "open_items", return_value=[]), \
                 patch.object(ship_all, "held_files", return_value=[]), \
                 patch.object(ship_all, "say"):
                ship_all.main(["--dry-run"])
        self.assertEqual(inspected, ["aidream"])


if __name__ == "__main__":
    unittest.main()
