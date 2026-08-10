import assert from "node:assert/strict";

import { clampLineWidth } from "../extensions/index.ts";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

assert.equal(stripAnsi(clampLineWidth("0123456789", 7)), "0123456");
assert.equal(stripAnsi(clampLineWidth("short", 7)), "short");
assert.ok(!clampLineWidth("0123456789", 7).includes("..."));

console.log("line clamp tests passed");
