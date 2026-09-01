#!/usr/bin/env python3
"""Fail-closed assertions for collapse-row-review.expect captures."""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

scratch = Path(sys.argv[1])
failures: list[str] = []

SGR = re.compile(r"\x1b\[[0-9;]*m")
OSC = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)")
CSI = re.compile(r"\x1b\[[?0-9;:>]*[ -/]*[@-~]")


def read(name: str) -> str:
    return (scratch / name).read_text(errors="replace")


def plain(raw: str) -> str:
    text = OSC.sub("", raw)
    text = SGR.sub("", text)
    text = CSI.sub("", text)
    return text.replace("\r", "")


def terminal_rows(raw: str, width: int = 100, height: int = 40) -> list[str]:
    """Reconstruct rows from TUI cursor movement instead of joining redraws."""
    screen = [[" "] * width for _ in range(height)]
    row = column = 0
    saved = (0, 0)
    observed: list[str] = []

    def capture() -> None:
        observed.extend("".join(line).rstrip() for line in screen if any(char != " " for char in line))

    def param(numbers: list[int], index: int, default: int = 1) -> int:
        return numbers[index] if index < len(numbers) and numbers[index] != 0 else default

    index = 0
    while index < len(raw):
        if raw.startswith("\x1b]", index):
            bell = raw.find("\x07", index + 2)
            terminator = raw.find("\x1b\\", index + 2)
            ends = [end for end in (bell, terminator) if end >= 0]
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
            numeric = body.lstrip("?>!").split(";") if body.lstrip("?>!") else []
            numbers = [int(value) if value.isdigit() else 0 for value in numeric]
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
                row = max(0, row - param(numbers, 0))
                column = 0
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
                    capture()
                    screen = [[" "] * width for _ in range(height)]
                elif mode == 0:
                    screen[row][column:] = [" "] * (width - column)
                    for target in range(row + 1, height):
                        screen[target] = [" "] * width
            elif final == "K":
                mode = numbers[0] if numbers else 0
                if mode == 0:
                    screen[row][column:] = [" "] * (width - column)
                elif mode == 1:
                    screen[row][: column + 1] = [" "] * (column + 1)
                elif mode == 2:
                    screen[row] = [" "] * width
            elif final == "s":
                saved = (row, column)
            elif final == "u":
                row, column = saved
            elif final == "S":
                amount = min(height, param(numbers, 0))
                screen = screen[amount:] + [[" "] * width for _ in range(amount)]
            elif final == "T":
                amount = min(height, param(numbers, 0))
                screen = [[" "] * width for _ in range(amount)] + screen[: height - amount]
            elif private and final == "l" and "2026" in body:
                capture()
            index = match.end()
            continue
        char = raw[index]
        if char == "\r":
            column = 0
        elif char == "\n":
            row = min(height - 1, row + 1)
        elif char == "\b":
            column = max(0, column - 1)
        elif char == "\t":
            column = min(width - 1, ((column // 8) + 1) * 8)
        elif char >= " ":
            char_width = 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
            if column < width:
                screen[row][column] = char
                if char_width == 2 and column + 1 < width:
                    screen[row][column + 1] = " "
            column = min(width - 1, column + char_width)
        index += 1
    capture()
    return observed


def fail(message: str, evidence: str = "") -> None:
    failures.append(message)
    if evidence:
        print(f"\n--- {message} ---")
        print(evidence[-2400:].replace("\x1b", "<ESC>"))


def rows_with(text: str, *needles: str) -> list[str]:
    return [line for line in terminal_rows(text) if all(needle in line for needle in needles)]


# Group guidance: only `click` is dim; separator/description remain muted.
group = read("group.ansi")
dim_click_then_muted_description = re.compile(
    r"\x1b\[38;2;102;102;102m(?:\x1b\[[0-9;]*m)*click"
    r"(?:\x1b\[[0-9;]*m)*\x1b\[38;2;128;128;128m(?:\x1b\[[0-9;]*m)* any for details"
)
group_style_match = dim_click_then_muted_description.search(group)
group_window_index = group_style_match.start() if group_style_match else group.rfind("any for details")
group_window = group[max(0, group_window_index - 500) : group_window_index + 300]
if not group_style_match:
    fail("group guidance did not style only `click` as dim", group_window)
if "\x1b[38;2;128;128;128m • click any for details" in group:
    fail("group guidance still styles the complete suffix as muted", group_window)

# A non-final hidden-content row has one action only: more detail.
read_normal = read("read-normal.ansi")
normal_rows = rows_with(read_normal, "more lines")
expected_normal = "... (4 more lines • click for more detail)"
if not any(expected_normal in row for row in normal_rows):
    fail("Read hidden-content row did not keep the exact detail-only shape", "\n".join(normal_rows))
if any("click to collapse" in row for row in normal_rows):
    fail("Read hidden-content row still includes click-to-collapse", "\n".join(normal_rows))

# Full-row action geometry. Structural connector and padding remain inert.
geometry: dict[str, str] = {}
for line in (scratch / "geometry.txt").read_text(errors="replace").splitlines():
    key, value = line.split("=", 1)
    geometry[key] = value
for key in ("READ_LEFT_TEXT_ACTIVATED", "READ_RIGHT_TEXT_ACTIVATED"):
    if geometry.get(key) != "1":
        fail(f"full hidden-content text did not activate detail: {key}={geometry.get(key)!r}")
for key in ("READ_BRANCH_ACTIVATED", "READ_PADDING_ACTIVATED"):
    if geometry.get(key) != "0":
        fail(f"structural area activated detail: {key}={geometry.get(key)!r}")

# The final Read layer must form one result branch ending at its collapse action.
read_final = read("read-final.ansi")
read_final_plain = plain(read_final)
read_summary = rows_with(read_final, "7 lines loaded")
read_payload = rows_with(read_final, "REVIEW_READ_01")
read_collapse = rows_with(read_final, "click to collapse")
if not any(re.match(r"^\s*├\s+7 lines loaded", row) for row in read_summary):
    fail("Read final summary does not open a continuing branch", "\n".join(read_summary))
if not any(re.match(r"^\s*│\s+REVIEW_READ_01", row) for row in read_payload):
    fail("Read final payload does not continue the result branch", "\n".join(read_payload))
if not any(re.match(r"^\s*└\s+.*click to collapse", row) for row in read_collapse):
    fail("Read final layer has no terminal branched collapse row", "\n".join(read_collapse))
if geometry.get("READ_FINAL_COLLAPSE_ACTIVATED") != "1":
    fail(f"Read final collapse row was not clickable across its text: {geometry.get('READ_FINAL_COLLAPSE_ACTIVATED')!r}")

# Bash must use the same branch and final collapse action.
bash_final = read("bash-final.ansi")
bash_summary = rows_with(bash_final, "Done", "7 lines")
bash_payload = rows_with(bash_final, "REVIEW_BASH_01")
bash_collapse = rows_with(bash_final, "click to collapse")
if not any(re.match(r"^\s*├\s+.*Done.*7 lines", row) for row in bash_summary):
    fail("Bash final summary does not open a continuing branch", "\n".join(bash_summary))
if not any(re.match(r"^\s*│\s+REVIEW_BASH_01", row) for row in bash_payload):
    fail("Bash final payload does not continue the result branch", "\n".join(bash_payload))
if not any(re.match(r"^\s*└\s+.*click to collapse", row) for row in bash_collapse):
    fail("Bash final layer has no terminal branched collapse row", "\n".join(bash_collapse))
if geometry.get("BASH_FINAL_COLLAPSE_ACTIVATED") != "1":
    fail(f"Bash final collapse row was not clickable across its text: {geometry.get('BASH_FINAL_COLLAPSE_ACTIVATED')!r}")

if failures:
    print("\nCOLLAPSE_ROW_REVIEW_FAIL")
    for index, message in enumerate(failures, 1):
        print(f"{index}. {message}")
    raise SystemExit(1)

print("COLLAPSE_ROW_REVIEW_PASS")
