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


if __name__ == "__main__":
    unittest.main()
