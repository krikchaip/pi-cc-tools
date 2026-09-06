# cc-tools Expansion Interaction

This context defines the language for expanding one rendered tool execution inside cc-tools.

## Language

**Tool execution**:
One rendered invocation of one tool.
_Avoid_: Item, message

**Standalone tool execution**:
A tool execution rendered outside a tool group.
_Avoid_: Single tool, ungrouped item

**Tool group**:
Nearby tool executions that cc-tools displays under one summary header. Group membership does not prove simultaneous execution or a shared request.
_Avoid_: Batch

**Homogeneous tool group**:
A tool group in which all tool executions use the same tool name.
_Avoid_: Same-tool batch

**Mixed tool group**:
A tool group that contains more than one tool name.
_Avoid_: Mixed batch

**Execution summary row**:
The primary compact row that represents one tool execution, whether standalone or inside a tool group. A grouped row also contains a branch connector, status indicator, and optional argument summary.
_Avoid_: Item row, heading

**Header block**:
The execution summary row and every physical terminal row created when that logical row wraps. Its size depends on the viewport width.
_Avoid_: First line, top two lines

**Result summary row**:
A renderer-declared row beneath an execution summary that summarizes status, counts, or a diff without exposing raw payload. It can appear in a standalone tool execution or a tool group. During click expansion, it is a stable expansion anchor: it expands a collapsed execution and collapses an expanded execution.
_Avoid_: Second line, payload row

**Diff output**:
The complete rendered diff presentation owned by one tool execution. A Write diff output has one diff block. An Edit or Apply Patch diff output can have one or more diff blocks.
_Avoid_: Diff message

**Diff block**:
One contiguous diff presentation for one Write operation, Edit operation, or Apply Patch file change.
_Avoid_: Hunk, tool block

**Aggregate diff summary row**:
The one result summary row that reports totals for a diff output, including its edit or file count, added and removed lines, hunk count, and optional diff-line count. It appears before all diff blocks and never repeats per block.
_Avoid_: Hunk summary, bottom summary

**Block truncation row**:
A row directly after its diff block that reports omitted rows from that block. It is an action row while another detail layer is available and an inert status row at the hard detail limit.
_Avoid_: Global truncation row

**Collection remainder row**:
The terminal action row that reports whole diff blocks omitted from a multi-block diff output. It appears after all rendered diff blocks.
_Avoid_: More-diff row

**Terminal collapse row**:
The final nonblank row of a locally expanded diff output. It appears after all summaries, diff blocks, block truncation rows, and separator rows.
_Avoid_: Footer, bottom anchor

**Action row**:
A rendered content row that describes an available expansion or detail action, such as `5 lines loaded • click to expand`. A branch connector beside it is structural and is not part of the action row.
_Avoid_: Hint line, footer

**Argument summary**:
Visible tool arguments appended to the primary summary, such as `(offset=1, limit=2000)` for a read execution.
_Avoid_: Offset thingy

**Fullscreen mode**:
Pi's alternate-screen TUI mode, where component click interaction is available.

**Regular mode**:
Pi's scrollback-preserving TUI mode, where expansion remains keyboard-driven.
_Avoid_: Normal mode

**Global expansion mode**:
Pi's keyboard-controlled expansion state. Its values are **collapsed** and **expanded**.
_Avoid_: Collapse mode, expand mode

**Click expansion**:
The optional fullscreen interaction in which one click changes the local expansion or detail state of one cc-tools tool execution. It is disabled unless configured.
_Avoid_: Mouse mode, click mode

**Mouse input adapter**:
The version-specific code that converts one mouse input into click-anchor coordinates. Pi `0.84.4` uses a raw-terminal adapter; Pi versions that export `MouseRegion` use a native adapter. Only one adapter is active.
_Avoid_: Mouse system

**Click anchor**:
The full visible content span that accepts a mouse click. It can cover a header block, result summary row, or action row. It excludes branch connectors and trailing blank padding; only the word `click` needs distinct dim styling.
_Avoid_: Click target, link

**Local expansion state**:
The collapsed or expanded state of one tool execution, changed without changing its peers.
_Avoid_: Global expansion mode

**Local detail state**:
The normal-detail or more-detail state of one tool execution, changed without changing its peers.
_Avoid_: Extra detail setting

**Returned content**:
The content already present in one tool result. Source content that requires another tool execution, such as a later Read offset, is outside the current returned content.

**Effective final detail layer**:
The first more-detail state at which no more returned content can be revealed. It can occur before the highest configured detail level. A content-exhausted normal preview is not an effective final detail layer.
_Avoid_: Level 2, maximum level

**Expansion target**:
The one tool execution whose expanded state changes when its click anchor is activated.
_Avoid_: Group
