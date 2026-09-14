# cc-tools Verification

This context defines the language for verifying cc-tools behavior in a real interactive terminal.

## Language

**E2E scenario**:
One user-visible interaction and its expected observable result in a real Pi terminal session.
_Avoid_: Test case, Expect script

**Scenario family**:
E2E scenarios that exercise the same user-facing surface and share substantial setup.
_Avoid_: Test folder, script group

**Terminal session**:
One isolated run of Pi in a real interactive terminal for an E2E scenario.
_Avoid_: Process, pane

**Terminal action**:
One user input or native terminal event sent to a terminal session.
_Avoid_: Step, command

**Frame expectation**:
One observable condition that frame evidence must satisfy before its deadline.
_Avoid_: Poll, assertion helper

**Frame evidence**:
A named capture of the visible terminal state and its source terminal output before or after a terminal action.
_Avoid_: Log dump, screenshot

**Expansion target**:
A visible region that maps a click to a named expansion action without depending on a fixed terminal row.
_Avoid_: Click row, hit box

**Viewport context**:
The transcript content that stays visible while an expansion action changes rendered height.
_Avoid_: Scroll position, frozen rows

## Expansion Interaction

**Tool execution**:
One rendered invocation of one tool.
_Avoid_: Item, message

**Tool group**:
Nearby tool executions that cc-tools displays under one summary header. Group membership does not prove simultaneous execution or a shared request.
_Avoid_: Batch

**Execution summary row**:
The primary compact row that represents one tool execution, whether standalone or inside a tool group.
_Avoid_: Item row, heading

**Header block**:
The execution summary row and every physical terminal row created when that logical row wraps.
_Avoid_: First line, top two lines

**Click expansion**:
The optional fullscreen interaction in which one click changes the local expansion or detail state of one tool execution. Click anchors are available only while Pi's global expansion mode is collapsed.
_Avoid_: Mouse mode, click mode

**Mouse input adapter**:
The version-specific adapter that converts one mouse input into click-anchor coordinates. Pi `0.84.4` uses a raw-terminal adapter. Pi versions that export `MouseRegion` use a native adapter. Only one adapter is active.
_Avoid_: Mouse system

**Click anchor**:
The full visible content span that accepts a mouse click. It excludes branch connectors and trailing blank padding.
_Avoid_: Click target, link

**Local expansion state**:
The collapsed or expanded state of one tool execution, changed without changing its peers.
_Avoid_: Global expansion mode

**Local detail state**:
The Level 0, Level 1, or Level 2 state of one tool execution, changed without changing its peers.
_Avoid_: Extra detail setting

**Collapsed summary layer**:
The collapsed presentation before Level 0. It does not expose result payload when expansion can reveal more information.
_Avoid_: Level 0, collapsed preview

**Effective final detail layer**:
The first detail state at which no more returned content can be revealed. It can occur before Level 2.
_Avoid_: Level 2, maximum level
