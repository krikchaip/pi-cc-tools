export interface ClickRoutingHostPorts {
  readonly grouping: Pick<
    typeof import("./grouping.ts"),
    "clickRuntime" | "isToolGroupComponent"
  >;
  readonly toolExecution: Pick<
    typeof import("./tool-execution.ts"),
    "bashCollapsedLimit" | "findToolExecutionAncestor" | "previewLimit"
  >;
  readonly toolFamily: Pick<
    typeof import("./tool-family.ts"),
    "isMcpToolCandidate" | "isMcpToolName"
  >;
  readonly presentation: {
    readonly toolPresentationModule: import("../tool-presentation/index").ToolPresentationModule;
  };
}

export interface GroupingHostPorts {
  readonly clickRouting: Pick<
    typeof import("./click-routing.ts"),
    | "baselineToolOutputDetailHint"
    | "clearToolRenderCache"
    | "clickExpansionEnabled"
    | "clickExpansionModule"
    | "isKnownSideQuestAgentTool"
    | "isSideQuestBinaryTool"
    | "setToolLocalDetailLevel"
    | "sideQuestAgentPresentation"
    | "sideQuestAgentResultLabel"
    | "summarizeText"
    | "toolClickExpansionActive"
    | "toolClickStateKey"
    | "toolLocalDetailLevel"
  >;
  readonly toolExecution: Pick<
    typeof import("./tool-execution.ts"),
    | "FG_DIM"
    | "_globalBlinkPhase"
    | "_globalBlinkPhaseIndex"
    | "_toolBranchVisualEpoch"
    | "currentToolBranchAnsi"
    | "isToolTextComponent"
    | "shortPath"
    | "stripWrapMarks"
    | "toolBranchRenderCacheKey"
  >;
  readonly toolFamily: Pick<
    typeof import("./tool-family.ts"),
    "getMode" | "getStringArg" | "humanizeToolName"
  >;
  readonly transcript: Pick<
    typeof import("./transcript.ts"),
    | "THINKING_ACTIVE_KEY"
    | "THINKING_DURATION_KEY"
    | "clickAnchorStart"
    | "getMessageThinkingDurationMs"
    | "publishStandaloneToolClickAnchors"
    | "toolClickAnchorAtPoint"
    | "toolHasEffectiveClickAction"
    | "transcriptTiming"
    | "trimRenderedBlankLines"
  >;
  readonly presentation: {
    readonly toolPresentationModule: import("../tool-presentation/index").ToolPresentationModule;
  };
}

export interface PiHostDependencies {
  readonly presentation: {
    readonly diffPresentationModule: import("../diff-presentation/index").DiffPresentationModule;
    readonly toolPresentationModule: import("../tool-presentation/index").ToolPresentationModule;
  };
  readonly clickExpansion: {
    readonly initial: import("../click-expansion/index").ClickExpansionRuntime;
    create(
      enabled: boolean,
    ): import("../click-expansion/index").ClickExpansionRuntime;
  };
}

export interface ToolExecutionHostPorts {
  readonly clickRouting: Pick<
    typeof import("./click-routing.ts"),
    | "configuredKeyHint"
    | "extraToolOutputExpanded"
    | "normalizeToolClickDetailLevel"
    | "resolveClickHints"
    | "safeInvalidate"
    | "themedRawKeyHint"
    | "toolClickExpansionActive"
    | "toolClickStateKey"
    | "toolLocalDetailLevel"
    | "toolRenderBridge"
    | "toolSupportsProgressiveLocalDetail"
    | "unrefTimer"
  >;
  readonly grouping: Pick<
    typeof import("./grouping.ts"),
    | "AGENT_BREATHE_LEN"
    | "agentBreatheDot"
    | "alignTrailingMarkedLine"
    | "isToolExecutionComponent"
    | "setToolStatusColors"
    | "themeStatusDot"
  >;
  readonly toolFamily: Pick<
    typeof import("./tool-family.ts"),
    "lineCountLabel"
  >;
  readonly transcript: Pick<
    typeof import("./transcript.ts"),
    "rawIndexAtVisibleColumn" | "setWorkedLineForeground" | "transcriptTiming"
  >;
  readonly presentation: {
    readonly diffPresentationModule: import("../diff-presentation/index").DiffPresentationModule;
    readonly toolPresentationModule: import("../tool-presentation/index").ToolPresentationModule;
  };
}

export interface ToolFamilyHostPorts {
  readonly clickRouting: Pick<
    typeof import("./click-routing.ts"),
    "extraToolOutputExpanded" | "safeInvalidate" | "toolOutputDetailHint"
  >;
  readonly grouping: Pick<
    typeof import("./grouping.ts"),
    "isAgentFamilyToolName"
  >;
  readonly toolExecution: Pick<
    typeof import("./tool-execution.ts"),
    | "applyThemePaletteIfNeeded"
    | "clearBlinkTimer"
    | "decideToolFamilyResult"
    | "liveLineCountTrailing"
    | "liveToolPreviewEnabled"
    | "liveToolPreviewLimit"
    | "makePresentationText"
    | "makeResponsiveDiffText"
    | "makeSettledToolFamilyResultText"
    | "makeText"
    | "makeToolFamilyCallText"
    | "markResultSummary"
    | "progressiveLocalControlsEnabled"
    | "progressiveLocalDetailLevelForRender"
    | "setToolStatus"
    | "setupBlinkTimer"
    | "shortPath"
    | "stableCallSummary"
    | "syncToolCallStatus"
    | "toolHeader"
    | "toolStatusDot"
    | "withBranch"
    | "withToolErrorIndent"
  >;
  readonly transcript: Pick<
    typeof import("./transcript.ts"),
    | "THINKING_ACTIVE_KEY"
    | "THINKING_DURATION_KEY"
    | "WORKED_DURATION_KEY"
    | "WORKED_SESSION_TOTAL_KEY"
    | "WORKED_START_KEY"
    | "WORKED_TURNS_KEY"
    | "completeMcpResultForPresentation"
    | "resultTextContent"
    | "stripWorkedDurationLine"
    | "transcriptTiming"
  >;
  readonly presentation: {
    readonly toolPresentationModule: import("../tool-presentation/index").ToolPresentationModule;
  };
}

export interface TranscriptHostPorts {
  readonly clickRouting: Pick<
    typeof import("./click-routing.ts"),
    | "clearToolRenderCache"
    | "clickExpansionModule"
    | "isSideQuestBinaryTool"
    | "sideQuestAgentPresentation"
    | "sideQuestBinaryHasHiddenContent"
    | "toolClickExpansionActive"
    | "toolRenderBridge"
    | "toolSupportsProgressiveLocalDetail"
  >;
  readonly grouping: Pick<
    typeof import("./grouping.ts"),
    | "builtinComponentExpanded"
    | "builtinExpansionChangesOutput"
    | "builtinExpansionState"
    | "getThinkingMode"
    | "isAssistantThinkingComplete"
    | "isLiveThinkingMessage"
    | "isMarkdownComponent"
    | "isSideQuestEventMessage"
    | "isTextComponent"
    | "normalizeLeadingCheckGlyph"
    | "padPaintedLineToWidth"
    | "refreshBuiltinClickHandlers"
    | "requestedToolClickViewportAnchor"
    | "sideQuestPaintedBounds"
    | "splitRenderedImageBlock"
    | "stripOuterBackgroundAnsi"
  >;
  readonly toolExecution: Pick<
    typeof import("./tool-execution.ts"),
    | "_toolBranchVisualEpoch"
    | "isToolTextComponent"
    | "syncToolCallStatus"
    | "withFinalBranchBlock"
  >;
  readonly toolFamily: Pick<
    typeof import("./tool-family.ts"),
    | "getMode"
    | "isMcpToolCandidate"
    | "isMcpToolName"
    | "renderApplyPatchCall"
    | "renderApplyPatchResult"
    | "renderGenericToolCall"
    | "renderGenericToolResult"
    | "renderMcpToolResult"
    | "renderOpenAiToolResult"
    | "shouldUseGenericToolRenderer"
  >;
}
