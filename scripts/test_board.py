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
    agent_sender_named()
    print("test_board: ok")


def agent_sender_named():
    """An agent that forgot --from sends as its own session (CLAUDE_CODE_SESSION_ID / CODEX_THREAD_ID);
    a session the server does not know goes out as a notice naming that session; only with nothing at
    all is it unnamed, and then the caller is warned loudly (143 unnamed rows, 2026-10-15..17)."""
    import contextlib
    import io

    saved = {k: os.environ.pop(k, None) for k in ("CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID",
                                                   "MATRX_AUTOMATION_LABEL", "MATRX_CONVERSATION_ID")}
    real_call, real_caller = board._call, board.caller_label
    sent = []
    board.caller_label = lambda: ""
    try:
        def ok(body):
            sent.append(body)
            return {"message_id": "m1"}
        board._call = ok
        os.environ["CLAUDE_CODE_SESSION_ID"] = SID
        board.post(["c1", "hi"])
        assert sent[-1]["from"] == SID, sent[-1]
        del os.environ["CLAUDE_CODE_SESSION_ID"]
        os.environ["CODEX_THREAD_ID"] = SID
        board.post(["c1", "hi"])
        assert sent[-1]["from"] == SID, sent[-1]

        def refuse_session(body):
            if body["from"] == SID:
                raise board.Refused(403, "not_your_session", "not yours")
            sent.append(body)
            return {"message_id": "m2"}
        board._call = refuse_session
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            board.post(["c1", "hi"])
        assert sent[-1]["from"] == "automation:Codex session " + SID[:8], sent[-1]
        assert "not known to AI Matrx" in err.getvalue()
        del os.environ["CODEX_THREAD_ID"]
        board._call = ok
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            board.post(["c1", "hi"])
        assert sent[-1]["from"] == "automation:" + board.UNNAMED, sent[-1]
        assert "WARNING" in err.getvalue() and "--from" in err.getvalue(), err.getvalue()
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            board.post(["c1", "hi", "--from", "ship-all"])
        assert sent[-1]["from"] == "automation:ship-all" and err.getvalue() == "", err.getvalue()
    finally:
        board._call, board.caller_label = real_call, real_caller
        for k, v in saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        sys.exit("test_board: FAILED %s" % e)
