#!/usr/bin/env python3
from pathlib import Path
import re
import sys

if len(sys.argv) != 6:
    raise SystemExit(
        "usage: side-quests-click-adapter-assert.py "
        "BASELINE PRODUCER_FIRST CONSUMER_FIRST PRODUCER_REGRESSIONS CONSUMER_REGRESSIONS"
    )

captures = {
    "baseline": Path(sys.argv[1]).read_text(errors="replace"),
    "Side Quests → cc-tools": Path(sys.argv[2]).read_text(errors="replace"),
    "cc-tools → Side Quests": Path(sys.argv[3]).read_text(errors="replace"),
}
regression_captures = {
    "Side Quests → cc-tools": Path(sys.argv[4]).read_text(errors="replace"),
    "cc-tools → Side Quests": Path(sys.argv[5]).read_text(errors="replace"),
}


def plain(value: str) -> str:
    rows = re.sub(r"\x1b\[[0-9]+;1H\x1b\[2K", "\n", value)
    rows = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", rows)
    return re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", rows)


def section(value: str, label: str) -> str:
    rendered = plain(value)
    start_marker = f"{label}_BEGIN"
    end_marker = f"{label}_END"
    starts = [match.start() for match in re.finditer(re.escape(start_marker), rendered)]
    for start in reversed(starts):
        end = rendered.find(end_marker, start)
        if end >= 0:
            return rendered[start + len(start_marker):end]
    if not starts:
        raise SystemExit(f"missing regression section start: {start_marker}")
    raise SystemExit(f"missing complete regression section: {label}")


def has_border(value: str) -> bool:
    return re.search(r"(?m)^\s*─{20,}\s*$", value) is not None


baseline = plain(captures["baseline"])
if "ctrl+y" not in baseline or "for details" not in baseline:
    raise SystemExit("baseline capture omitted the configured dynamic keyboard hint")
if "SIDE_QUEST_PROMPT_7" not in baseline:
    raise SystemExit("baseline capture omitted configured keyboard expansion")
if "click to expand" in baseline:
    raise SystemExit("baseline capture unexpectedly exposed a cc-tools click hint")

regression_failures: list[str] = []

for label in ("Side Quests → cc-tools", "cc-tools → Side Quests"):
    rendered = plain(captures[label])
    if "SYNTHETIC_AGENT_CALL_RENDERER" in rendered or "SYNTHETIC_AGENT_RESULT_RENDERER" in rendered:
        raise SystemExit(f"{label} bypassed the real Side Quests renderer")
    if "click to expand" not in rendered:
        raise SystemExit(f"{label} omitted the click expansion hint")
    if rendered.count("─" * 20) < 2:
        raise SystemExit(f"{label} omitted standalone top/bottom borders")
    if "[inherited | interactive]" not in rendered:
        raise SystemExit(f"{label} omitted the structured status payload")
    if "session path:" not in rendered or "SIDE_QUEST_PROMPT_7" not in rendered:
        raise SystemExit(f"{label} omitted expanded real-renderer content")
    if "Output ends here" not in rendered or "click to collapse" not in rendered:
        raise SystemExit(f"{label} omitted the final collapse action")

    regression = section(regression_captures[label], "FINAL_BANNER_SNAPSHOT")
    for padding_marker in (
        "EVENT_PADDING_CONFIRMED",
        "CONTINUATION_PADDING_CONFIRMED",
        "ASK_PARENT_PADDING_CONFIRMED",
        "WRAP_UP_PADDING_CONFIRMED",
    ):
        if padding_marker not in regression:
            regression_failures.append(f"{label} immutable snapshot omitted {padding_marker}")
    if "PADDING_MISSING" in regression:
        regression_failures.append(f"{label} immutable snapshot reported missing padding")
    for section_name, required_text in (
        ("EVENT_BANNER", "SUBAGENT COMPLETED"),
        ("CONTINUATION_BANNER", "FROM PARENT"),
        ("ASK_PARENT_BANNER", "ASK PARENT"),
        ("WRAP_UP_BANNER", "WRAP UP"),
    ):
        banner = section(regression, section_name)
        if required_text not in banner:
            regression_failures.append(f"{label} {section_name} omitted real-renderer text")
        if has_border(banner):
            regression_failures.append(f"{label} {section_name} retained an unwanted standalone border")

    for section_name in ("SHORT_STANDALONE", "SHORT_GROUPED"):
        short_output = section(regression, section_name)
        if "SHORT_AGENT_PROMPT_2" not in short_output:
            regression_failures.append(f"{label} {section_name} omitted complete short Agent detail")
        if "Output ends here" in short_output or "click to collapse" in short_output:
            regression_failures.append(f"{label} {section_name} exposed a no-op bottom collapse anchor")
        if section_name == "SHORT_GROUPED":
            if "SHORT_GROUP_CONFIRMED" not in short_output or short_output.count("Spawned") < 2:
                regression_failures.append(f"{label} SHORT_GROUPED did not exercise a real two-Agent group")
            if has_border(short_output):
                regression_failures.append(f"{label} SHORT_GROUPED retained standalone Agent borders")

if regression_failures:
    raise SystemExit("\n".join(regression_failures))

print("PASS Side Quests real-renderer adapter ANSI assertions")
