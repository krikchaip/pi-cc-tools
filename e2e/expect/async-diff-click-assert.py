#!/usr/bin/env python3
"""Locate async-diff anchors and assert stable real-Pi viewport transitions."""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

WIDTH = 100
HEIGHT = 40
CSI = re.compile(r"\x1b\[[?0-9;:>]*[ -/]*[@-~]")
OSC = re.compile(r"\x1b\].*?(?:\x07|\x1b\\)", re.DOTALL)


def plain_wire(raw: str) -> str:
    return CSI.sub("", OSC.sub("", raw))


def snapshots(raw: str) -> list[list[str]]:
    screen = [[" "] * WIDTH for _ in range(HEIGHT)]
    row = column = 0
    saved = (0, 0)
    frames: list[list[str]] = []

    def capture() -> None:
        frame = ["".join(line).rstrip() for line in screen]
        if any(frame):
            frames.append(frame)

    def param(numbers: list[int], index: int, default: int = 1) -> int:
        return numbers[index] if index < len(numbers) and numbers[index] else default

    index = 0
    while index < len(raw):
        if raw.startswith("\x1b]", index):
            bell = raw.find("\x07", index + 2)
            st = raw.find("\x1b\\", index + 2)
            ends = [end for end in (bell, st) if end >= 0]
            if not ends:
                break
            end = min(ends)
            index = end + (2 if raw.startswith("\x1b\\", end) else 1)
            continue
        if raw.startswith("\x1b[", index):
            match = CSI.match(raw, index)
            if not match:
                index += 2
                continue
            token = match.group(0)
            final = token[-1]
            body = token[2:-1]
            private = body.startswith(("?", ">", "!"))
            values = body.lstrip("?>!").split(";") if body.lstrip("?>!") else []
            numbers = [int(value) if value.isdigit() else 0 for value in values]
            if final in "Hf":
                if param(numbers, 0) == 1 and param(numbers, 1) == 1:
                    capture()
                row = max(0, min(HEIGHT - 1, param(numbers, 0) - 1))
                column = max(0, min(WIDTH - 1, param(numbers, 1) - 1))
            elif final == "A":
                row = max(0, row - param(numbers, 0))
            elif final in "BE":
                row = min(HEIGHT - 1, row + param(numbers, 0))
                if final == "E":
                    column = 0
            elif final == "F":
                row = max(0, row - param(numbers, 0))
                column = 0
            elif final == "C":
                column = min(WIDTH - 1, column + param(numbers, 0))
            elif final == "D":
                column = max(0, column - param(numbers, 0))
            elif final == "G":
                column = max(0, min(WIDTH - 1, param(numbers, 0) - 1))
            elif final == "d":
                row = max(0, min(HEIGHT - 1, param(numbers, 0) - 1))
            elif final == "J":
                mode = numbers[0] if numbers else 0
                if mode in (2, 3):
                    capture()
                    screen = [[" "] * WIDTH for _ in range(HEIGHT)]
                elif mode == 0:
                    screen[row][column:] = [" "] * (WIDTH - column)
                    for target in range(row + 1, HEIGHT):
                        screen[target] = [" "] * WIDTH
            elif final == "K":
                mode = numbers[0] if numbers else 0
                if mode == 0:
                    screen[row][column:] = [" "] * (WIDTH - column)
                elif mode == 1:
                    screen[row][: column + 1] = [" "] * (column + 1)
                elif mode == 2:
                    screen[row] = [" "] * WIDTH
            elif final == "s":
                saved = (row, column)
            elif final == "u":
                row, column = saved
            elif final == "S":
                amount = min(HEIGHT, param(numbers, 0))
                screen = screen[amount:] + [[" "] * WIDTH for _ in range(amount)]
            elif final == "T":
                amount = min(HEIGHT, param(numbers, 0))
                screen = [[" "] * WIDTH for _ in range(amount)] + screen[: HEIGHT - amount]
            elif private and final == "l" and "2026" in body:
                capture()
            index = match.end()
            continue
        char = raw[index]
        if char == "\r":
            column = 0
        elif char == "\n":
            row = min(HEIGHT - 1, row + 1)
        elif char == "\b":
            column = max(0, column - 1)
        elif char == "\t":
            column = min(WIDTH - 1, ((column // 8) + 1) * 8)
        elif char >= " ":
            char_width = 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
            if column < WIDTH:
                screen[row][column] = char
                if char_width == 2 and column + 1 < WIDTH:
                    screen[row][column + 1] = " "
            column = min(WIDTH - 1, column + char_width)
        index += 1
    capture()
    return frames


def frames(path: Path) -> list[list[str]]:
    return snapshots(path.read_text(errors="replace"))


def matching_frame(path: Path, required: str) -> list[str]:
    matches = [frame for frame in frames(path) if any(required in row for row in frame)]
    if not matches:
        raise ValueError(f"{path.name}: no frame contains {required!r}")
    return matches[-1]


def token_rows(frame: list[str], pattern: str) -> dict[str, int]:
    regex = re.compile(pattern)
    return {
        match.group(0): row_index
        for row_index, text in enumerate(frame, 1)
        for match in regex.finditer(text)
    }


def locate(path: Path, pattern: str) -> None:
    frame = matching_frame(path, pattern)
    for row_index, text in enumerate(frame, 1):
        column = text.find(pattern)
        if column >= 0:
            print(column + 1, row_index)
            return
    raise ValueError(f"{path.name}: could not locate {pattern!r}")


def main_assert(scratch: Path) -> None:
    failures: list[str] = []

    def frame(name: str, required: str) -> list[str]:
        try:
            return matching_frame(scratch / name, required)
        except ValueError as error:
            failures.append(str(error))
            return []

    def frozen(label: str, before: list[str], after: list[str], pattern: str, minimum: int = 1) -> None:
        before_rows = token_rows(before, pattern)
        after_rows = token_rows(after, pattern)
        common = sorted(before_rows.keys() & after_rows.keys())
        if len(common) < minimum:
            failures.append(f"{label}: need {minimum} shared markers, got {common}; before={before_rows}; after={after_rows}")
            return
        moved = [f"{token}: {before_rows[token]} -> {after_rows[token]}" for token in common if before_rows[token] != after_rows[token]]
        if moved:
            failures.append(f"{label}: frozen rows moved: " + ", ".join(moved))

    header_before = frame("header-before-expand.ansi", "powerline-narrow.expect")
    header_expanded = frame("header-after-expand.ansi", "powerline-narrow.expect")
    header_collapsed = frame("header-after-collapse.ansi", "powerline-narrow.expect")
    frozen("header expansion", header_before, header_expanded, r"BEFORE_CREATE_[0-9]+|powerline-narrow\.expect")
    frozen("header collapse", header_expanded, header_collapsed, r"BEFORE_CREATE_[0-9]+|powerline-narrow\.expect")

    summary_before = frame("summary-before-expand.ansi", "+33")
    summary_expanded = frame("summary-after-expand.ansi", "powerline-narrow.expect")
    summary_collapsed = frame("summary-after-collapse.ansi", "powerline-narrow.expect")
    frozen("result-summary expansion", summary_before, summary_expanded, r"BEFORE_CREATE_[0-9]+|powerline-narrow\.expect")
    frozen("result-summary collapse", summary_expanded, summary_collapsed, r"BEFORE_CREATE_[0-9]+|powerline-narrow\.expect")

    bottom_before = frame("bottom-before-collapse.ansi", "click to collapse")
    bottom_after = frame("bottom-after-collapse.ansi", "more diff lines")
    frozen("bottom collapse", bottom_before, bottom_after, r"BETWEEN_TOOLS_[0-9]+|async-edit\.ts", minimum=2)
    if any("click to collapse" in row for row in bottom_after):
        failures.append("bottom collapse settled with the expansion footer still visible")

    top_transitions = (
        "header-expand-transition.ansi",
        "header-collapse-transition.ansi",
        "summary-expand-transition.ansi",
        "summary-collapse-transition.ansi",
    )
    for name in (*top_transitions, "bottom-collapse-transition.ansi"):
        raw = (scratch / name).read_text(errors="replace")
        plain = plain_wire(raw)
        transient = next(
            (token for token in ("rendering diff", "(rendering", "calculating localized diff") if token in plain),
            None,
        )
        if transient:
            failures.append(f"{name}: visible async placeholder caused flicker: {transient!r}")
        if name in top_transitions:
            paint_batches = raw.split("\x1b[?2026h")[1:]
            stable_repaints = sum(
                1
                for batch in paint_batches
                if "BEFORE_CREATE_" in batch or "powerline-narrow.expect" in batch
            )
            if stable_repaints > 1:
                failures.append(f"{name}: repainted stable top-anchor rows {stable_repaints} times")

    if failures:
        print("ASYNC_DIFF_CLICK_FAIL")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        raise SystemExit(1)
    print("ASYNC_DIFF_CLICK_PASS")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "locate":
        locate(Path(sys.argv[2]), sys.argv[3])
    elif len(sys.argv) == 2:
        main_assert(Path(sys.argv[1]))
    else:
        raise SystemExit("usage: async-diff-click-assert.py <scratch> | locate <capture> <pattern>")
