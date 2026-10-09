#!/usr/bin/env python3
"""Focused regression tests for the ship-all command boundary."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("ship_all.py")
SPEC = importlib.util.spec_from_file_location("ship_all", MODULE_PATH)
ship_all = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ship_all)


class ShipAllCliTests(unittest.TestCase):
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
        release = {"state": "BUILDING", "meta": {"githubCommitMessage": "release-all: v1"}}
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
        second = {"deployments": [{"state": "BUILDING", "meta": {"githubCommitMessage": "release-all: v2"}}],
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

    def test_release_workflow_non_rate_rest_error_does_not_fallback(self):
        info = {"repo": "example", "path": "/unused/example"}
        with patch.object(ship_all.os.path, "isdir", return_value=True), \
             patch.object(ship_all, "run", return_value=(1, "", "provider unavailable")) as run:
            problems = ship_all.failed_release_workflows(info)
        self.assertIn("gh could not answer", problems[0])
        self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
