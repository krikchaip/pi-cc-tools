#!/usr/bin/env python3
"""Assert stable success status for reconstructed historical tool rows."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
WIDTH = 88
HEIGHT = 32
TOKENS = ("COMPLETED_HISTORY_STATUS.txt", "SETTLED_PARTIAL_TREE_LEAF.txt")
SUCCESS = "\x1b[38;2;181;189;104m"
DIM = "\x1b[38;2;102;102;102m"


def load_parser():
    path = Path(__file__).with_name("async-diff-click-assert.py")
    spec = importlib.util.spec_from_file_location("historical_status_terminal", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load terminal parser: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.WIDTH = WIDTH
    module.HEIGHT = HEIGHT
    return module


def fail(message: str, frame: list[str] | None = None) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    if frame:
        print("--- reconstructed frame ---", file=sys.stderr)
        print("\n".join(frame), file=sys.stderr)
    raise SystemExit(1)


def matching_frame(parser, raw: str) -> list[str]:
    matches = [
        frame for frame in parser.snapshots(raw)
        if all(any(token in row for row in frame) for token in TOKENS)
    ]
    if not matches:
        fail("capture has no complete historical-status frame")
    return matches[-1]


def assert_success_rows(frame: list[str], label: str) -> None:
    for token in TOKENS:
        rows = [row for row in frame if token in row]
        if len(rows) != 1:
            fail(f"{label}: expected one row for {token}, found {len(rows)}", frame)
        row = rows[0]
        if not re.match(rf"^\s*●\s+Read\s+.*{re.escape(token)}", row):
            fail(f"{label}: reconstructed row is not a solid successful Read row: {row!r}", frame)
        if "○" in row:
            fail(f"{label}: reconstructed row retained an idle hollow dot: {row!r}", frame)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: historical-status-reconstruction-assert.py SCRATCH")
    scratch = Path(sys.argv[1])
    names = ["initial.ansi", "phase-1.ansi", "phase-2.ansi", "phase-3.ansi", "phase-4.ansi"]
    paths = [scratch / name for name in names]
    if any(not path.is_file() for path in paths):
        fail(f"missing timed capture under {scratch}")

    raws = [path.read_text(errors="replace") for path in paths]
    if not raws[0]:
        fail("initial capture is empty")

    # Each initial physical row must carry Pi dark-theme success ANSI. A dim
    # status color would mean the old idle path survived.
    row_chunks = re.split(r"\x1b\]8;;(?:\x07|\x1b\\)|\r?\n", raws[0])
    for token in TOKENS:
        chunks = [chunk for chunk in row_chunks if token in chunk]
        if not chunks:
            fail(f"initial ANSI capture has no physical row for {token}")
        chunk = chunks[-1]
        if SUCCESS not in chunk or "●" not in chunk:
            fail(f"{token} lacks success ANSI {SUCCESS!r}: {chunk!r}")
        if DIM in chunk[: chunk.find(token)] and SUCCESS not in chunk[: chunk.find(token)]:
            fail(f"{token} uses dim status ANSI instead of success: {chunk!r}")

    parser = load_parser()
    cumulative = ""
    reference_rows: dict[str, str] = {}
    for index, (name, raw) in enumerate(zip(names, raws)):
        cumulative += raw
        frame = matching_frame(parser, cumulative)
        assert_success_rows(frame, name)
        rows = {token: next(row for row in frame if token in row) for token in TOKENS}
        if index == 0:
            reference_rows = rows
        elif rows != reference_rows:
            fail(f"{name}: status rows changed across the 500 ms blink cycle", frame)

    print("PASS historical completed and settled-partial rows stay solid success across timed captures")


if __name__ == "__main__":
    main()
