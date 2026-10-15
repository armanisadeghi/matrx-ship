#!/usr/bin/env python3
"""board.py never sends as the person: a session id is that session, anything else is an automation.

  python3 scripts/test_board.py      (exits non-zero on failure)
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("board", os.path.join(HERE, "board.py"))
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)

SID = "0b5b7a51-1111-2222-3333-444444444444"


def main():
    os.environ.pop("MATRX_AUTOMATION_LABEL", None)
    as_session = board.build("claude 7665566b", "hi", False, SID)
    assert as_session == {"to": "claude 7665566b", "priority": "note", "from": SID, "text": "hi"}, as_session
    named = board.build("c1", "FRONTEND BUILD FAILED", True, "ship-all")
    assert named == {"to": "c1", "priority": "urgent", "from": "automation:ship-all",
                     "text": "FRONTEND BUILD FAILED"}, named
    os.environ["MATRX_AUTOMATION_LABEL"] = "frontend release"
    assert board.build("c1", "x", False, "")["from"] == "automation:frontend release"
    del os.environ["MATRX_AUTOMATION_LABEL"]
    unnamed = board.build("c1", "x", False, "")["from"]
    assert unnamed.startswith("automation:") and unnamed != "automation:", unnamed
    for who in ("", "ship-all", "Codex lane 7", SID):
        assert board.build("c1", "x", False, who)["from"] != "person", who
    print("test_board: ok")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        sys.exit("test_board: FAILED %s" % e)
