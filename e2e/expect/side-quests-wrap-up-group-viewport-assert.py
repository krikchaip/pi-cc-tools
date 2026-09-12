#!/usr/bin/env python3
"""Assert adaptive collapse positioning for a WRAP UP banner after a groupable tool."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PARSER_PATH = HERE / "async-diff-click-assert.py"
spec = importlib.util.spec_from_file_location("fullscreen_parser", PARSER_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"could not load fullscreen parser: {PARSER_PATH}")
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def fullest_frame(path: Path, required: str) -> list[str]:
    candidates = [
        (index, frame)
        for index, frame in enumerate(parser.frames(path))
        if any(required in row for row in frame)
    ]
    if not candidates:
        raise ValueError(f"{path.name}: no fullscreen frame contains {required!r}")
    return max(candidates, key=lambda item: (sum(bool(row.strip()) for row in item[1]), item[0]))[1]


def marker_rows(frame: list[str], prefix: str) -> dict[str, int]:
    pattern = re.compile(rf"{re.escape(prefix)}[0-9]{{2}}")
    found: dict[str, int] = {}
    for row, text in enumerate(frame, 1):
        for match in pattern.finditer(text):
            token = match.group(0)
            if token in found:
                raise ValueError(
                    f"duplicate marker {token!r} at rows {found[token]} and {row}"
                )
            found[token] = row
    return found


def main(scratch: Path) -> None:
    failures: list[str] = []
    collapsed = fullest_frame(scratch / "collapsed.ansi", "WRAP_UP_VIEWPORT_AFTER_01")
    whole_before = fullest_frame(scratch / "whole-before.ansi", "WRAP_UP_VIEWPORT_DETAIL_40")
    whole_after = fullest_frame(scratch / "whole-after.ansi", "WRAP_UP_VIEWPORT_AFTER_15")
    bottom_before = fullest_frame(scratch / "bottom-before.ansi", "WRAP_UP_VIEWPORT_DETAIL_60")
    bottom_after = fullest_frame(scratch / "bottom-after.ansi", "WRAP_UP_VIEWPORT_AFTER_15")

    if any("Tools:" in row for row in collapsed):
        failures.append("grouping: WRAP UP was grouped with the preceding Read tool")
    if any("WRAP_UP_VIEWPORT_BEFORE_" in row or "WRAP_UP_VIEWPORT_AFTER_" in row for row in whole_before):
        failures.append("whole viewport: fixture did not isolate the expanded WRAP UP banner")
    if not any("WRAP UP" in row for row in whole_after):
        failures.append("whole viewport: collapsed WRAP UP banner is not visible")
    if any("WRAP_UP_VIEWPORT_DETAIL_25" in row for row in whole_after):
        failures.append("whole viewport: expanded WRAP UP details remained visible")

    before_rows = marker_rows(bottom_before, "WRAP_UP_VIEWPORT_AFTER_")
    after_rows = marker_rows(bottom_after, "WRAP_UP_VIEWPORT_AFTER_")
    common = sorted(before_rows.keys() & after_rows.keys())
    if len(common) < 3:
        failures.append(f"bottom edge: need three shared following rows, got {common}")
    moved = [
        f"{token}: {before_rows[token]} -> {after_rows[token]}"
        for token in common
        if before_rows[token] != after_rows[token]
    ]
    if moved:
        failures.append("bottom edge: following transcript rows moved: " + ", ".join(moved))
    if not any("to expand" in row for row in bottom_after):
        failures.append("bottom edge: collapsed WRAP UP banner edge is not visible")
    if any("WRAP_UP_VIEWPORT_DETAIL_60" in row for row in bottom_after):
        failures.append("bottom edge: expanded WRAP UP details remained visible")

    if failures:
        print("SIDE_QUESTS_WRAP_UP_GROUP_VIEWPORT_FAIL")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        raise SystemExit(1)
    print("SIDE_QUESTS_WRAP_UP_GROUP_VIEWPORT_PASS")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: side-quests-wrap-up-group-viewport-assert.py <scratch>")
    main(Path(sys.argv[1]))
