#!/usr/bin/env python3
"""Assert the live-to-finished preserved Bash preview transition."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

WIDTH = 100
HEIGHT = 40


def load_parser():
    path = Path(__file__).with_name("async-diff-click-assert.py")
    spec = importlib.util.spec_from_file_location("preserved_bash_terminal", path)
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
        print("--- final frame ---", file=sys.stderr)
        print("\n".join(frame), file=sys.stderr)
    raise SystemExit(1)


def last_matching(parser, path: Path, token: str) -> list[str]:
    frames = parser.snapshots(path.read_text(errors="replace"))
    matches = [frame for frame in frames if any(token in row for row in frame)]
    if not matches:
        fail(f"{path.name}: no frame contains {token!r}")
    return matches[-1]


if len(sys.argv) != 2:
    fail("usage: preserved-bash-completion-assert.py SCRATCH")
scratch = Path(sys.argv[1])
partial_path = scratch / "partial.ansi"
final_path = scratch / "final.ansi"
if not partial_path.is_file() or not final_path.is_file():
    fail(f"missing partial/final captures under {scratch}")

parser = load_parser()
partial = last_matching(parser, partial_path, "BASH_PRESERVED_03")
partial_text = "\n".join(partial)
if "Done (24 lines)" in partial_text:
    fail("partial frame was captured after Bash completed", partial)
if not any("Bash" in row and "for i in" in row for row in partial):
    fail("partial frame lacks the running Bash heading", partial)

final = last_matching(parser, final_path, "Done")
final_text = "\n".join(final)
for token in ("Done", "(24 lines)", "… (21 earlier lines)", "BASH_PRESERVED_22", "BASH_PRESERVED_23", "BASH_PRESERVED_24"):
    if token not in final_text:
        fail(f"finished preserved preview is missing {token!r}", final)

hints = final_text.count("ctrl+o to expand") + final_text.count("click to expand")
if hints != 1:
    fail(f"finished Bash frame must contain exactly one expand hint, found {hints}", final)
earlier_row = next(row for row in final if "earlier lines" in row)
if "ctrl+o" in earlier_row or "click" in earlier_row:
    fail("earlier-lines context marker contains a duplicate expand hint", final)
if "E2E_BASH_PRESERVED_COMPLETE" in final_text:
    fail("final capture occurred after later assistant text released the preserved preview", final)

print("PASS long Bash transitions from live output to one-hint preserved completion preview")
