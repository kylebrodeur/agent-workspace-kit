// Tests for lib/layout.mjs: the Zellij layout generator. The layout is a
// pure string over (root, binPath, roles, config): deterministic, no
// process spawned, no real agent launched.
import assert from "node:assert/strict";
import test from "node:test";

import { renderLayout } from "../lib/layout.mjs";

const CONFIG = {
  version: 1,
  team: { name: "demo", group: "demo" },
  hub: { role: "planner", mode: "designated" },
  roles: {
    planner: { profile: ".pi-link/profiles/planner.md", role: "Coordinator" },
    builder: { profile: ".pi-link/profiles/builder.md" },
  },
};

const ROOT = "/repo";
const BIN = "/repo/node_modules/.bin/teamctl.mjs";

test("a single role renders one pane with no wrapper", () => {
  const kdl = renderLayout(ROOT, BIN, { roles: ["builder"], config: CONFIG });
  const expected = [
    "layout {",
    `        pane name="builder" command="node" cwd="${ROOT}" {`,
    `            args "${BIN}" "run" "builder"`,
    "        }",
    "}",
    "",
  ].join("\n");
  assert.equal(kdl, expected);
});

test("several roles render inside a vertical split", () => {
  const kdl = renderLayout(ROOT, BIN, { roles: ["planner", "builder"], config: CONFIG });
  const lines = kdl.split("\n");
  assert.equal(lines[0], "layout {");
  assert.equal(lines[1], '    pane split_direction="vertical" {');
  assert.match(lines[2], /pane name="planner: Coordinator" command="node"/);
  assert.match(lines[3], /args ".*" "run" "planner"/);
  assert.equal(lines[4], "        }");
  assert.match(lines[5], /pane name="builder" command="node"/);
  assert.match(lines[6], /args ".*" "run" "builder"/);
  assert.equal(lines[7], "        }");
  assert.equal(lines[8], "    }");
  assert.equal(lines[9], "}");
});

test("the hub role's pane carries focus, and only the hub does", () => {
  const kdl = renderLayout(ROOT, BIN, { roles: ["planner", "builder"], config: CONFIG });
  assert.match(kdl, /pane name="planner: Coordinator"[^\n]*focus=true/);
  const builderPane = kdl.split("\n").find((l) => l.includes('pane name="builder"'));
  assert.ok(!builderPane.includes("focus"), builderPane);
});

test("pane names carry the manifest's role title when declared, else the key", () => {
  const kdl = renderLayout(ROOT, BIN, { roles: ["planner", "builder"], config: CONFIG });
  assert.match(kdl, /name="planner: Coordinator"/);
  assert.match(kdl, /name="builder"/);
});

test("selection order is preserved in the layout", () => {
  const kdl = renderLayout(ROOT, BIN, { roles: ["builder", "planner"], config: CONFIG });
  const plannerAt = kdl.indexOf("run\" \"planner");
  const builderAt = kdl.indexOf("run\" \"builder");
  assert.ok(builderAt < plannerAt, `builder should come first:\n${kdl}`);
});

test("output is deterministic across calls", () => {
  const a = renderLayout(ROOT, BIN, { roles: ["planner", "builder"], config: CONFIG });
  const b = renderLayout(ROOT, BIN, { roles: ["planner", "builder"], config: CONFIG });
  assert.equal(a, b);
});

test("the bin path is absolute in the args", () => {
  const kdl = renderLayout("/repo", "bin/teamctl.mjs", { roles: ["builder"], config: CONFIG });
  assert.match(kdl, /args "\/repo\/bin\/teamctl\.mjs"/);
});