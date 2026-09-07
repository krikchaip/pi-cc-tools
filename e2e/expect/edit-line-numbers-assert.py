#!/usr/bin/env python3
"""Locate Edit summaries and compare line numbers before and after expansion."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

WIDTH = 180
HEIGHT = 80


def load_terminal_parser():
    parser_path = Path(__file__).with_name("async-diff-click-assert.py")
    spec = importlib.util.spec_from_file_location("async_diff_terminal", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load terminal parser: {parser_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.WIDTH = WIDTH
    module.HEIGHT = HEIGHT
    return module


def final_frame(path: Path) -> list[str]:
    frames = load_terminal_parser().frames(path)
    if not frames:
        raise AssertionError(f"{path.name}: capture contains no terminal frames")
    return frames[-1]


def locate(path: Path, pattern: str) -> None:
    frame = final_frame(path)
    for row_index, text in enumerate(frame, 1):
        column = text.find(pattern)
        if column >= 0:
            print(column + 1, row_index)
            return
    raise AssertionError(f"{path.name}: cannot locate {pattern!r}")


def line_numbers(path: Path, token: str) -> list[tuple[int, str]]:
    frames = load_terminal_parser().frames(path)
    matching = [frame for frame in frames if any(token in row for row in frame)]
    if not matching:
        raise AssertionError(f"no captured terminal frame contains {token!r}")
    rows = [row for row in matching[-1] if token in row]
    if len(rows) != 1:
        raise AssertionError(f"expected one row containing {token!r}, found {len(rows)}: {rows}")
    row = rows[0]
    matches = [(int(number), sign) for number, sign in re.findall(r"\b(\d+)\s*([-+])", row)]
    if not matches:
        raise AssertionError(f"cannot find a diff line number for {token!r}: {row!r}")
    return matches


def line_number(path: Path, token: str) -> int:
    return line_numbers(path, token)[-1][0]


def assert_case(scratch: Path, case: str, expected: dict[str, int]) -> list[str]:
    failures: list[str] = []
    before = scratch / f"{case}-collapsed.ansi"
    after = scratch / f"{case}-expanded.ansi"
    for token, source_line in expected.items():
        try:
            collapsed_number = line_number(before, token)
            expanded_number = line_number(after, token)
        except AssertionError as error:
            failures.append(f"{case} {token}: {error}")
            continue
        if collapsed_number != source_line:
            failures.append(
                f"{case} {token}: collapsed line number is {collapsed_number}, expected {source_line}"
            )
        if expanded_number != source_line:
            failures.append(
                f"{case} {token}: expanded line number changed to {expanded_number}, expected {source_line} "
                f"(collapsed={collapsed_number})"
            )
    return failures


def assert_pairs(
    scratch: Path,
    case: str,
    expected: dict[str, tuple[int, int]],
) -> list[str]:
    failures: list[str] = []
    before = scratch / f"{case}-collapsed.ansi"
    after = scratch / f"{case}-expanded.ansi"
    for token, pair in expected.items():
        expected_numbers = [(pair[0], "-"), (pair[1], "+")]
        for state, path in (("collapsed", before), ("expanded", after)):
            try:
                actual = line_numbers(path, token)
            except AssertionError as error:
                failures.append(f"{case} {token} {state}: {error}")
                continue
            if actual != expected_numbers:
                failures.append(
                    f"{case} {token} {state}: line numbers are {actual}, expected {expected_numbers}"
                )
    return failures


def main(scratch: Path) -> None:
    failures = [
        *assert_case(
            scratch,
            "single",
            {"ORIGINAL_201": 201, "SINGLE_201": 201},
        ),
        *assert_pairs(
            scratch,
            "multiple",
            {
                "ORIGINAL_027": (27, 27),
                "ORIGINAL_083": (83, 88),
                "ORIGINAL_119": (119, 130),
            },
        ),
    ]
    if failures:
        print("EDIT_LINE_NUMBERS_RED")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        raise SystemExit(1)
    print("EDIT_LINE_NUMBERS_PASS")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "locate":
        locate(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 2:
        main(Path(sys.argv[1]))
    else:
        raise SystemExit("usage: edit-line-numbers-assert.py <scratch> | locate <capture> <pattern>")
