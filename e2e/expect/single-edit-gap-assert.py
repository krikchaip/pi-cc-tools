#!/usr/bin/env python3
"""Assert that a live single Edit has no physical row between summary and diff."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True

HEIGHT = 40
SUMMARY = re.compile(r"\+1\s+-1.*1 hunk")


def load_terminal_parser(width: int):
    parser_path = Path(__file__).with_name("async-diff-click-assert.py")
    spec = importlib.util.spec_from_file_location("async_diff_terminal", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load terminal parser: {parser_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.WIDTH = width
    module.HEIGHT = HEIGHT
    return module


def final_frame(path: Path, width: int) -> list[str]:
    parser = load_terminal_parser(width)
    frames = parser.frames(path)
    matches = [frame for frame in frames if any("E2E_SINGLE_EDIT_COMPLETE" in row for row in frame)]
    if not matches:
        raise AssertionError(f"{path.name}: final deterministic provider marker is absent")
    return matches[-1]


def visible_content(text: str) -> str:
    return text.strip().lstrip("├│└").strip()


def assert_case(path: Path, width: int, layout: str) -> str | None:
    frame = final_frame(path, width)
    summary_rows = [index for index, row in enumerate(frame) if SUMMARY.search(row)]
    if len(summary_rows) != 1:
        return f"{layout}: expected one live Edit summary, found {len(summary_rows)}"

    summary_row = summary_rows[0]
    if summary_row + 2 >= len(frame):
        return f"{layout}: summary is too close to terminal bottom for adjacency check"

    adjacent = frame[summary_row + 1]
    following = frame[summary_row + 2]
    empty_adjacent = visible_content(adjacent) == ""
    if layout == "unified":
        adjacent_is_expected_opening = "────" in adjacent
        following_is_expected_opening = "────" in following
        expected = "top horizontal diff border"
    else:
        adjacent_is_expected_opening = "old" in adjacent and "new" in adjacent and "┊" in adjacent
        following_is_expected_opening = "old" in following and "new" in following and "┊" in following
        expected = "old ┊ new header"

    if empty_adjacent and following_is_expected_opening:
        return (
            f"{layout}: unwanted empty physical row immediately follows summary at terminal row "
            f"{summary_row + 2}; {expected} is delayed to row {summary_row + 3}. "
            f"adjacent={adjacent!r}; following={following!r}"
        )
    if not adjacent_is_expected_opening:
        return (
            f"{layout}: fixture did not place the required {expected} directly after the summary; "
            f"adjacent={adjacent!r}; following={following!r}"
        )
    return None


def main(scratch: Path) -> None:
    failures = [
        failure
        for failure in (
            assert_case(scratch / "unified.ansi", 100, "unified"),
            assert_case(scratch / "split.ansi", 180, "split"),
        )
        if failure is not None
    ]
    if failures:
        print("SINGLE_EDIT_GAP_RED")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        raise SystemExit(1)
    print("SINGLE_EDIT_GAP_PASS")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: single-edit-gap-assert.py <scratch>")
    main(Path(sys.argv[1]))
