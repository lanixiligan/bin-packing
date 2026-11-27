// Unit tests for the shipment colour helper.
// Run: node --test src/demo/components/capacity.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { colorFor } from "./capacity.ts";

test("each shipment keeps its colour", () => {
  assert.equal(colorFor(3), colorFor(3));
  assert.notEqual(colorFor(0), colorFor(1));
  assert.match(colorFor(5), /^hsl\(\d+(\.\d+)?, 55%, 74%\)$/);
});
