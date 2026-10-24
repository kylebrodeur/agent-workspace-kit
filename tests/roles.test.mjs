// Tests for lib/roles.mjs: role selection from the manifest, with the
// --roles and --fresh lists. No real agent is needed: pure functions over
// the manifest's role keys.
import assert from "node:assert/strict";
import test from "node:test";

import { RoleSelectionError, selectRoles } from "../lib/roles.mjs";

const CONFIG = {
  version: 1,
  team: { name: "demo", group: "demo" },
  hub: { role: "planner", mode: "designated" },
  roles: {
    planner: { profile: ".pi-link/profiles/planner.md" },
    builder: { profile: ".pi-link/profiles/builder.md" },
    reviewer: { profile: ".pi-link/profiles/reviewer.md" },
  },
};

function expectError(fn, message) {
  assert.throws(fn, (error) => error instanceof RoleSelectionError && error.message === message);
}

test("default selection is every role key in manifest order", () => {
  const result = selectRoles(CONFIG, {});
  assert.deepEqual(result.selected, ["planner", "builder", "reviewer"]);
  assert.deepEqual(result.reset, []);
});

test("--roles selects the subset in the given order", () => {
  const result = selectRoles(CONFIG, { roles: "reviewer,planner" });
  assert.deepEqual(result.selected, ["reviewer", "planner"]);
  assert.deepEqual(result.reset, []);
});

test("unknown role in --roles is an error listing the valid roles", () => {
  expectError(
    () => selectRoles(CONFIG, { roles: "ghost" }),
    "error: unknown role 'ghost'. Valid: planner, builder, reviewer",
  );
});

test("empty --roles list is an error", () => {
  expectError(
    () => selectRoles(CONFIG, { roles: "" }),
    "error: --roles must select at least one role",
  );
});

test("--fresh=a,b resets those roles and selects them", () => {
  const result = selectRoles(CONFIG, { fresh: "builder" });
  assert.deepEqual(result.selected, ["builder"]);
  assert.deepEqual(result.reset, ["builder"]);
});

test("bare --fresh resets the whole selected set", () => {
  const result = selectRoles(CONFIG, { fresh: true });
  assert.deepEqual(result.selected, ["planner", "builder", "reviewer"]);
  assert.deepEqual(result.reset, ["planner", "builder", "reviewer"]);
});

test("--fresh list with a selected --roles list overrides the selection", () => {
  const result = selectRoles(CONFIG, { roles: "planner,builder", fresh: "reviewer" });
  assert.deepEqual(result.selected, ["reviewer"]);
  assert.deepEqual(result.reset, ["reviewer"]);
});

test("unknown role in the --fresh list is an error", () => {
  expectError(
    () => selectRoles(CONFIG, { fresh: "ghost" }),
    "error: unknown role 'ghost'. Valid: planner, builder, reviewer",
  );
});

test("selection order is the option order, never sorted", () => {
  const result = selectRoles(CONFIG, { roles: "builder,planner" });
  assert.deepEqual(result.selected, ["builder", "planner"]);
});