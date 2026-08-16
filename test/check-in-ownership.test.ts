import { test } from "node:test";
import assert from "node:assert/strict";
import { isClientOwnedBy } from "../app/lib/client-ownership.ts";

test("rejects a client owned by a different coach", () => {
  assert.equal(isClientOwnedBy({ id: 7, ownerId: "coach-a" }, 7, "coach-b"), false);
});

test("rejects a missing client row", () => {
  assert.equal(isClientOwnedBy(null, 7, "coach-a"), false);
  assert.equal(isClientOwnedBy(undefined, 7, "coach-a"), false);
});

test("rejects a client whose id does not match", () => {
  assert.equal(isClientOwnedBy({ id: 9, ownerId: "coach-a" }, 7, "coach-a"), false);
});

test("accepts the owning coach for the matching client", () => {
  assert.equal(isClientOwnedBy({ id: 7, ownerId: "coach-a" }, 7, "coach-a"), true);
});
