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
