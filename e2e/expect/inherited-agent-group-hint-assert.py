#!/usr/bin/env python3
"""Assert that an inherited Agent group does not advertise a no-op expansion."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
WIDTH = 100
HEIGHT = 40
CHILDREN = tuple(f"Grouped agent {index}" for index in range(1, 6))


def load_parser():
    path = Path(__file__).with_name("async-diff-click-assert.py")
    spec = importlib.util.spec_from_file_location("inherited_agent_group_terminal", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load terminal parser: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.WIDTH = WIDTH
    module.HEIGHT = HEIGHT
    return module


def fail(message: str, frame: list[str] | None = None) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    if frame:
        print("--- inherited Agent group frame ---", file=sys.stderr)
        print("\n".join(frame), file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[2] not in {"compact", "keyboard", "expanded"}:
        fail("usage: inherited-agent-group-hint-assert.py FRAME.ansi compact|keyboard|expanded")
    path = Path(sys.argv[1])
    mode = sys.argv[2]
    if not path.is_file():
        fail(f"missing fullscreen capture: {path}")

    parser = load_parser()
    snapshots = parser.snapshots(path.read_text(errors="replace"))
    if mode == "expanded":
        frames = [frame for frame in snapshots if any("CONTROL_AGENT_PROMPT_7" in row for row in frame)]
        if not frames:
            fail("resultful Agent control did not reveal its final prompt row")
        print("PASS resultful Agent control expands from its click target")
        return

    frames = [
        frame
        for frame in snapshots
        if all(any(child in row for row in frame) for child in CHILDREN)
    ]
    if not frames:
        fail("capture has no complete five-call inherited Agent group")
    frame = frames[-1]

    headers = [row for row in frame if "Agent: 5 done" in row]
    if len(headers) != 1:
        fail(f"expected one settled Agent group header, found {len(headers)}", frame)
    header = headers[0]
    if not re.match(r"^\s*●\s+Agent:\s+5 done\s*$", header):
        fail(f"settled result-less Agent group advertises a no-op expansion: {header!r}", frame)
    if "ctrl+y" in header or "click" in header:
        fail(f"settled result-less Agent group retained expansion guidance: {header!r}", frame)

    control_headers = [row for row in frame if "Agent: 2 done" in row]
    if len(control_headers) != 1:
        fail(f"expected one resultful Agent control header, found {len(control_headers)}", frame)
    control_header = control_headers[0]
    if mode == "keyboard":
        if "ctrl+y" not in control_header or "to expand" not in control_header or "click" in control_header:
            fail(f"resultful Agent control lost keyboard fallback: {control_header!r}", frame)
    elif "click any for details" not in control_header or "ctrl+y" in control_header:
        fail(f"resultful Agent control lost click guidance: {control_header!r}", frame)
    if any("CONTROL_AGENT_PROMPT_7" in row for row in frame):
        fail("resultful Agent control starts expanded", frame)

    print("PASS inherited result-less Agent group omits no-op keyboard and click guidance")
    if mode == "keyboard":
        print("PASS resultful Agent control retains keyboard fallback")
        return

    control_rows = [index for index, row in enumerate(frame, 1) if "Control agent 1" in row]
    if len(control_rows) != 1:
        fail(f"expected one first control Agent row, found {len(control_rows)}", frame)
    print(f"CONTROL_ROW {control_rows[0]}")


if __name__ == "__main__":
    main()
