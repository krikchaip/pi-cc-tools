#!/usr/bin/env python3
"""Assert adaptive collapse positioning for the Side Quests ask_parent banner."""

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
    whole_before = fullest_frame(scratch / "whole-before.ansi", "ASK_PARENT_VIEWPORT_DETAIL_25")
    whole_after = fullest_frame(scratch / "whole-after.ansi", "ASK_PARENT_VIEWPORT_AFTER_15")
    bottom_before = fullest_frame(scratch / "bottom-before.ansi", "ASK_PARENT_VIEWPORT_DETAIL_60")
    bottom_after = fullest_frame(scratch / "bottom-after.ansi", "ASK_PARENT_VIEWPORT_AFTER_15")
    rollback_before = fullest_frame(scratch / "rollback-before.ansi", "ASK_PARENT_VIEWPORT_DETAIL_25")
    double_after = fullest_frame(scratch / "double-after.ansi", "ASK_PARENT_VIEWPORT_DETAIL_25")
    triple_after = fullest_frame(scratch / "triple-after.ansi", "ASK_PARENT_VIEWPORT_DETAIL_25")

    if any("ASK_PARENT_VIEWPORT_BEFORE_" in row or "ASK_PARENT_VIEWPORT_AFTER_" in row for row in whole_before):
        failures.append("whole viewport: fixture did not isolate the expanded ask_parent banner")
    if not any("ASK PARENT" in row for row in whole_after):
        failures.append("whole viewport: collapsed ask_parent banner is not visible")
    if any("ASK_PARENT_VIEWPORT_DETAIL_20" in row for row in whole_after):
        failures.append("whole viewport: expanded ask_parent details remained visible")

    before_rows = marker_rows(bottom_before, "ASK_PARENT_VIEWPORT_AFTER_")
    after_rows = marker_rows(bottom_after, "ASK_PARENT_VIEWPORT_AFTER_")
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
        failures.append("bottom edge: collapsed ask_parent banner edge is not visible")
    if any("ASK_PARENT_VIEWPORT_DETAIL_60" in row for row in bottom_after):
        failures.append("bottom edge: expanded ask_parent details remained visible")

    rollback_rows = marker_rows(rollback_before, "ASK_PARENT_VIEWPORT_DETAIL_")
    for label, frame in (("double click", double_after), ("triple click", triple_after)):
        selected_rows = marker_rows(frame, "ASK_PARENT_VIEWPORT_DETAIL_")
        common = sorted(rollback_rows.keys() & selected_rows.keys())
        if len(common) < 20:
            failures.append(f"{label}: expanded geometry was not restored; shared rows={common}")
            continue
        # Pi repaints the selected word or line separately. Keep the invariant
        # above that selection repaint, where the frame parser stays exact.
        stable = common[:20]
        moved = [
            f"{token}: {rollback_rows[token]} -> {selected_rows[token]}"
            for token in stable
            if rollback_rows[token] != selected_rows[token]
        ]
        if moved:
            failures.append(f"{label}: restored viewport rows moved: " + ", ".join(moved))

    if failures:
        print("SIDE_QUESTS_ASK_PARENT_VIEWPORT_FAIL")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        raise SystemExit(1)
    print("SIDE_QUESTS_ASK_PARENT_VIEWPORT_PASS")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: side-quests-ask-parent-viewport-assert.py <scratch>")
    main(Path(sys.argv[1]))
