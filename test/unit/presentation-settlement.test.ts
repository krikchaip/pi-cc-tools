import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPresentationSettlement,
  hasPendingPresentation,
} from "../../extensions/pi-host/presentation-settlement.ts";

test("tracks pending presentation work by owner until every settlement completes", () => {
  const owner = {};
  const otherOwner = {};
  const completed: string[] = [];

  const first = beginPresentationSettlement(owner, () =>
    completed.push("first"),
  );
  const second = beginPresentationSettlement(owner, () =>
    completed.push("second"),
  );

  assert.equal(hasPendingPresentation(owner), true);
  assert.equal(hasPendingPresentation(otherOwner), false);

  first.complete();
  first.complete();
  assert.equal(hasPendingPresentation(owner), true);
  assert.deepEqual(completed, ["first"]);

  second.complete();
  assert.equal(hasPendingPresentation(owner), false);
  assert.deepEqual(completed, ["first", "second"]);
});
