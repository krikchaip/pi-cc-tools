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

**Tool group summary row**:
The compact row that describes a tool group and can show a click instruction. It is not a click anchor. Users expand one child through that child's execution summary row while Pi's global expansion mode is collapsed.
_Avoid_: Group anchor

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

**Standalone tool frame**:
The top and bottom horizontal borders around a standalone tool execution. A standalone execution retains both borders in every expansion layer.
_Avoid_: Group border

**Result summary row**:
A renderer-declared row beneath an execution summary that summarizes status, counts, or a diff without exposing raw payload. A standalone collapsed execution can show it. A collapsed grouped child does not show it; the row first appears after that child expands. When visible during click expansion, it is a stable anchor for the same execution.
_Avoid_: Second line, payload row

**MCP response summary row**:
The one result summary row for a completed MCP tool execution. An object or array response reports its root shape and field or item count. A scalar or image response reports its type. A successful unstructured text response reports only its returned logical line count. An error response shows its complete first error line, including every wrapped physical row. An empty response reports **Done** or **Failed**.
_Avoid_: MCP payload preview

**MCP summary mode**:
An MCP output mode whose rendered result consists only of the MCP response summary row. It uses response-shape summaries but has no detail layers or local click anchors. A collapsed tool group still suppresses the rendered result and shows only each execution summary.
_Avoid_: Collapsed preview

**MCP preview mode**:
An MCP output mode that presents the collapsed summary layer followed by Level 0, Level 1, and Level 2 when returned content requires those layers.
_Avoid_: Summary mode

**Running preview**:
A bounded presentation of payload received while a tool execution is incomplete. It is replaced by the completed presentation and is not the collapsed summary layer.
_Avoid_: Collapsed result

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
The final nonblank row of a locally expanded tool execution at an effective final detail layer. It appears after all summaries, payload, truncation rows, and separator rows.
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
The optional fullscreen interaction in which one click changes the local expansion or detail state of one cc-tools tool execution. Click anchors are available only while Pi's global expansion mode is collapsed. Click expansion is disabled unless configured.
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

**Collapsed summary layer**:
The collapsed presentation before Level 0. A standalone execution contains its execution summary and at most one result summary row. A grouped child contains only its execution summary. Neither form exposes result payload when expansion can reveal more information.
_Avoid_: Level 0, collapsed preview

**Level 0 (L0)**:
The normal-detail presentation after the first local expansion. It can expose a bounded result payload.
_Avoid_: Collapsed state

**Level 1 (L1)**:
The first more-detail presentation after Level 0.

**Level 2 (L2)**:
The second and highest configured more-detail presentation after Level 1.

**Returned content**:
The content already present in one tool result. Source content that requires another tool execution, such as a later Read offset, is outside the current returned content.

**Effective final detail layer**:
The first more-detail state at which no more returned content can be revealed. It can occur before the highest configured detail level. A content-exhausted normal preview is not an effective final detail layer.
_Avoid_: Level 2, maximum level

**Expansion target**:
The one tool execution whose expanded state changes when its click anchor is activated.
_Avoid_: Group

**Grouped child expansion**:
The local expansion of one tool execution while its tool group remains globally collapsed. The collapsed group shows only execution summary rows. Clicking one execution summary reveals that child's result summary and Level 0 payload without expanding its peers. The revealed result summary remains an anchor for the same child.
_Avoid_: Expanded group
