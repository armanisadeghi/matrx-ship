#!/usr/bin/env python3
"""Print SHA-256 prefixes without echoing secret input.

Pipe a single secret or credential document on stdin. Use --lines only when
stdin deliberately contains one secret per non-empty line. Avoid shell command
arguments because they may be retained in shell history or process listings.
"""

from __future__ import annotations

import argparse
import hashlib
import sys


def fingerprint(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()[:12]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--lines",
        action="store_true",
        help="fingerprint each non-empty input line separately",
    )
    args = parser.parse_args()
    payload = sys.stdin.buffer.read()
    if not payload:
        parser.error("no secret bytes received on stdin")

    if args.lines:
        items = [line for line in payload.splitlines() if line]
        if not items:
            parser.error("no non-empty secret lines received on stdin")
        for index, item in enumerate(items, start=1):
            print(f"item={index} sha256_12={fingerprint(item)} bytes={len(item)}")
        return 0

    print(f"sha256_12={fingerprint(payload)} bytes={len(payload)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
