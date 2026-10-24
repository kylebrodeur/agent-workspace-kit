// Tests for lib/node-runtime.mjs: the Node version contract.
//
// The kit's engines field is the contract ("engines.node >= 24" in
// package.json), and the runtime check reads it from the package instead
// of restating it (the manifest-is-the-single-description rule, applied
// to the runtime). These tests pin the observable behavior: an old Node
// fails with one plain line, a supported Node passes, and an unreadable
// engines shape fails closed rather than letting an unknown runtime
// through.
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { nodeRangeError, pathWithRuntimeFirst, runtimeRequirementError } from "../lib/node-runtime.mjs";

function pkgEngines() {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  return pkg.engines.node;
}

test("nodeRangeError fails an unsupported version with the exact one-liner", () => {
  const range = pkgEngines();
  assert.equal(range, ">=24");
  assert.equal(
    nodeRangeError("v22.23.2", range),
    "error: agent-workspace-kit requires Node >=24; running v22.23.2",
  );
});

test("nodeRangeError passes every supported runtime", () => {
  const range = pkgEngines();
  assert.equal(nodeRangeError("v24.0.0", range), null);
  assert.equal(nodeRangeError("v25.1.0", range), null);
  assert.equal(nodeRangeError("v25.8.0", range), null);
});

test("nodeRangeError is range-driven, not hardcoded to >=24", () => {
  assert.equal(nodeRangeError("v20.0.0", ">=21"), "error: agent-workspace-kit requires Node >=21; running v20.0.0");
  assert.equal(nodeRangeError("v21.5.0", ">=21"), null);
});

test("nodeRangeError fails closed on malformed ranges", () => {
  for (const range of ["", "24", "next", ">=24 <26", "lts/*"]) {
    const error = nodeRangeError("v24.0.0", range);
    assert.ok(error !== null, `range ${JSON.stringify(range)} must not pass silently`);
    assert.match(error, /^error: agent-workspace-kit requires Node /);
    assert.match(error, /running v24\.0\.0$/);
  }
});

test("nodeRangeError fails closed on malformed versions", () => {
  for (const version of ["", "24", "v24", "24.0.0", "v24.0.0-x", "vLTS"]) {
    const error = nodeRangeError(version, ">=24");
    assert.ok(error !== null, `version ${JSON.stringify(version)} must not pass silently`);
    assert.match(error, /^error: agent-workspace-kit requires Node /);
  }
});

test("runtimeRequirementError reads the package engines field", () => {
  // The running test process is whatever npm spawned; both branches are
  // legitimate. The contract is the MESSAGE shape, and the engines field
  // must be the one the check read.
  const error = runtimeRequirementError();
  if (error === null) {
    const ok = nodeRangeError(process.version, pkgEngines());
    assert.equal(ok, null);
    return;
  }
  assert.equal(
    error,
    `error: agent-workspace-kit requires Node ${pkgEngines()}; running ${process.version}`,
  );
});

test("runtimeRequirementError accepts an explicit version", () => {
  // A 25.x runtime satisfies >=24, whatever runs the tests.
  assert.equal(runtimeRequirementError("v25.1.0"), null);
});

test("pathWithRuntimeFirst puts the runtime's dir first", () => {
  const pathValue = pathWithRuntimeFirst("/usr/bin:/bin", "/opt/node24/bin/node");
  assert.equal(pathValue, "/opt/node24/bin:/usr/bin:/bin");
});

test("pathWithRuntimeFirst does not duplicate its own dir", () => {
  const pathValue = pathWithRuntimeFirst("/opt/node24/bin:/usr/bin", "/opt/node24/bin/node");
  assert.equal(pathValue, "/opt/node24/bin:/usr/bin");
});

test("pathWithRuntimeFirst works with an empty or missing PATH", () => {
  assert.equal(pathWithRuntimeFirst("", "/opt/node24/bin/node"), "/opt/node24/bin");
  assert.equal(pathWithRuntimeFirst(undefined ?? "", "/opt/node24/bin/node"), "/opt/node24/bin");
});