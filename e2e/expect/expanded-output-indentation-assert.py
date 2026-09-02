#!/usr/bin/env python3
"""Fail-closed screen assertions for expanded-output-indentation.expect."""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

scratch = Path(sys.argv[1])
failures: list[str] = []
CSI = re.compile(r"\x1b\[[?0-9;:>]*[ -/]*[@-~]")


def read(name: str) -> str:
    return (scratch / name).read_text(errors="replace")


def snapshots(raw: str, width: int = 64, height: int = 40) -> list[list[str]]:
    screen = [[" "] * width for _ in range(height)]
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
            raw_numbers = body.lstrip("?>!").split(";") if body.lstrip("?>!") else []
            numbers = [int(value) if value.isdigit() else 0 for value in raw_numbers]
            if final in "Hf":
                if param(numbers, 0) == 1 and param(numbers, 1) == 1:
                    capture()
                row = max(0, min(height - 1, param(numbers, 0) - 1))
                column = max(0, min(width - 1, param(numbers, 1) - 1))
            elif final == "A":
                row = max(0, row - param(numbers, 0))
            elif final in "BE":
                row = min(height - 1, row + param(numbers, 0))
                if final == "E":
                    column = 0
            elif final == "F":
                row = max(0, row - param(numbers, 0)); column = 0
            elif final == "C":
                column = min(width - 1, column + param(numbers, 0))
            elif final == "D":
                column = max(0, column - param(numbers, 0))
            elif final == "G":
                column = max(0, min(width - 1, param(numbers, 0) - 1))
            elif final == "d":
                row = max(0, min(height - 1, param(numbers, 0) - 1))
            elif final == "J":
                mode = numbers[0] if numbers else 0
                if mode in (2, 3):
                    capture(); screen = [[" "] * width for _ in range(height)]
                elif mode == 0:
                    screen[row][column:] = [" "] * (width - column)
                    for target in range(row + 1, height):
                        screen[target] = [" "] * width
            elif final == "K":
                mode = numbers[0] if numbers else 0
                if mode == 0: screen[row][column:] = [" "] * (width - column)
                elif mode == 1: screen[row][:column + 1] = [" "] * (column + 1)
                elif mode == 2: screen[row] = [" "] * width
            elif final == "s": saved = (row, column)
            elif final == "u": row, column = saved
            elif final == "S":
                amount = min(height, param(numbers, 0)); screen = screen[amount:] + [[" "] * width for _ in range(amount)]
            elif final == "T":
                amount = min(height, param(numbers, 0)); screen = [[" "] * width for _ in range(amount)] + screen[:height - amount]
            elif private and final == "l" and "2026" in body:
                capture()
            index = match.end()
            continue
        char = raw[index]
        if char == "\r": column = 0
        elif char == "\n": row = min(height - 1, row + 1)
        elif char == "\b": column = max(0, column - 1)
        elif char == "\t": column = min(width - 1, ((column // 8) + 1) * 8)
        elif char >= " ":
            char_width = 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
            if column < width:
                screen[row][column] = char
                if char_width == 2 and column + 1 < width: screen[row][column + 1] = " "
            column = min(width - 1, column + char_width)
        index += 1
    capture()
    return frames


def frame_with(name: str, *tokens: str) -> list[str]:
    frames = snapshots(read(name))
    matches = [frame for frame in frames if all(any(token in row for row in frame) for token in tokens)]
    if not matches:
        failures.append(f"{name}: no complete frame contains {tokens!r}")
        return []
    return matches[-1]


def require_row(frame: list[str], pattern: str, label: str) -> int:
    for index, row in enumerate(frame):
        if re.search(pattern, row):
            return index
    failures.append(f"{label}: missing row /{pattern}/\n" + "\n".join(frame))
    return -1


level0 = frame_with("level0.ansi", "INDENT_ROOT_L0", "INDENT_GRANDCHILD_L0")
# Non-final previews use a closed outer branch (`  `). Payload indentation
# starts after those two structural columns and must remain byte-for-byte visual.
require_row(level0, r"^ {4}INDENT_CHILD_L0$", "level 0 nested two-space indent")
require_row(level0, r"^ {6}INDENT_GRANDCHILD_L0$", "level 0 nested four-space indent")

level1 = frame_with("level1.ansi", "INDENT_TAB_L1", "INDENT_ANSI_L1", "INDENT_WRAP_L1")
grand = require_row(level1, r"^ {6}INDENT_GRANDCHILD_L0$", "level 1 retained grandchild indent")
tab = require_row(level1, r"^ {5}INDENT_TAB_L1$", "level 1 tab visual indent")
if grand >= 0 and tab != grand + 2:
    failures.append(f"level 1 indented blank line was not retained between rows {grand} and {tab}")
elif grand >= 0 and level1[grand + 1] != "":
    failures.append(f"level 1 indented blank row changed payload geometry: {level1[grand + 1]!r}")
require_row(level1, r"^ {4}INDENT_ANSI_L1$", "level 1 ANSI line indent")
wrapped_token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
wrapped = require_row(level1, r"^ {6}INDENT_WRAP_L1", "level 1 wrapped line first row indent")
if wrapped >= 0:
    continuations = level1[wrapped + 1:wrapped + 3]
    for row in continuations:
        if not re.match(r"^ {6}\S", row):
            failures.append(f"wrapped continuation lost four-space payload indent: {row!r}")
    if "".join(row[6:] for row in continuations) != wrapped_token:
        failures.append(f"level 1 wrapped payload bytes changed: {continuations!r}")
if "\x1b[31m  INDENT_ANSI_L1" not in read("level1.ansi"):
    failures.append("ANSI payload SGR and its two-space indent were not preserved")

level2 = frame_with("level2.ansi", "INDENT_BRANCH_L2", "INDENT_FINAL_L2")
require_row(level2, r"^│ {3}INDENT_CHILD_L0$", "level 2 retained two-space indent")
level2_grand = require_row(level2, r"^│ {5}INDENT_GRANDCHILD_L0$", "level 2 retained four-space indent")
level2_tab = require_row(level2, r"^│ {4}INDENT_TAB_L1$", "level 2 retained tab visual indent")
if level2_grand >= 0 and level2_tab != level2_grand + 2:
    failures.append("level 2 indented blank line was not retained")
elif level2_grand >= 0 and level2[level2_grand + 1] != "│":
    failures.append(f"level 2 indented blank row changed payload geometry: {level2[level2_grand + 1]!r}")
require_row(level2, r"^│ {3}INDENT_ANSI_L1$", "level 2 retained ANSI line indent")
level2_wrap = require_row(level2, r"^│ {5}INDENT_WRAP_L1", "level 2 wrapped line first row indent")
if level2_wrap >= 0:
    continuations = level2[level2_wrap + 1:level2_wrap + 3]
    for row in continuations:
        if not re.match(r"^│ {5}\S", row):
            failures.append(f"level 2 wrapped continuation lost payload indent: {row!r}")
    if "".join(row[6:] for row in continuations) != wrapped_token:
        failures.append(f"level 2 wrapped payload bytes changed: {continuations!r}")
require_row(level2, r"^│ ├ INDENT_BRANCH_L2$", "level 2 payload branch prefix")
require_row(level2, r"^│ {5}INDENT_DEEP_L2$", "level 2 nested indent")
if "\x1b[31m  INDENT_ANSI_L1" not in read("level2.ansi"):
    failures.append("level 2 ANSI payload SGR and indent were not retained")

if failures:
    print("EXPANDED_OUTPUT_INDENTATION_FAIL")
    for index, failure in enumerate(failures, 1):
        print(f"{index}. {failure}")
    raise SystemExit(1)
print("EXPANDED_OUTPUT_INDENTATION_PASS")
