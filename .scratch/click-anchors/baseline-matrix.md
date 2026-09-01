# Click expansion baseline and change matrix

Status: authoritative baseline recorded from `github.com/krikchaip/pi-cc-tools@personal`.

## Authority and verification

- Remote ref: `refs/heads/personal`
- Fetched commit: `c7446b34dd78caeaf1a6be9f5200367bc6a4b7a6`
- Local worktree commit before the click work: the same commit
- Verification: `git fetch origin refs/heads/personal` left the current branch and worktree unchanged.
- Source inspection: `git show FETCH_HEAD:extensions/index.ts`
- Live observation: Pi `0.84.4`, Fullscreen TUI, isolated archive of the fetched commit, isolated HOME and `PI_CODING_AGENT_DIR`, 20-line Read fixtures, `previewLines=8`, and `app.tools.expand=option+j`.

The **personal branch** is the only baseline in this document. The current working tree, current click E2Es, and the user screenshot describe proposed or in-progress click behavior. They do not override the personal-branch baseline.

---

# Part 1 — Personal-branch baseline

The personal branch has global keyboard expansion. It has no per-execution mouse expansion.

## Standalone Read: observed rows

### Collapsed

```text
● Read standalone.txt (offset=1, limit=400)
└ 20 lines loaded • option+j to expand
```

Rules:

- The header identifies the tool and arguments.
- The result summary reports the returned line count.
- No settled payload line is visible.
- The configured global expand key appears on the result summary row.

### Expanded with Option+J

```text
● Read standalone.txt (offset=1, limit=400)
└ 20 lines loaded
  standalone line 01
  ...
  standalone line 08
  ... (12 more lines • option+j to collapse • ctrl+shift+o more detail)
```

Rules:

- The first keyboard expansion shows the normal Read preview: `previewLines`, default 8.
- It does not show line 9.
- The loaded-count row remains.
- A hidden-content row remains because more returned lines exist.
- The hidden-content row contains both configured global collapse guidance and Ctrl+Shift+O more-detail guidance.

### Collapsed again with Option+J

The tool returns to the exact collapsed shape: header, loaded-count row, and `option+j to expand`. All payload rows and the hidden-content row disappear.

## Tool group: observed rows

The live fixture contained two adjacent Read executions with 20 lines each.

### Group collapsed

```text
● Read: 2 done • option+j to expand
├ ● first.txt (offset=1, limit=400)
└ ● second.txt (offset=1, limit=400)
```

Rules:

- A homogeneous group uses the tool label, here `Read`.
- A mixed group uses `Multiple Tools` and adds a compact name summary such as `read×2, ls`.
- The group header owns the global keyboard expansion guidance.
- Each child is one compact execution summary row.
- Child result summaries, payloads, and hidden-content rows are absent.
- No child has an independent baseline expansion state.

### Group expanded with Option+J

```text
● Read: 2 done • option+j to collapse • ctrl+shift+o more detail
├ ● first.txt (offset=1, limit=400)
│ └ 20 lines loaded
│   first line 01
│   ...
│   first line 08
│   ... (12 more lines • option+j to collapse • ctrl+shift+o more detail)
└ ● second.txt (offset=1, limit=400)
  └ 20 lines loaded
    second line 01
    ...
    second line 08
    ... (12 more lines • option+j to collapse • ctrl+shift+o more detail)
```

Rules:

- One global expansion action expands **all children at once**.
- Every expanded child uses the same renderer and normal cap as its standalone form.
- Every expanded child keeps its loaded-count row and hidden-content row.
- The group header and each hidden-content row advertise global collapse and more detail.
- Group branch guides add structure only. They do not change a child renderer's content policy.

### Group collapsed again with Option+J

Both children return to compact rows in one action. Their loaded-count rows, payload rows, and hidden-content rows disappear together.

## Personal-branch state matrix

| Layout | State | Exact baseline behavior |
|---|---|---|
| Standalone | Settled collapsed | Header + renderer result summary. Read/Grep/Bash settled payload is hidden. Result summary advertises the configured global expand key. |
| Standalone | Keyboard expanded | One execution shows its personal-branch normal expanded renderer. A hidden-content row remains when output exceeds that renderer's normal cap. |
| Standalone | Keyboard collapsed | Returns to header + result summary. Expanded payload is removed. |
| Standalone | Pending | Header and pending status. There may be no result summary yet. |
| Standalone | Running | Header contains live line count. A collapsed live preview uses `liveToolPreviewLines`, default 5. Bash uses a tail preview and can show `... earlier lines`. |
| Standalone | Source truncated | Read/Grep append `(truncated)`; Bash appends `[truncated]`. More display detail cannot recover data that the tool did not return. |
| Tool group | Collapsed | Group header + one compact row per child. The header advertises the global expand key. |
| Tool group | Keyboard expanded | Every child expands together. Each child renders its standalone expanded rows under group branch guides. |
| Tool group | Keyboard collapsed | Every child collapses together. No mixed child state remains. |
| Tool group | Pending/running | Collapsed group keeps the child compact. Expanded group shows that child's normal live renderer under group guides. Group status counts and blinking status continue. |
| Both | Ctrl+Shift+O | A global setting toggles extra detail and re-renders the globally expanded tool output. It is not per execution. Surface support is not uniform; see below. |

## Personal-branch surface caps

| Surface | Personal-branch collapsed form | Personal-branch first keyboard-expanded form | Personal-branch more-detail behavior |
|---|---|---|---|
| Read | Count only. | `previewLines`, default 8, then `... more lines`. | The row advertises Ctrl+Shift+O, but Read passes `detailExpanded=false`; its 8-row cap does not use the configured expanded caps. |
| Grep | Match count only. | `previewLines`, default 8, then `... more lines`. | Same implementation behavior as Read. |
| Bash | Status/count; a preserved live tail can remain. | `bashCollapsedLines`, default 10, then `... more lines`. | Same implementation behavior as Read. |
| Find | File count only. | `previewLines`, default 8, then bare `… more files`. | No second display layer is implemented for the bare row. |
| List | Entry count only. | `previewLines`, default 8, then bare `… more entries`. | No second display layer is implemented for the bare row. |
| Running preview | `liveToolPreviewLines`, default 5. Bash shows the latest rows. | `expanded=true` can use `expandedPreviewMaxLines`, default 4,000. | Global extra detail can use `extraExpandedPreviewMaxLines`, default 12,000. |
| MCP JSON/prose | Bounded preview at `previewLines`, default 8. | `expandedPreviewMaxLines`, default 4,000. | `extraExpandedPreviewMaxLines`, default 12,000. |
| MCP key/value | `min(4, previewLines)`. | `expandedPreviewMaxLines`, default 4,000. | `extraExpandedPreviewMaxLines`, default 12,000. |
| MCP error | Error summary only. | Up to `expandedPreviewMaxLines`, default 4,000. | Up to `extraExpandedPreviewMaxLines`, default 12,000. |
| Generic external-tool success | Line count only. | Multi-line output uses `expandedPreviewMaxLines`, default 4,000. | Up to `extraExpandedPreviewMaxLines`, default 12,000. |
| Generic external-tool error | First error line only. | Every error line; no display cap or hidden-content row. | No second layer exists. |
| Write diff | Collapsed diff uses `diffCollapsedLines`, default 24. | Normal expanded diff cap is 150. | No per-execution detail state exists. |
| Edit call preview | One edit: 32 diff rows. Multi-edit: first 3 blocks sharing 60 rows. | One edit: 60 rows. Multi-edit: all blocks sharing 150 rows. | No per-execution detail state exists. |
| Apply-patch call preview | Same 32-row / first-3-block shape as Edit. | Same 60-row / all-block shape as Edit. | No per-execution detail state exists. |
| Task list | Summary only. | `previewLines`, default 8, then bare `… more tasks`. | No second display layer exists. |
| Read image | Image summary only. | Full image result or fallback. | No separate deeper image layer exists. |

## Important personal-branch facts

1. The personal branch expands a group globally. It cannot produce one expanded child beside collapsed siblings.
2. The personal branch preserves the short 8-row Read preview and its `... more lines` row after the first expansion.
3. The personal branch keeps both collapse and more-detail guidance on the hidden-content row.
4. The personal branch has no mouse anchors and no local expansion or detail state.
5. `expandedPreviewMaxLines` is not a universal first-expansion cap. Different renderers use different personal-branch caps.

---

# Part 2 — Required click-only additions

These additions must sit on top of the personal baseline. They must not replace its renderer depths or remove its rows.

## Standalone click additions

| Personal behavior to preserve | Click-only addition | Acceptance rule |
|---|---|---|
| Collapsed header + result summary | Add a local expand anchor to the full semantic header block and renderer-declared result summary/action row. Replace the visible global expand-key hint with `click to expand` only while local click mode is active. | One click changes only this execution. Raw payload and structural guides remain non-clickable. |
| First keyboard expansion uses the surface's personal normal cap | First local click selects the same normal renderer layer. | Read click 1 shows 8 rows by default, not 4,000 or 12,000. The hidden-content row remains. |
| Expanded hidden-content row shows collapse and more-detail guidance | Add separate semantic collapse and detail anchors without deleting the hidden-content row. | The row shows distinct `click to collapse` and `click for more detail` spans when a deeper layer is available. The expanded header is also a collapse anchor. |
| Global collapse removes all expanded rows | Local header click collapses this execution and clears its local detail state. | A later re-expand starts at the normal layer. |
| Global Ctrl+Shift+O is one shared setting | Add local detail state for one execution. | A local detail click does not change peers. Remaining hidden content keeps a gate. |
| Pending/running renderers update over time | Permit local header and action-row clicks during execution. | Streaming updates preserve local state and status animation. |

## Tool-group click additions

| Personal behavior to preserve | Click-only addition | Acceptance rule |
|---|---|---|
| Collapsed group header and compact child rows | Replace the group keyboard suffix with muted, non-clickable `click any for details`. Add one anchor to each child header block. | Branch connector, status dot, and trailing padding are outside the child anchor. |
| Global keyboard action expands all children | Local child click expands only the selected child when global mode is collapsed. | Siblings stay compact. Group membership and order stay unchanged. |
| Expanded child uses its standalone renderer | Use the same personal normal cap and the same result/truncation rows for a locally expanded child. | A locally expanded Read child shows count + 8 rows + `... more lines`; it does not render all returned lines. |
| Global keyboard action collapses all children | Local expanded-child header click collapses only that child. | Row geometry is recomputed before another child receives a click. |
| Global Ctrl+Shift+O affects all expanded tools | Local child detail action affects one child. | Group cache and selected child update; siblings do not re-render or change cap. |
| Global expanded group shows keyboard guidance | Disable local labels and anchors while Pi global expansion is active. | The exact personal global group output returns, including all-child expansion and keyboard hints. |

## Click-only state transitions

### Standalone

```text
local collapsed
  --click header/summary--> local normal expansion
  --click more detail-----> local standard-detail expansion
  --click more detail-----> local extra-detail expansion, if content remains
  --click collapse--------> local collapsed + all detail levels cleared
```

### Tool-group child

```text
child A compact, child B compact
  --click child A---------> child A normal, child B compact
  --click A more detail---> child A more detail, child B compact
  --click child A header--> child A compact, child B compact
```

This mixed child state is a click-only addition. It is not personal-branch baseline behavior.

## Global-mode boundary

- While Pi global expansion is collapsed, local click states can differ per execution.
- While Pi global expansion is expanded, the personal-branch global behavior is authoritative: all applicable children expand, keyboard hints return, and click routing is inactive.
- When Pi returns to global collapsed mode, all prior local expansion and detail states reset.
- A new execution inherits global expanded mode when global mode is active. Otherwise it starts locally collapsed.

## Click-only invariants

1. A first click never selects a deeper cap than the personal first keyboard expansion for that surface.
2. A hidden-content row never disappears while returned content remains hidden.
3. A detail click changes one execution only.
4. A group header gives guidance only; it is not a local expand-all anchor.
5. Selection, OSC-8 links, drag, double-click, and triple-click take priority over expansion.

---

# Part 3 — Settled click-only decisions

## 1. Local detail caps for Read, Grep, and Bash

The user selected the three-layer sequence:

1. First local expansion uses the personal normal preview: `previewLines` for Read/Grep and `bashCollapsedLines` for Bash.
2. First local detail action uses `expandedPreviewMaxLines`, default 4,000.
3. If content remains, the next local detail action uses `extraExpandedPreviewMaxLines`, default 12,000.

Each layer keeps a hidden-content row while more returned content exists. Collapse clears the detail level.

## 2. MCP and generic success first click

Use strict personal-baseline mapping. Their first local expansion keeps the personal configured expanded cap. Click mode does not add a new short layer.

## 3. Collapse control on expanded truncation rows

Use two separate spans on one row: `... more lines • click to collapse • click for more detail`. The header also remains a collapse anchor.

## 4. Generic errors and bare truncation rows

Preserve personal renderer behavior. Do not add a bounded error layer or a detail action where no deeper renderer layer exists.
