#!/usr/bin/env python3
"""Assert click-anchor viewport invariants against full Pi repaint logs."""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

scratch = Path(sys.argv[1])
failures: list[str] = []
CSI = re.compile(r"\x1b\[[?0-9;:>]*[ -/]*[@-~]")
WIDTH = 100
HEIGHT = 40


def snapshots(raw: str, initial: list[str] | None = None) -> list[list[str]]:
    screen = [list(line.ljust(WIDTH)[:WIDTH]) for line in initial] if initial else [[" "] * WIDTH for _ in range(HEIGHT)]
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
            elif final == "A": row = max(0, row - param(numbers, 0))
            elif final in "BE":
                row = min(HEIGHT - 1, row + param(numbers, 0))
                if final == "E": column = 0
            elif final == "F": row = max(0, row - param(numbers, 0)); column = 0
            elif final == "C": column = min(WIDTH - 1, column + param(numbers, 0))
            elif final == "D": column = max(0, column - param(numbers, 0))
            elif final == "G": column = max(0, min(WIDTH - 1, param(numbers, 0) - 1))
            elif final == "d": row = max(0, min(HEIGHT - 1, param(numbers, 0) - 1))
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
                if mode == 0: screen[row][column:] = [" "] * (WIDTH - column)
                elif mode == 1: screen[row][:column + 1] = [" "] * (column + 1)
                elif mode == 2: screen[row] = [" "] * WIDTH
            elif final == "s": saved = (row, column)
            elif final == "u": row, column = saved
            elif final == "S":
                amount = min(HEIGHT, param(numbers, 0))
                screen = screen[amount:] + [[" "] * WIDTH for _ in range(amount)]
            elif final == "T":
                amount = min(HEIGHT, param(numbers, 0))
                screen = [[" "] * WIDTH for _ in range(amount)] + screen[:HEIGHT - amount]
            elif private and final == "l" and "2026" in body:
                capture()
            index = match.end()
            continue
        char = raw[index]
        if char == "\r": column = 0
        elif char == "\n": row = min(HEIGHT - 1, row + 1)
        elif char == "\b": column = max(0, column - 1)
        elif char == "\t": column = min(WIDTH - 1, ((column // 8) + 1) * 8)
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


def frame(name: str, required: str) -> list[str]:
    raw = (scratch / name).read_text(errors="replace")
    matches = [candidate for candidate in snapshots(raw) if any(required in row for row in candidate)]
    if not matches:
        failures.append(f"{name}: no complete frame contains {required!r}")
        return []
    return matches[-1]


def token_rows(candidate: list[str], pattern: str) -> dict[str, int]:
    found: dict[str, int] = {}
    regex = re.compile(pattern)
    for row_index, text in enumerate(candidate, 1):
        for match in regex.finditer(text):
            found[match.group(0)] = row_index
    return found


def assert_frozen(label: str, before: list[str], after: list[str], pattern: str, minimum: int = 1) -> None:
    before_rows = token_rows(before, pattern)
    after_rows = token_rows(after, pattern)
    common = sorted(before_rows.keys() & after_rows.keys())
    if len(common) < minimum:
        failures.append(
            f"{label}: need {minimum} shared marker(s), got {common}\n"
            f"before={before_rows}\nafter={after_rows}"
        )
        return
    moved = [f"{token}: {before_rows[token]} -> {after_rows[token]}" for token in common if before_rows[token] != after_rows[token]]
    if moved:
        failures.append(f"{label}: frozen transcript rows moved: " + ", ".join(moved))


if len(sys.argv) > 2 and sys.argv[2] == "transient-tail":
    token = "transcript-tail.txt"
    before_frames = snapshots((scratch / "tail-before.ansi").read_text(errors="replace"))
    before_matches = [candidate for candidate in before_frames if token in "\n".join(candidate)]
    if not before_matches:
        raise SystemExit(f"TRANSCRIPT_TAIL_CLICK_FLICKER_FAIL: compact frame has no {token!r}")
    before = before_matches[-1]
    transition_frames = snapshots(
        (scratch / "tail-transition.ansi").read_text(errors="replace"),
        initial=before,
    )
    expected_rows = token_rows(before, re.escape(token))
    expected = expected_rows.get(token)
    observed = [token_rows(candidate, re.escape(token)).get(token) for candidate in transition_frames]
    observed = [row for row in observed if row is not None]
    expanded = any("TAIL_PAYLOAD_03" in "\n".join(candidate) for candidate in transition_frames)
    if not observed or not expanded:
        raise SystemExit(
            "TRANSCRIPT_TAIL_CLICK_FLICKER_FAIL: expansion transition was not captured; "
            f"observed={observed}, expanded={expanded}"
        )
    if any(row != expected for row in observed):
        raise SystemExit(
            f"TRANSCRIPT_TAIL_CLICK_FLICKER_FAIL: expected header row {expected} "
            f"in every frame, observed {observed}"
        )
    print(f"TRANSCRIPT_TAIL_CLICK_FLICKER_PASS: header stayed on row {expected} across {len(observed)} frames")
    raise SystemExit(0)


top_before = frame("top-before-expand.ansi", "collapse-scroll-position.txt")
top_expanded = frame("top-after-expand.ansi", "click for more detail")
top_collapsed = frame("top-after-collapse.ansi", "click to expand")

# The tool header is before the clicked result-summary row. It is a stable,
# unambiguous proxy for every transcript row before that top anchor.
assert_frozen(
    "top-anchor expansion",
    top_before,
    top_expanded,
    r"collapse-scroll-position\.txt|UNRELATED_BEFORE_[0-9]+",
)
assert_frozen(
    "top-anchor collapse",
    top_expanded,
    top_collapsed,
    r"collapse-scroll-position\.txt|UNRELATED_BEFORE_[0-9]+",
)

bottom_before = frame("bottom-before-collapse.ansi", "click to collapse")
bottom_after = frame("bottom-after-collapse.ansi", "click to expand")
# Later transcript rows are after the clicked bottom anchor. Every marker that
# remains visible in both frames must stay at the same physical screen row.
assert_frozen(
    "bottom-anchor collapse",
    bottom_before,
    bottom_after,
    r"UNRELATED_AFTER_(?:[0-9]+|FINAL)",
    minimum=2,
)

if failures:
    print("CLICK_VIEWPORT_ANCHORS_FAIL")
    for index, failure in enumerate(failures, 1):
        print(f"{index}. {failure}")
    raise SystemExit(1)
print("CLICK_VIEWPORT_ANCHORS_PASS")
