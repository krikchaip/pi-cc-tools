import {
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const BUILTIN_EXPANSION_PATCH_FLAG = Symbol.for("pi-claude-style-tools:builtin-expansion-patch");
const BUILTIN_EXPANSION_STATE = Symbol.for("pi-claude-style-tools:builtin-expansion-state");

export default function staleBuiltinSummaryWrapper(_pi: ExtensionAPI): void {
  for (const ComponentClass of [
    CompactionSummaryMessageComponent,
    BranchSummaryMessageComponent,
  ]) {
    const proto = ComponentClass.prototype as any;
    if (proto[BUILTIN_EXPANSION_PATCH_FLAG]) continue;
    const originalRender = proto.render;
    proto.render = function staleBuiltinExpandableRender(width: number): string[] {
      const rows = originalRender.call(this, width);
      const state = (this[BUILTIN_EXPANSION_STATE] ??= { version: 0 });
      state.width = width;
      state.height = rows.length;
      state.rows = rows;
      return rows;
    };
    proto[BUILTIN_EXPANSION_PATCH_FLAG] = true;
  }
}
