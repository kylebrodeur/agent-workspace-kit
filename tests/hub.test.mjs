// Tests for lib/hub.mjs: the per-team hub identity and status check.
//
// The hub is a pi-link runtime serving /status on localhost. The kit
// reads it two ways: `teamctl start` refuses to launch when the port is
// occupied by a DIFFERENT hub (foreign terminal names), and `teamctl
// check` reports the roster read-only. The fetch is injected, so no test
// listens on a real port.
import assert from "node:assert/strict";
import test from "node:test";

import { hubPortFromEnvResolvedArgs, hubStatus, resolveHubPort } from "../lib/hub.mjs";

function okFetch(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) });
}

function okFetchText(payload) {
  return async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });
}

const VALID_PAYLOAD = {
  team: "other-team",
  sinceSeconds: 3,
  terminals: [
    { name: "advisor", status: "thinking" },
    { name: "app-ui", status: "idle" },
  ],
};

test("hubStatus returns the validated payload on a 2xx JSON body", async () => {
  const status = await hubStatus(9900, okFetch(VALID_PAYLOAD));
  assert.deepEqual(status, {
    team: "other-team",
    sinceSeconds: 3,
    terminals: [
      { name: "advisor", status: "thinking" },
      { name: "app-ui", status: "idle" },
    ],
  });
});

test("hubStatus accepts a JSON body served as text (content-type drift)", async () => {
  const status = await hubStatus(9900, okFetchText(VALID_PAYLOAD));
  assert.equal(status.team, "other-team");
});

test("hubStatus resolves the port against localhost", async () => {
  let seen = null;
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, status: 200, json: async () => VALID_PAYLOAD };
  };
  await hubStatus(12345, fetchImpl);
  assert.equal(seen, "http://127.0.0.1:12345/status");
});

test("a connection error is null (no hub there; never an exception)", async () => {
  const fetchImpl = async () => {
    const error = new Error("connect ECONNREFUSED");
    error.code = "ECONNREFUSED";
    throw error;
  };
  assert.equal(await hubStatus(9900, fetchImpl), null);
  const fetchImpl2 = async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };
  assert.equal(await hubStatus(9900, fetchImpl2), null);
});

test("any non-2xx is null from start's perspective: no hub it can name", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "nope" });
  assert.equal(await hubStatus(9900, fetchImpl), null);
});

test("statusUnsupported distinguishes a malformed payload from no hub", async () => {
  // start needs to tell "nothing there" from "something that is not a
  // pi-link status payload". hubStatus supports an out-collector.
  const seen = {};
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ hello: 1 }) });
  const status = await hubStatus(9900, fetchImpl, { seen: (kind) => { seen.kind = kind; } });
  assert.equal(status, null);
  assert.equal(seen.kind, "unsupported");
});

test("hubStatus fails closed on a wrong-shape payload", async () => {
  for (const payload of [
    null,
    "hi",
    [],
    { team: 3, terminals: [] },
    { team: "t" },
    { team: "t", terminals: "x" },
    { team: "t", terminals: [{ n: "a" }] },
    { team: "t", terminals: [{ name: 3 }] },
  ]) {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });
    assert.equal(await hubStatus(9900, fetchImpl), null, JSON.stringify(payload));
  }
});

test("hubStatus tolerates missing optional fields but requires the shape", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ terminals: [{ name: "planner" }] }),
  });
  const status = await hubStatus(9900, fetchImpl);
  assert.equal(status.team, null);
  assert.equal(status.sinceSeconds, null);
  assert.deepEqual(status.terminals.map((t) => t.name), ["planner"]);
});

// ── port resolution ───────────────────────────────────────────────────

test("resolveHubPort: manifest hub.port wins over env and default", () => {
  assert.equal(resolveHubPort({ hub: { port: 9920 } }, { PI_LINK_PORT: "9930" }), 9920);
});

test("resolveHubPort: PI_LINK_PORT is second", () => {
  assert.equal(resolveHubPort({}, { PI_LINK_PORT: "9930" }), 9930);
  assert.equal(resolveHubPort({ hub: {} }, { PI_LINK_PORT: "9931" }), 9931);
});

test("resolveHubPort: default 9900 last", () => {
  assert.equal(resolveHubPort({}, {}), 9900);
});

test("resolveHubPort ignores an invalid env port shape", () => {
  assert.equal(resolveHubPort({}, { PI_LINK_PORT: "banana" }), 9900);
  assert.equal(resolveHubPort({}, { PI_LINK_PORT: "70000" }), 9900);
  assert.equal(resolveHubPort({}, { PI_LINK_PORT: "0" }), 9900);
});

test("resolveHubPort fails closed on an invalid manifest hub.port", () => {
  for (const value of [0, -1, 70000, "9920", 3.5]) {
    assert.throws(
      () => resolveHubPort({ hub: { port: value } }, {}),
      (error) => error instanceof Error && error.message === `team.hub.port must be an integer 1-65535, got: ${JSON.stringify(value)}`,
      `${JSON.stringify(value)}`,
    );
  }
});

test("hubPortFromEnvResolvedArgs is the resolved port for terminal checks", () => {
  // The manifest may declare hub.port; the env var never overrides it.
  assert.equal(hubPortFromEnvResolvedArgs({ hub: { port: 9920 } }, { PI_LINK_PORT: "3" }, 9920), 9920);
});