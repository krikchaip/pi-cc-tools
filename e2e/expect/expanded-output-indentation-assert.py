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


if len(sys.argv) > 2 and sys.argv[2] == "read-skill-shapes":
    cases = {
        "standalone-read": "target.txt",
        "standalone-skill": "[skill] shape",
        "grouped-read": "target.txt",
        "grouped-skill": "[skill] shape",
    }

    def case_frame(case: str, layer: str, *tokens: str) -> list[str]:
        path = scratch / case / f"{layer}.ansi"
        matches = [
            frame for frame in snapshots(path.read_text(errors="replace"), width=100)
            if all(any(token in row for row in frame) for token in tokens)
        ]
        if not matches:
            failures.append(f"{case}/{layer}: no complete frame contains {tokens!r}")
            return []
        return matches[-1]

    def is_output_blank(row: str) -> bool:
        return not row.replace("│", "").strip()

    for case, header in cases.items():
        case_frames = [
            case_frame(case, "level0", header, "15 lines loaded", "READ_SHAPE_FILLER_2"),
            case_frame(case, "level1", header, "15 lines loaded", "READ_SHAPE_FILLER_4"),
            case_frame(case, "level2", header, "15 lines loaded", "READ_SHAPE_END"),
        ]
        for layer, frame in zip(("L0", "L1", "L2"), case_frames):
            summary = next((index for index, row in enumerate(frame) if "15 lines loaded" in row), -1)
            root = next((index for index, row in enumerate(frame) if "READ_SHAPE_ROOT" in row), -1)
            child = next((index for index, row in enumerate(frame) if "READ_SHAPE_CHILD" in row), -1)
            mixed = next((index for index, row in enumerate(frame) if "READ_SHAPE_MIXED" in row), -1)
            if summary < 0 or root != summary + 2 or child != root + 1 or mixed != child + 3:
                failures.append(
                    f"{case} changed leading/internal output-owned empty lines at {layer}: "
                    f"summary={summary}, root={root}, child={child}, mixed={mixed}"
                )
            elif any(not is_output_blank(frame[index]) for index in (summary + 1, child + 1, child + 2)):
                failures.append(f"{case} rendered non-empty content in output-owned empty rows at {layer}")
        for token in ("READ_SHAPE_ROOT", "READ_SHAPE_CHILD", "READ_SHAPE_MIXED"):
            columns = [next((row.find(token) for row in frame if token in row), -1) for frame in case_frames]
            if any(column < 0 for column in columns) or not all(column == columns[0] for column in columns):
                failures.append(f"{case} changed output indentation across L0/L1/L2: {token!r}, columns={columns!r}")
        final = case_frames[2]
        end = next((index for index, row in enumerate(final) if "READ_SHAPE_END" in row), -1)
        collapse = next((index for index, row in enumerate(final) if "click to collapse" in row), -1)
        if end < 0 or collapse != end + 3:
            failures.append(f"{case} changed trailing output-owned empty lines: end={end}, collapse={collapse}")
        elif any(not is_output_blank(final[index]) for index in (end + 1, end + 2)):
            failures.append(f"{case} rendered non-empty content in trailing output-owned empty rows")
    if failures:
        print("READ_SKILL_OUTPUT_SHAPE_FAIL")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        raise SystemExit(1)
    print("READ_SKILL_OUTPUT_SHAPE_PASS")
    raise SystemExit(0)


if len(sys.argv) > 2 and sys.argv[2] == "standalone-bash":
    bash_frames = [
        frame_with("level0.ansi", "Done (15 lines)", "BASH_NEWLINE_ROOT", "BASH_NEWLINE_FILLER_2"),
        frame_with("level1.ansi", "Done (15 lines)", "BASH_NEWLINE_ROOT", "BASH_NEWLINE_FILLER_4"),
        frame_with("level2.ansi", "Done (15 lines)", "BASH_NEWLINE_ROOT", "BASH_NEWLINE_END"),
    ]
    bash_tokens = ["BASH_NEWLINE_ROOT", "BASH_NEWLINE_CHILD", "BASH_NEWLINE_MIXED"]
    for layer, frame in zip(("L0", "L1", "L2"), bash_frames):
        summary = next((index for index, row in enumerate(frame) if "Done (15 lines)" in row), -1)
        root = next((index for index, row in enumerate(frame) if "BASH_NEWLINE_ROOT" in row), -1)
        child = next((index for index, row in enumerate(frame) if "BASH_NEWLINE_CHILD" in row), -1)
        mixed = next((index for index, row in enumerate(frame) if "BASH_NEWLINE_MIXED" in row), -1)
        if summary < 0 or root != summary + 2 or child != root + 1 or mixed != child + 3:
            failures.append(
                f"standalone Bash changed output-owned prefix newlines at {layer}: "
                f"summary={summary}, root={root}, child={child}, mixed={mixed}"
            )
    for token in bash_tokens:
        columns = []
        for frame in bash_frames:
            row = next((line for line in frame if token in line), "")
            columns.append(row.find(token))
        if any(column < 0 for column in columns) or not all(column == columns[0] for column in columns):
            failures.append(f"standalone Bash changed output indentation across L0/L1/L2: {token!r}, columns={columns!r}")
    level2 = bash_frames[2]
    end = next((index for index, row in enumerate(level2) if "BASH_NEWLINE_END" in row), -1)
    collapse = next((index for index, row in enumerate(level2) if "click to collapse" in row), -1)
    if end < 0 or collapse != end + 3:
        failures.append(f"standalone Bash changed trailing output-owned newlines: end={end}, collapse={collapse}")
    if failures:
        print("STANDALONE_BASH_OUTPUT_SHAPE_FAIL")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        for layer, frame in zip(("L0", "L1", "L2"), bash_frames):
            print(f"--- {layer} ---")
            print("\n".join(frame))
        raise SystemExit(1)
    print("STANDALONE_BASH_OUTPUT_SHAPE_PASS")
    raise SystemExit(0)


if len(sys.argv) > 2 and sys.argv[2] == "grouped":
    grouped_frames = [
        frame_with("level0.ansi", "GROUP_INDENT_ROOT", "GROUP_INDENT_MIXED"),
        frame_with("level1.ansi", "GROUP_INDENT_ROOT", "GROUP_INDENT_L1_END"),
        frame_with("level2.ansi", "GROUP_INDENT_ROOT", "GROUP_INDENT_L2_END"),
    ]
    grouped_tokens = [
        "GROUP_INDENT_ROOT",
        "GROUP_INDENT_TWO_SPACES",
        "GROUP_INDENT_FOUR_SPACES",
        "GROUP_INDENT_SEVEN_SPACES",
        "GROUP_INDENT_TAB",
        "GROUP_INDENT_MIXED",
    ]
    for layer, frame in zip(("L0", "L1", "L2"), grouped_frames):
        peer_row = next((index for index, row in enumerate(frame) if "peer.txt" in row), len(frame))
        child_rows = frame[:peer_row]
        if any("────────" in row for row in child_rows):
            failures.append(f"grouped {layer} embedded standalone divider chrome")
        header = next((row for row in child_rows if "group-indent.txt" in row), "")
        if "Read" in header:
            failures.append(f"grouped {layer} embedded a duplicate standalone Read label: {header!r}")
    baseline_columns: dict[str, int] = {}
    for token in grouped_tokens:
        columns: list[int] = []
        for frame in grouped_frames:
            row = next((line for line in frame if token in line), "")
            columns.append(row.find(token))
        if any(column < 0 for column in columns):
            failures.append(f"grouped indentation token missing: {token!r}, columns={columns!r}")
            continue
        baseline_columns[token] = columns[0]
        if not all(column == columns[0] for column in columns):
            failures.append(f"grouped payload indentation changed across L0/L1/L2: {token!r}, columns={columns!r}")
    if len(set(baseline_columns.values())) < 4:
        failures.append(f"grouped fixture did not exercise varied payload indentation: {baseline_columns!r}")
    grouped_root = baseline_columns.get("GROUP_INDENT_ROOT", -1)
    grouped_expected_offsets = {
        "GROUP_INDENT_TWO_SPACES": 2,
        "GROUP_INDENT_FOUR_SPACES": 4,
        "GROUP_INDENT_SEVEN_SPACES": 7,
        "GROUP_INDENT_TAB": 4,
        "GROUP_INDENT_MIXED": 6,
    }
    for token, offset in grouped_expected_offsets.items():
        if grouped_root >= 0 and baseline_columns.get(token) != grouped_root + offset:
            failures.append(
                f"grouped output changed four-column tab-stop geometry: {token!r}, "
                f"expected={grouped_root + offset}, actual={baseline_columns.get(token)!r}"
            )
    if failures:
        print("GROUPED_OUTPUT_INDENTATION_FAIL")
        for index, failure in enumerate(failures, 1):
            print(f"{index}. {failure}")
        for layer, frame in zip(("L0", "L1", "L2"), grouped_frames):
            print(f"--- {layer} ---")
            print("\n".join(frame))
        raise SystemExit(1)
    print("GROUPED_OUTPUT_INDENTATION_PASS")
    raise SystemExit(0)


level0 = frame_with("level0.ansi", "STANDALONE_INDENT_ROOT", "STANDALONE_INDENT_MIXED")
level1 = frame_with("level1.ansi", "STANDALONE_INDENT_ROOT", "INDENT_ANSI_L1", "INDENT_WRAP_L1")
level2 = frame_with("level2.ansi", "STANDALONE_INDENT_ROOT", "INDENT_BRANCH_L2", "INDENT_FINAL_L2")
standalone_frames = [level0, level1, level2]
standalone_tokens = [
    "STANDALONE_INDENT_ROOT",
    "STANDALONE_INDENT_TWO_SPACES",
    "STANDALONE_INDENT_FOUR_SPACES",
    "STANDALONE_INDENT_SEVEN_SPACES",
    "STANDALONE_INDENT_TAB",
    "STANDALONE_INDENT_MIXED",
]
baseline_columns: dict[str, int] = {}
for token in standalone_tokens:
    columns: list[int] = []
    for frame in standalone_frames:
        row = next((line for line in frame if token in line), "")
        columns.append(row.find(token))
    if any(column < 0 for column in columns):
        failures.append(f"standalone indentation token missing: {token!r}, columns={columns!r}")
        continue
    baseline_columns[token] = columns[0]
    if not all(column == columns[0] for column in columns):
        failures.append(f"standalone payload indentation changed across L0/L1/L2: {token!r}, columns={columns!r}")
if len(set(baseline_columns.values())) < 4:
    failures.append(f"standalone fixture did not exercise varied payload indentation: {baseline_columns!r}")
standalone_root = baseline_columns.get("STANDALONE_INDENT_ROOT", -1)
standalone_expected_offsets = {
    "STANDALONE_INDENT_TWO_SPACES": 2,
    "STANDALONE_INDENT_FOUR_SPACES": 4,
    "STANDALONE_INDENT_SEVEN_SPACES": 7,
    "STANDALONE_INDENT_TAB": 4,
    "STANDALONE_INDENT_MIXED": 6,
}
for token, offset in standalone_expected_offsets.items():
    if standalone_root >= 0 and baseline_columns.get(token) != standalone_root + offset:
        failures.append(
            f"standalone output changed four-column tab-stop geometry: {token!r}, "
            f"expected={standalone_root + offset}, actual={baseline_columns.get(token)!r}"
        )

def token_position(frame: list[str], token: str, label: str) -> tuple[int, int]:
    for row_index, row in enumerate(frame):
        column = row.find(token)
        if column >= 0:
            return row_index, column
    failures.append(f"{label}: missing token {token!r}\n" + "\n".join(frame))
    return -1, -1


mixed, _ = token_position(level1, "STANDALONE_INDENT_MIXED", "level 1 mixed-indent row")
if mixed >= 0 and level1[mixed + 1].strip():
    failures.append(f"level 1 indented blank row changed payload geometry: {level1[mixed + 1]!r}")
level2_mixed, _ = token_position(level2, "STANDALONE_INDENT_MIXED", "level 2 mixed-indent row")
if level2_mixed >= 0 and level2[level2_mixed + 1].strip() != "│":
    failures.append(f"level 2 indented blank row changed payload geometry: {level2[level2_mixed + 1]!r}")

_, ansi_column = token_position(level1, "INDENT_ANSI_L1", "level 1 ANSI line")
_, level2_ansi_column = token_position(level2, "INDENT_ANSI_L1", "level 2 ANSI line")
if ansi_column >= 0 and level2_ansi_column != ansi_column:
    failures.append(f"ANSI payload indentation changed across L1/L2: {[ansi_column, level2_ansi_column]!r}")

wrapped_token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
wrapped, wrap_column = token_position(level1, "INDENT_WRAP_L1", "level 1 wrapped line")
if wrapped >= 0:
    continuations = level1[wrapped + 1:wrapped + 3]
    for row in continuations:
        if wrap_column >= len(row) or row[wrap_column].isspace():
            failures.append(f"wrapped continuation changed its derived payload column {wrap_column}: {row!r}")
    if "".join(row[wrap_column:] for row in continuations) != wrapped_token:
        failures.append(f"level 1 wrapped payload bytes changed: {continuations!r}")
level2_wrap, level2_wrap_column = token_position(level2, "INDENT_WRAP_L1", "level 2 wrapped line")
if wrap_column >= 0 and level2_wrap_column != wrap_column:
    failures.append(f"wrapped payload indentation changed across L1/L2: {[wrap_column, level2_wrap_column]!r}")
if level2_wrap >= 0:
    continuations = level2[level2_wrap + 1:level2_wrap + 3]
    for row in continuations:
        if level2_wrap_column >= len(row) or row[level2_wrap_column].isspace():
            failures.append(f"level 2 wrapped continuation changed its derived payload column {level2_wrap_column}: {row!r}")
    if "".join(row[level2_wrap_column:] for row in continuations) != wrapped_token:
        failures.append(f"level 2 wrapped payload bytes changed: {continuations!r}")
token_position(level2, "INDENT_BRANCH_L2", "level 2 payload branch prefix")
token_position(level2, "INDENT_DEEP_L2", "level 2 nested indent")
if "\x1b[31m  INDENT_ANSI_L1" not in read("level2.ansi"):
    failures.append("level 2 ANSI payload SGR and indent were not retained")

if failures:
    print("EXPANDED_OUTPUT_INDENTATION_FAIL")
    for index, failure in enumerate(failures, 1):
        print(f"{index}. {failure}")
    raise SystemExit(1)
print("EXPANDED_OUTPUT_INDENTATION_PASS")
