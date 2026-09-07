#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PI_BIN=${PI_BIN:-$(command -v pi)}
SCRATCH="/tmp/pi-cc-markdown-layout-e2e-$$"
SOCKET="pi-cc-markdown-layout-$$"
SESSION_NAME="markdown-layout"
AGENT_DIR="$SCRATCH/agent"
HOME_DIR="$SCRATCH/home"
CWD="$SCRATCH/cwd"
SESSION_FILE="$SCRATCH/session.jsonl"

mkdir -p "$AGENT_DIR" "$HOME_DIR" "$CWD"

cleanup() {
  tmux -L "$SOCKET" kill-server 2>/dev/null || true
}
trap cleanup EXIT

PACKAGE_PATH="$REPO_DIR" \
AGENT_DIR="$AGENT_DIR" \
SESSION_FILE="$SESSION_FILE" \
CWD="$CWD" \
python3 - <<'PY'
import json
import os
from pathlib import Path

agent_dir = Path(os.environ["AGENT_DIR"])
session_file = Path(os.environ["SESSION_FILE"])
cwd = os.environ["CWD"]
package_path = os.environ["PACKAGE_PATH"]

settings = {
    "quietStartup": True,
    "defaultProjectTrust": "always",
    "theme": "dark",
    "outputPad": 0,
    "markdown": {"mermaid": "final"},
    "packages": [package_path],
}
(agent_dir / "settings.json").write_text(json.dumps(settings))

markdown = r"""Markdown delegation fixture

```mermaid
graph LR
    Start --> Finish
```

```latex
\frac{a+b}{c+d}
```

\[
\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
\]
"""
entries = [
    {
        "type": "session",
        "version": 3,
        "id": "22222222-2222-4222-8222-222222222222",
        "timestamp": "2026-09-03T00:00:00.000Z",
        "cwd": cwd,
    },
    {
        "type": "message",
        "id": "bbbb0001",
        "parentId": None,
        "timestamp": "2026-09-03T00:00:01.000Z",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": "Render the Markdown delegation fixture."}],
            "timestamp": 1788393601000,
        },
    },
    {
        "type": "message",
        "id": "bbbb0002",
        "parentId": "bbbb0001",
        "timestamp": "2026-09-03T00:00:02.000Z",
        "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": markdown}],
            "api": "openai-responses",
            "provider": "openai-codex",
            "model": "gpt-5.6-sol",
            "usage": {
                "input": 0,
                "output": 0,
                "cacheRead": 0,
                "cacheWrite": 0,
                "totalTokens": 0,
                "cost": {
                    "input": 0,
                    "output": 0,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "total": 0,
                },
            },
            "stopReason": "stop",
            "timestamp": 1788393602000,
        },
    },
]
session_file.write_text("\n".join(json.dumps(entry) for entry in entries) + "\n")
PY

tmux -L "$SOCKET" kill-server 2>/dev/null || true
tmux -L "$SOCKET" -f /dev/null new-session -d -s "$SESSION_NAME" -x 100 -y 36 /bin/bash
tmux -L "$SOCKET" set-option -g extended-keys on
tmux -L "$SOCKET" send-keys -t "$SESSION_NAME" -l \
  "cd '$CWD' && env HOME='$HOME_DIR' TERM=xterm-256color COLORTERM=truecolor COLUMNS=100 LINES=36 PI_OFFLINE=1 PI_CODING_AGENT_DIR='$AGENT_DIR' '$PI_BIN' --session '$SESSION_FILE' --tui-mode fullscreen --no-context-files --no-prompt-templates --no-themes --no-skills"
tmux -L "$SOCKET" send-keys -t "$SESSION_NAME" Enter

capture_plain() {
  tmux -L "$SOCKET" capture-pane -p -t "$SESSION_NAME" -S -
}

for _ in $(seq 1 150); do
  capture_plain > "$SCRATCH/screen.txt"
  if grep -Fq -- "c+d" "$SCRATCH/screen.txt" && grep -Fq -- "Finish" "$SCRATCH/screen.txt"; then
    break
  fi
  sleep 0.1
done

capture_plain > "$SCRATCH/screen.txt"

if ! SCRATCH="$SCRATCH" python3 - <<'PY'
import os
from pathlib import Path

screen = (Path(os.environ["SCRATCH"]) / "screen.txt").read_text()
lines = screen.splitlines()

required = [
    "● Markdown delegation fixture",
    "Start",
    "Finish",
    "a+b",
    "───",
    "c+d",
    "⎡ 1 │ 2 ⎤",
    "⎣ 3 │ 4 ⎦",
]
for token in required:
    if token not in screen:
        raise SystemExit(f"FAIL: delegated Markdown render is missing {token!r}")

for raw_source in ("graph LR", "Start --> Finish", "```mermaid", "```latex", r"\frac", r"\begin{bmatrix}"):
    if raw_source in screen:
        raise SystemExit(f"FAIL: raw Markdown/LaTeX source leaked into the rendered transcript: {raw_source!r}")

numerator = next(index for index, line in enumerate(lines) if "a+b" in line)
bar = next((index for index, line in enumerate(lines) if line.strip() == "───"), -1)
denominator = next(index for index, line in enumerate(lines) if "c+d" in line)
if (bar, denominator) != (numerator + 1, numerator + 2):
    raise SystemExit(
        "FAIL: Pi's stacked fraction layout was flattened: "
        f"numerator={numerator}, bar={bar}, denominator={denominator}"
    )

matrix_top = next(index for index, line in enumerate(lines) if "⎡ 1 │ 2 ⎤" in line)
matrix_bottom = next(index for index, line in enumerate(lines) if "⎣ 3 │ 4 ⎦" in line)
if matrix_bottom != matrix_top + 1:
    raise SystemExit(
        "FAIL: Pi's matrix layout was flattened: "
        f"top={matrix_top}, bottom={matrix_bottom}"
    )

print("PASS: assistant Markdown delegates Mermaid and LaTeX layout to Pi")
PY
then
  cat "$SCRATCH/screen.txt"
  echo "ARTIFACTS $SCRATCH" >&2
  exit 1
fi

rm -rf "$SCRATCH"
