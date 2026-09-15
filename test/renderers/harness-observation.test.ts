import { observeRenderer, withRendererHarness } from "./harness.ts";

await withRendererHarness(
  {
    name: "renderer-observation-harness",
    stubTools: [],
  },
  async ({ toolExecution, toolGroup }) => {
    const regularExecution = toolExecution({
      tool: "read",
      id: "regular_observation_fixture",
      args: { path: "regular-fixture.ts" },
      result: {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 20 },
              (_, index) => `regular line ${index + 1}`,
            ).join("\n"),
          },
        ],
        isError: false,
      },
    });
    const regularFrame = regularExecution.observe(120);
    if (
      !regularFrame.text.includes("ctrl+o to expand") ||
      regularFrame.actions.length > 0
    ) {
      throw new Error(
        `default observation fixture did not preserve regular interaction mode: ${JSON.stringify(regularFrame)}`,
      );
    }

    const execution = toolExecution({
      tool: "read",
      id: "observation_fixture",
      args: { path: "fixture.ts" },
      interaction: "fullscreen",
      result: {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 20 },
              (_, index) => `observed line ${index + 1}`,
            ).join("\n"),
          },
        ],
        isError: false,
      },
      viewport: {
        height: 34,
        scrollTop: 73,
        followingEnd: false,
        prefixRows: 104,
      },
    });

    const collapsed = execution.observe(120);
    if (
      !collapsed.text.includes("20 lines loaded") ||
      collapsed.text.includes("observed line 1")
    ) {
      throw new Error(
        `collapsed observation did not expose visible summary behavior: ${JSON.stringify(collapsed.rows)}`,
      );
    }
    const expansion = collapsed.actions.find(
      (action) =>
        action.behavior === "toggle" && action.viewportAnchor === "top",
    );
    if (!expansion) {
      throw new Error(
        `collapsed observation did not expose its semantic expansion action: ${JSON.stringify(collapsed.actions)}`,
      );
    }

    const expansionTransition = execution.activate(expansion);
    if (
      !expansionTransition.accepted ||
      expansionTransition.before !== collapsed
    ) {
      throw new Error(
        "observation harness did not activate the semantic expansion action",
      );
    }
    let staleFrameRejected = false;
    try {
      execution.activate(expansion);
    } catch (error) {
      staleFrameRejected = String(error).includes(
        `renderer action belongs to stale frame ${expansion.frame}`,
      );
    }
    if (!staleFrameRejected) {
      throw new Error(
        `observation harness accepted an action from stale frame ${expansion.frame}`,
      );
    }
    const expanded = expansionTransition.after;
    if (
      !expanded.text.includes("observed line 8") ||
      expanded.text.includes("observed line 9")
    ) {
      throw new Error(
        `expanded observation did not preserve the visible preview limit: ${JSON.stringify(expanded.rows)}`,
      );
    }
    if (
      !expanded.actions.some(
        (action) =>
          action.behavior === "next-detail" && action.viewportAnchor === "top",
      )
    ) {
      throw new Error(
        `expanded observation did not expose its semantic detail action: ${JSON.stringify(expanded.actions)}`,
      );
    }
    if (!expanded.viewport || expanded.viewport.visibleSubjectRows < 8) {
      throw new Error(
        `expanded observation did not report viewport reveal behavior: ${JSON.stringify(expanded.viewport)}`,
      );
    }

    const updating = toolExecution({
      tool: "read",
      id: "updating_observation_fixture",
      args: { path: "updating-observed.ts" },
    });
    const updated = updating.updateResult({
      content: [{ type: "text", text: "UPDATED_OBSERVATION_PAYLOAD" }],
      isError: false,
    });
    if (!updated.text.includes("1 lines loaded")) {
      throw new Error(
        `result update did not return the new visible frame: ${JSON.stringify(updated.rows)}`,
      );
    }

    const group = toolGroup([
      {
        tool: "read",
        id: "grouped_observation_first",
        args: { path: "first-observed.ts" },
        interaction: "fullscreen",
        result: {
          content: [{ type: "text", text: "FIRST_GROUPED_PAYLOAD" }],
          isError: false,
        },
      },
      {
        tool: "read",
        id: "grouped_observation_second",
        args: { path: "second-observed.ts" },
        interaction: "fullscreen",
        result: {
          content: [{ type: "text", text: "SECOND_GROUPED_PAYLOAD" }],
          isError: false,
        },
      },
    ]);
    const groupedCollapsed = group.observe(120);
    const firstHeader = groupedCollapsed.actions.find(
      (action) =>
        action.behavior === "toggle" &&
        action.text.includes("first-observed.ts"),
    );
    const groupedTransition = firstHeader
      ? group.activate(firstHeader)
      : undefined;
    if (!groupedTransition?.accepted) {
      throw new Error(
        `group observation did not activate its first semantic child: ${JSON.stringify(groupedCollapsed)}`,
      );
    }
    const groupedExpanded = groupedTransition.after;
    if (
      !groupedExpanded.text.includes("FIRST_GROUPED_PAYLOAD") ||
      groupedExpanded.text.includes("SECOND_GROUPED_PAYLOAD")
    ) {
      throw new Error(
        `group observation did not isolate the activated child: ${JSON.stringify(groupedExpanded.rows)}`,
      );
    }
    group.setExpanded(true);
    const appendedGroup = group.append({
      tool: "read",
      id: "grouped_observation_third",
      args: { path: "third-observed.ts" },
      interaction: "fullscreen",
      result: {
        content: [{ type: "text", text: "THIRD_GROUPED_PAYLOAD" }],
        isError: false,
      },
    });
    if (!appendedGroup.text.includes("THIRD_GROUPED_PAYLOAD")) {
      throw new Error(
        `appended group child did not inherit global expansion: ${JSON.stringify(appendedGroup.rows)}`,
      );
    }
    const globallyCollapsed = group.setExpanded(false);
    if (
      globallyCollapsed.text.includes("FIRST_GROUPED_PAYLOAD") ||
      globallyCollapsed.text.includes("THIRD_GROUPED_PAYLOAD")
    ) {
      throw new Error(
        `global group collapse retained expanded payloads: ${JSON.stringify(globallyCollapsed.rows)}`,
      );
    }

    let rejectedUnknownAction = false;
    try {
      observeRenderer(
        { render: () => ["clickable"] },
        { clickActionAtPoint: () => "future-action" },
      ).observe(20);
    } catch (error) {
      rejectedUnknownAction = String(error).includes(
        "unsupported renderer click action",
      );
    }
    if (!rejectedUnknownAction) {
      throw new Error(
        "observation harness silently discarded an unknown clickable action",
      );
    }

    let settled = false;
    const asynchronous = observeRenderer({
      render: () => [settled ? "settled observation" : "pending observation"],
    });
    setTimeout(() => {
      settled = true;
    }, 10);
    const settledObservation = await asynchronous.waitFor(
      (observation) => observation.text.includes("settled observation"),
      { description: "test observation settlement" },
    );
    if (settledObservation.text !== "settled observation") {
      throw new Error(
        `async observation did not return its settled frame: ${JSON.stringify(settledObservation.rows)}`,
      );
    }

    console.log(
      "OK  renderer observation fixtures, groups, actions, activation, and settlement",
    );
  },
);
