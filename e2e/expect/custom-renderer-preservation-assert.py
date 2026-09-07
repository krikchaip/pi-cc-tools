#!/usr/bin/env python3
"""Fail-closed assertions for the real-Pi custom-renderer fullscreen frame."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

WIDTH = 72
HEIGHT = 32


def load_terminal_parser():
    parser_path = Path(__file__).with_name("async-diff-click-assert.py")
    spec = importlib.util.spec_from_file_location("custom_renderer_terminal", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load terminal parser: {parser_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.WIDTH = WIDTH
    module.HEIGHT = HEIGHT
    return module


def fail(message: str, frame: list[str] | None = None) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    if frame is not None:
        print("--- final frame ---", file=sys.stderr)
        print("\n".join(frame), file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: custom-renderer-preservation-assert.py FRAME.ansi")

    path = Path(sys.argv[1])
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"missing or empty capture: {path}")

    raw = path.read_text(encoding="utf-8", errors="replace")
    if "\uE000" in raw:
        fail("legacy U+E000 wrap marker leaked into terminal output")
    if "\u200B" in raw:
        fail("U+200B wrap marker leaked into terminal output")

    frames = load_terminal_parser().frames(path)
    if not frames:
        fail("capture contains no terminal frames")
    matching = [
        frame
        for frame in frames
        if any("CUSTOM RENDERER PRESERVATION E2E" in row for row in frame)
    ]
    if not matching:
        fail("no complete fullscreen fixture frame was captured")
    frame = matching[-1]
    text = "\n".join(frame)

    required = [
        "CUSTOM_CALL_RENDERER_OK",
        "CALL_WRAP_END",
        "CUSTOM_RESULT_RENDERER_OK",
        "RESULT_WRAP_END",
    ]
    for token in required:
        if token not in text:
            fail(f"custom renderer token is absent: {token}", frame)

    forbidden = [
        "GENERIC_CALL_FALLBACK_SHOULD_NOT_RENDER",
        "GENERIC_RESULT_FALLBACK_SHOULD_NOT_RENDER",
        "legacy-call",
        "zero-width-result",
    ]
    for token in forbidden:
        if token in text:
            fail(f"generic fallback text is visible: {token}", frame)

    call_rows = [index for index, row in enumerate(frame) if "CUSTOM_CALL_RENDERER_OK" in row or "CALL_WRAP_END" in row]
    result_rows = [index for index, row in enumerate(frame) if "CUSTOM_RESULT_RENDERER_OK" in row or "RESULT_WRAP_END" in row]
    if len(set(call_rows)) < 2:
        fail("custom renderCall output did not wrap onto a later physical row", frame)
    if len(set(result_rows)) < 2:
        fail("custom renderResult output did not wrap onto a later physical row", frame)

    print("PASS custom renderCall/renderResult preserved; wrapped output is marker-free")


if __name__ == "__main__":
    main()
