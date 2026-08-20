#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRATCH="/tmp/pi-cc-reload-markdown-e2e-$$"
SOCKET="pi-cc-reload-markdown-$$"
SESSION_NAME="reload-markdown"
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
    "packages": [package_path],
}
(agent_dir / "settings.json").write_text(json.dumps(settings))

entries = [
    {
        "type": "session",
        "version": 3,
        "id": "11111111-1111-4111-8111-111111111111",
        "timestamp": "2026-08-20T00:00:00.000Z",
        "cwd": cwd,
    },
    {
        "type": "message",
        "id": "aaaa0001",
        "parentId": None,
        "timestamp": "2026-08-20T00:00:01.000Z",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": "Render the reload fixture."}],
            "timestamp": 1787184001000,
        },
    },
    {
        "type": "message",
        "id": "aaaa0002",
        "parentId": "aaaa0001",
        "timestamp": "2026-08-20T00:00:02.000Z",
        "message": {
            "role": "assistant",
            "content": [{
                "type": "text",
                "text": "Reload fixture\n\n- Alpha\n- Beta\n\n```ts\nconst answer = 42;\n```",
            }],
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
            "timestamp": 1787184002000,
        },
    },
]
session_file.write_text("\n".join(json.dumps(entry) for entry in entries) + "\n")
PY

tmux -L "$SOCKET" kill-server 2>/dev/null || true
tmux -L "$SOCKET" -f /dev/null new-session -d -s "$SESSION_NAME" -x 100 -y 32 /bin/bash
tmux -L "$SOCKET" set-option -g extended-keys on
tmux -L "$SOCKET" send-keys -t "$SESSION_NAME" -l \
  "cd '$CWD' && env HOME='$HOME_DIR' TERM=xterm-256color COLORTERM=truecolor COLUMNS=100 LINES=32 PI_OFFLINE=1 PI_CODING_AGENT_DIR='$AGENT_DIR' pi --session '$SESSION_FILE' --tui-mode fullscreen --no-context-files --no-prompt-templates --no-themes --no-skills"
tmux -L "$SOCKET" send-keys -t "$SESSION_NAME" Enter

capture_plain() {
  tmux -L "$SOCKET" capture-pane -p -t "$SESSION_NAME" -S -
}

wait_for() {
  local pattern="$1"
  local output="$2"
  for _ in $(seq 1 150); do
    capture_plain > "$output"
    if grep -Fq -- "$pattern" "$output"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

if ! wait_for "● Reload fixture" "$SCRATCH/current.txt"; then
  cat "$SCRATCH/current.txt"
  echo "FAIL: startup assistant marker did not render" >&2
  echo "ARTIFACTS $SCRATCH" >&2
  exit 1
fi

capture_plain > "$SCRATCH/before.txt"
tmux -L "$SOCKET" capture-pane -p -e -t "$SESSION_NAME" -S - > "$SCRATCH/before.ansi"

tmux -L "$SOCKET" send-keys -t "$SESSION_NAME" -l "/reload"
tmux -L "$SOCKET" send-keys -t "$SESSION_NAME" Enter

if ! wait_for "Reloaded keybindings" "$SCRATCH/current.txt"; then
  cat "$SCRATCH/current.txt"
  echo "FAIL: /reload did not finish" >&2
  echo "ARTIFACTS $SCRATCH" >&2
  exit 1
fi

capture_plain > "$SCRATCH/after.txt"
tmux -L "$SOCKET" capture-pane -p -e -t "$SESSION_NAME" -S - > "$SCRATCH/after.ansi"

if ! SCRATCH="$SCRATCH" python3 - <<'PY'
import os
import re
from pathlib import Path

scratch = Path(os.environ["SCRATCH"])
before = (scratch / "before.txt").read_text()
after = (scratch / "after.txt").read_text()
before_ansi = (scratch / "before.ansi").read_text()
after_ansi = (scratch / "after.ansi").read_text()

required = [
    "● Reload fixture",
    "◉ Alpha",
    "◉ Beta",
    "╭· ts",
    "const answer = 42;",
]
for token in required:
    if token not in before:
        raise SystemExit(f"FAIL: startup render is missing {token!r}")
    if token not in after:
        raise SystemExit(f"FAIL: /reload render is missing {token!r}")

for unwanted in ("\n - Alpha", "\n - Beta", "\n ```ts"):
    if unwanted in after:
        raise SystemExit(f"FAIL: /reload restored stock Markdown token {unwanted!r}")

ansi_pattern = re.compile(r"\x1b\[[0-9;:]*m")
for label, capture in (("startup", before_ansi), ("reload", after_ansi)):
    for token in ("◉ Alpha", "╭· ts"):
        line = next(
            (line for line in capture.splitlines() if token in ansi_pattern.sub("", line)),
            "",
        )
        if "\x1b[" not in line:
            raise SystemExit(f"FAIL: {label} {token!r} lost ANSI styling")

print("PASS: assistant bullets and code blocks survive /reload")
PY
then
  echo "ARTIFACTS $SCRATCH" >&2
  exit 1
fi

rm -rf "$SCRATCH"
