#!/usr/bin/env python3
"""Assert adaptive collapse positioning for expanded Pi transcript built-ins."""

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


def fullest_frame(path: Path, required: str | None = None) -> list[str]:
    candidates = [
        (index, frame)
        for index, frame in enumerate(parser.frames(path))
        if required is None or any(required in row for row in frame)
    ]
    if not candidates:
        suffix = f" containing {required!r}" if required is not None else ""
        raise ValueError(f"{path.name}: no fullscreen frames{suffix}")
    return max(candidates, key=lambda item: (sum(bool(row.strip()) for row in item[1]), item[0]))[1]


def marker_rows(frame: list[str], prefix: str) -> dict[str, int]:
    pattern = re.compile(rf"{re.escape(prefix)}[0-9]{{2}}")
    return {
        match.group(0): row
        for row, text in enumerate(frame, 1)
        for match in pattern.finditer(text)
    }


def main(scratch: Path) -> None:
    failures: list[str] = []
    cases = {
        "compaction": ("Compacted from 1,234 tokens", "COMPACTION_VIEWPORT_DETAIL_"),
        "branch": ("Branch summary", "BRANCH_VIEWPORT_DETAIL_"),
        "shell": ("printf builtin-shell-viewport", "SHELL_VIEWPORT_DETAIL_"),
    }

    for name, (collapsed_marker, detail_prefix) in cases.items():
        whole_before = fullest_frame(scratch / f"{name}-whole-before.ansi")
        whole_after = fullest_frame(
            scratch / f"{name}-whole-after.ansi",
            "BUILTIN_VIEWPORT_AFTER_01",
        )
        bottom_before = fullest_frame(
            scratch / f"{name}-bottom-before.ansi",
            "BUILTIN_VIEWPORT_AFTER_03",
        )
        bottom_after = fullest_frame(
            scratch / f"{name}-bottom-after.ansi",
            "BUILTIN_VIEWPORT_AFTER_01",
        )

        if any("BUILTIN_VIEWPORT_BEFORE_" in row or "BUILTIN_VIEWPORT_AFTER_" in row for row in whole_before):
            failures.append(f"{name} whole viewport: fixture did not isolate the expanded component")

        for label, frame in (("whole viewport", whole_after), ("bottom edge", bottom_after)):
            collapsed_rows = [row for row, text in enumerate(frame, 1) if collapsed_marker in text]
            following_rows = marker_rows(frame, "BUILTIN_VIEWPORT_AFTER_")
            first_following_row = following_rows.get("BUILTIN_VIEWPORT_AFTER_01")
            if not collapsed_rows:
                failures.append(f"{name} {label}: collapsed block is not visible")
            if first_following_row is None:
                failures.append(f"{name} {label}: first following transcript row is not visible")
            elif collapsed_rows and min(collapsed_rows) >= first_following_row:
                failures.append(
                    f"{name} {label}: collapsed block does not precede following transcript: "
                    f"collapsed={collapsed_rows}, following={first_following_row}"
                )

        if not any(detail_prefix in row for row in bottom_before):
            failures.append(f"{name} bottom edge: expanded component is not visible above following transcript")
        before_rows = marker_rows(bottom_before, "BUILTIN_VIEWPORT_AFTER_")
        if not all(f"BUILTIN_VIEWPORT_AFTER_{index:02}" in before_rows for index in range(1, 4)):
            failures.append(f"{name} bottom edge: first three following transcript rows are not visible before collapse")

    if failures:
        print("BUILTIN_COLLAPSE_VIEWPORT_FAIL")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        raise SystemExit(1)
    print("BUILTIN_COLLAPSE_VIEWPORT_PASS")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: builtin-collapse-viewport-assert.py <scratch>")
    main(Path(sys.argv[1]))
