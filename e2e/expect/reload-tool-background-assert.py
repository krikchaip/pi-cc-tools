#!/usr/bin/env python3
"""Reject outer Box background fills on tool rows before and after /reload."""

from __future__ import annotations

import re
import sys
from pathlib import Path

OSC_END = re.compile(r"\x1b\]8;;(?:\x07|\x1b\\)")
SGR = re.compile(r"\x1b\[([0-9;]*)m")
BG_PARAMS = re.compile(r"^(?:49|4[0-7]|10[0-7]|48;(?:5;\d+|2;\d+;\d+;\d+))$")
TOOL_SUCCESS_BG = "\x1b[48;2;40;50;40m"
TOKEN = "6 lines loaded"


def fail(message: str, chunk: str = "") -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    if chunk:
        print(chunk.replace("\x1b", "<ESC>"), file=sys.stderr)
    raise SystemExit(1)


def result_chunk(raw: str, label: str) -> str:
    chunks = re.split(r"\r?\n|\x1b\]8;;(?:\x07|\x1b\\)", raw)
    matches = [chunk for chunk in chunks if TOKEN in chunk]
    if not matches:
        fail(f"{label}: no physical result row contains {TOKEN!r}")
    return matches[-1]


def assert_clean_outer_background(path: Path) -> None:
    raw = path.read_text(errors="replace")
    chunk = result_chunk(raw, path.name)
    first = SGR.search(chunk)
    if not first:
        fail(f"{path.name}: result row has no ANSI styling", chunk)
    if BG_PARAMS.fullmatch(first.group(1)):
        fail(f"{path.name}: result row starts with outer background SGR {first.group(0)!r}", chunk)
    if TOOL_SUCCESS_BG in chunk:
        fail(f"{path.name}: result row contains the dark-theme toolSuccessBg fill", chunk)


if len(sys.argv) != 2:
    fail("usage: reload-tool-background-assert.py SCRATCH")
scratch = Path(sys.argv[1])
for mode in ("outlines", "transparent"):
    for phase in ("before", "after"):
        path = scratch / f"{mode}-{phase}.ansi"
        if not path.is_file():
            fail(f"missing capture: {path}")
        assert_clean_outer_background(path)

print("PASS outlines and transparent tool rows keep clean outer backgrounds across /reload")
