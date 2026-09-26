#!/usr/bin/env python3
"""Focused regression tests for the ship-all command boundary."""
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
