#!/usr/bin/env python3
"""Assert connector-free two-space indentation for a completed Edit error."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
WIDTH = 88
HEIGHT = 32
ERROR = "EDIT_ERROR_PREFIX_SENTINEL"
READY = "EDIT_ERROR_PREFIX_READY"


def fail(message: str, frame: list[str] | None = None) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    if frame:
        print("--- reconstructed frame ---", file=sys.stderr)
        print("\n".join(frame), file=sys.stderr)
    raise SystemExit(1)


def load_parser():
    path = Path(__file__).with_name("async-diff-click-assert.py")
    spec = importlib.util.spec_from_file_location("edit_error_prefix_terminal", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load terminal parser: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.WIDTH = WIDTH
    module.HEIGHT = HEIGHT
    return module


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: edit-error-prefix-assert.py CAPTURE")
    path = Path(sys.argv[1])
    parser = load_parser()
    frames = [
        frame for frame in parser.snapshots(path.read_text(errors="replace"))
        if any(READY in row for row in frame) and any(ERROR in row for row in frame)
    ]
    if not frames:
        fail("capture has no complete Edit error frame")
    frame = frames[-1]
    rows = [row for row in frame if ERROR in row]
    if len(rows) != 1:
        fail(f"expected one Edit error row, found {len(rows)}", frame)
    row = rows[0]
    if not row.startswith(f"  {ERROR}"):
        fail(f"Edit error is not aligned with exactly two leading spaces: {row!r}", frame)
    if re.match(r"^\s*[├│└] ", row):
        fail(f"Edit error retained a branch connector: {row!r}", frame)
    print("PASS Edit error uses two-space connector-free indentation")


if __name__ == "__main__":
    main()
