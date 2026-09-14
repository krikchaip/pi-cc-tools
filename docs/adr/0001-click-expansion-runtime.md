# Own click expansion in one reload-stable runtime

Status: Accepted and implemented

Use one click-expansion runtime with one internal semantic-anchor index for tool groups, standalone tools, and Pi-owned expandable transcript surfaces. This boundary keeps rendering markers, native and raw mouse dispatch, expansion state, rollback, viewport preservation, async settlement, and reload-safe host patches consistent. Per-surface controllers were rejected because they keep the render protocol split; a reducer was rejected because it leaves Pi effects scattered through the extension entry point.

The public runtime interface is limited to `state(target)`, `declare(target, copy, options)`, `publish(owner, finalRows)`, and `installClickExpansion({ enabled })`. `extensions/index.ts` supplies narrow host adapters for presentation layout, activation transactions, rollback, and retained Pi prototypes. Runtime state and host bridges use `Symbol.for(...)` roots so extension reloads keep one current implementation.

Declarations can carry a non-exported `compatibilityAction` intersection during migration. The runtime validates it against the authoritative behavior before it routes retained `header`, `expand`, `detail`, or `detail-extra` host semantics. This field is not part of `ExpansionDeclaration` and must be removed when the old action taxonomy is retired.

Viewport capture and settlement live in `extensions/click-expansion/viewport.ts`. Native and raw SGR mouse arbitration lives in `extensions/click-expansion/mouse.ts`. Marker declaration, final-coordinate publication, target state, activation, rollback, and reload ownership live in `extensions/click-expansion/index.ts`.

Validation covers marker-free wrapping, final-coordinate hit testing, grouped header and Agent lifecycle routing, target-local mutation and rollback, Pi-owned transcript state, native and raw mouse dispatch, immediate wheel rollback, semantic top and bottom anchors, and reload-stable anchors.
