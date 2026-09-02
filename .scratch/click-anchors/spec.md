# cc-tools Per-Execution Click Expansion

Status: Implementation in progress

## Goal

Add local mouse actions to cc-tools-owned components in fullscreen mode without changing their baseline renderer depths or rows. Keyboard behavior remains the baseline in regular mode and while Pi's global expansion mode is expanded.

## Authoritative baseline

Renderer behavior comes from `github.com/krikchaip/pi-cc-tools@personal` commit `c7446b34dd78caeaf1a6be9f5200367bc6a4b7a6`. The row-by-row baseline and surface caps are recorded in `baseline-matrix.md`.

## Settled decisions

- Scope includes every cc-tools-owned expandable surface: standalone tools, tool groups, running previews, MCP and generic errors, rich diffs, multi-edit and multi-file previews, and truncation rows.
- Pi-owned startup help, loaded resources, skill invocations, compaction summaries, branch summaries, and `!` Bash executions are deferred to a separate plugin.
- A tool group header provides non-clickable guidance: `click any for details`. Only `click` uses the theme's `dim` style; the remaining words use `muted`.
- Each child tool execution in a tool group has its own local expansion state.
- A grouped child anchor covers every physical row of its wrapped semantic header block, whether the child is collapsed or locally expanded. It never extends into payload rows.
- Click geometry follows semantic renderer regions, not fixed terminal row numbers. A wrapped header remains one header block.
- A click anchor covers the full visible content of its semantic region. It excludes a leading branch connector and trailing blank padding. Only the word `click` uses distinct `dim` styling.
- A collapsed standalone execution expands from its full header block, renderer-declared result summary row, or expansion action row. Raw payload is never inferred to be clickable because it happens to occupy the second physical row.
- Every renderer-declared result summary row is a stable expansion anchor across standalone executions and tool groups. It expands a collapsed execution and collapses an expanded execution. The row stays visually unchanged. Its anchor covers the full semantic row while excluding branch connectors and trailing padding.
- A collapsed action row uses wording such as `5 lines loaded • click to expand`.
- A first local expansion uses that surface's first keyboard-expanded depth from the personal baseline. Read and Grep use `previewLines`; Bash uses `bashCollapsedLines`. MCP, running previews, and generic success output keep their personal configured expanded cap.
- While another detail layer exists, an expanded truncation row shows only `... (N more lines • click for more detail)`. Its one detail anchor covers the full visible semantic row, excluding the leading branch connector and trailing padding. The expanded header remains a collapse anchor.
- Read, Grep, and Bash detail advances one layer at a time: normal preview, then `expandedPreviewMaxLines`, then `extraExpandedPreviewMaxLines`. The truncation row remains while content is still hidden.
- The effective final detail layer is the first more-detail state that reveals all returned content, even when it occurs below the highest configured detail level. A normal preview that already contains all returned content does not get a dedicated bottom action row; its result summary row remains the collapse anchor. At an effective final detail layer, render a dedicated `click to collapse` action row after the payload. Connect the result summary to that final row with continuous branch characters. Its collapse anchor covers the full visible semantic row, excluding the branch connector and trailing padding. Read and Bash follow the same rule. If the highest display cap still hides content, keep a non-action hidden-count row before the collapse row.
- Tool-owned notices about source content that requires another execution, such as a later Read offset, are part of the current returned payload. They do not prevent the current execution from reaching its effective final detail layer.
- Raw output, empty-output placeholders such as `(no output)`, MCP key-value fields, error text, rich diff bodies, and images remain selectable and non-clickable.
- OSC-8 links, drag selection, double-click word selection, and triple-click line selection take priority and never toggle expansion. A single click paints immediately; a later multi-click restores the pre-click local state before selection.
- More-detail state is local to one tool execution. Collapsing clears every local detail level.
- Bare truncation rows preserve personal behavior unless the surface has a real deeper renderer layer. Click expansion does not invent unsupported detail output.
- Pending and running tool executions are clickable.
- While global expansion mode is collapsed, fullscreen click anchors are active and each tool execution changes independently.
- While global expansion mode is expanded, click behavior and click labels are absent. The UI returns to its baseline keyboard labels and behavior as if click expansion were not installed.
- Switching global expansion mode back to collapsed resets prior per-execution states.
- A new tool execution follows global expansion mode. During mixed local states it starts collapsed instead of copying an expanded sibling.
- Regular mode keeps the configured keyboard hints because Pi does not dispatch component mouse events there.
- One optional `clickExpansion` boolean gates every cc-tools fullscreen click label and anchor. It defaults to `false`.
- `/cc-tools click on|off|toggle|status` changes or reports the gate without a restart.
- Disabling click expansion immediately resets all local expansion and detail states. It does not change Pi's global keyboard expansion state.
- Option+J and Ctrl+Shift+O remain functional while click expansion is enabled, but fullscreen local click UI does not advertise them.
- README settings, command documentation, and the complete example configuration must document `clickExpansion`.
- cc-tools owns its mouse handling. It uses raw terminal mouse input on Pi `0.84.4` and native mouse dispatch when Pi exports `MouseRegion`. Both adapters use the same semantic anchors.
- Implementation stays in `/Users/asol/Desktop/projects/pi-cc-tools`; Pi's installed package cache remains read-only.
- Use **tool group**, not **batch**, because cc-tools groups nearby executions without proving simultaneity or a shared request.

## Baseline verification before redesign

- Isolated Pi `0.84.4` fullscreen captures verified the personal standalone and tool-group collapsed, expanded, and re-collapsed rows.
- Personal tool groups expand or collapse all children with the configured global key. Independent child expansion is a click-only addition while global mode is collapsed.
- `npm run typecheck`, `npm test`, `npm run test:mcp-renderer`, and `npm run test:shell-settings` pass.
- `e2e/expect/tool-group-click.expect` passes on Pi `0.84.3` and `0.84.4` in direct fullscreen mode.
- The same E2E passes on Pi `0.84.4` after a runtime regular-to-fullscreen mode switch.
- The E2E proves branch-connector rejection, independent expansion and collapse for each child, and the global Option+J override and reset.
- `e2e/expect/mcp-batch-anchor.expect` still passes.
- The native adapter was checked against the `MouseRegion` and component-dispatch interfaces in `/tmp/pi-mono-dev`.
