// Tests for lib/cli.mjs mode dispatch: check, layout, run, start.
//
// start is exercised against a fake `zellij` on a stub PATH that records
// its argv, so the tests prove the real invocation shape without a
// multiplexer (and without launching any agent).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../lib/cli.mjs";

async function sandbox(name) {
  const root = await mkdtemp(join(tmpdir(), `awt-cli-${name}-`));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function put(root, rel, body) {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n");
}

function validManifest() {
  return {
    version: 1,
    team: { name: "demo", group: "demo" },
    hub: { role: "planner", mode: "designated" },
    roles: {
      planner: { profile: ".pi-link/profiles/planner.md", cwd: "." },
      builder: { profile: ".pi-link/profiles/builder.md", cwd: "." },
    },
  };
}

async function validWorld() {
  const { root, cleanup } = await sandbox("ok");
  await put(root, ".pi-link/team.json", validManifest());
  await put(root, ".pi-link/profiles/planner.md", "---\nname: planner\n---\nYou coordinate.\n");
  await put(root, ".pi-link/profiles/builder.md", "---\nname: builder\n---\nYou build.\n");
  return { root, cleanup };
}

async function brokenWorld() {
  const { root, cleanup } = await sandbox("bad");
  await put(root, ".pi-link/team.json", {
    version: 1,
    team: { name: "demo", group: "demo" },
    hub: { role: "ghost", mode: "designated" },
    roles: {
      planner: { profile: ".pi-link/profiles/planner.md", cwd: "." },
    },
  });
  await put(root, ".pi-link/profiles/planner.md", "---\nname: planner\n---\n");
  return { root, cleanup };
}

// Capture stdout/stderr by swapping the stream writers the CLI uses.
function capture() {
  const out = [];
  const err = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  return {
    out,
    err,
    install() {
      process.stdout.write = (chunk) => (out.push(String(chunk)), true);
      process.stderr.write = (chunk) => (err.push(String(chunk)), true);
    },
    restore() {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    },
  };
}

test("check on a valid manifest exits 0 and reports the team", async () => {
  const { root, cleanup } = await validWorld();
  const cap = capture();
  try {
    cap.install();
    const code = main(["check", "--root", root]);
    cap.restore();
    assert.equal(code, 0);
    assert.match(cap.out.join(""), /Team manifest valid: 2 roles, hub planner/);
  } finally {
    cap.restore();
    cleanup();
  }
});

test("check on a broken manifest exits 1 and prints each error", async () => {
  const { root, cleanup } = await brokenWorld();
  const cap = capture();
  try {
    cap.install();
    const code = main(["check", "--root", root]);
    cap.restore();
    assert.equal(code, 1);
    const errText = cap.err.join("");
    assert.match(errText, /hub\.role "ghost" does not name a configured role/);
  } finally {
    cap.restore();
    cleanup();
  }
});

test("check --json prints one JSON object with ok, errors, warnings", async () => {
  const { root, cleanup } = await validWorld();
  const cap = capture();
  try {
    cap.install();
    const code = main(["check", "--root", root, "--json"]);
    cap.restore();
    assert.equal(code, 0);
    const parsed = JSON.parse(cap.out.join(""));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.errors, []);
    assert.ok(Array.isArray(parsed.warnings));
  } finally {
    cap.restore();
    cleanup();
  }
});

test("check never writes anything to the repo", async () => {
  const { root, cleanup } = await validWorld();
  const cap = capture();
  try {
    cap.install();
    main(["check", "--root", root]);
    cap.restore();
    // Only the three seeded files should exist (plus the sandbox itself).
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(root, { recursive: true });
    const unexpected = entries.filter(
      (e) =>
        !e.startsWith(".pi-link") &&
        !e.endsWith("planner.md") &&
        !e.endsWith("builder.md"),
    );
    assert.deepEqual(unexpected, []);
  } finally {
    cap.restore();
    cleanup();
  }
});

test("unknown mode exits 64 with usage on stderr", () => {
  const cap = capture();
  try {
    cap.install();
    const code = main(["bogus"]);
    cap.restore();
    assert.equal(code, 64);
    assert.match(cap.err.join(""), /usage: teamctl/);
  } finally {
    cap.restore();
  }
});

test("layout prints the KDL for all roles by default", async () => {
  const { root, cleanup } = await validWorld();
  const cap = capture();
  try {
    cap.install();
    const code = main(["layout", "--root", root]);
    cap.restore();
    assert.equal(code, 0);
    const kdl = cap.out.join("");
    assert.match(kdl, /layout \{/);
    assert.match(kdl, /run" "planner/);
    assert.match(kdl, /run" "builder/);
  } finally {
    cap.restore();
    cleanup();
  }
});

test("layout --roles selects roles; --out writes the file and prints nothing", async () => {
  const { root, cleanup } = await validWorld();
  const cap = capture();
  const outFile = join(root, "team.kdl");
  try {
    cap.install();
    const code = main(["layout", "--root", root, "--roles", "builder", "--out", outFile]);
    cap.restore();
    assert.equal(code, 0);
    const written = await readFile(outFile, "utf8");
    assert.match(written, /run" "builder/);
    assert.ok(!written.includes("planner"));
    assert.deepEqual(cap.out, []);
  } finally {
    cap.restore();
    cleanup();
  }
});

test("start with a valid manifest invokes zellij with the generated layout", async () => {
  const { root, cleanup } = await validWorld();
  const binDir = join(root, "fakebin");
  await mkdir(binDir, { recursive: true });
  const zellijPath = join(binDir, "zellij");
  await writeFile(zellijPath, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$FAKE_ZELLIJ_LOG\"\n");
  const { chmod } = await import("node:fs/promises");
  await chmod(zellijPath, 0o755);
  const logPath = join(root, "zellij-argv.log");

  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${binDir}:${realPath}`;
    process.env.FAKE_ZELLIJ_LOG = logPath;
    const code = main(["start", "--root", root]);
    assert.equal(code, 0);
    const argvLog = await readFile(logPath, "utf8");
    const argvLines = argvLog.trim().split("\n");
    // zellij --layout <file> attach --create <team>
    assert.equal(argvLines[0], "--layout");
    assert.match(argvLines[1], /\.kdl$/);
    assert.equal(argvLines[2], "attach");
    assert.equal(argvLines[3], "--create");
    assert.equal(argvLines[4], "demo");
    const layout = await readFile(argvLines[1], "utf8");
    assert.match(layout, /run" "planner/);
    assert.match(layout, /run" "builder/);
  } finally {
    process.env.PATH = realPath;
    delete process.env.FAKE_ZELLIJ_LOG;
    cleanup();
  }
});

test("start with a broken manifest exits 1 and never invokes zellij", async () => {
  const { root, cleanup } = await brokenWorld();
  const binDir = join(root, "fakebin");
  await mkdir(binDir, { recursive: true });
  const zellijPath = join(binDir, "zellij");
  await writeFile(zellijPath, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$FAKE_ZELLIJ_LOG\"\n");
  const { chmod } = await import("node:fs/promises");
  await chmod(zellijPath, 0o755);
  const logPath = join(root, "zellij-argv.log");

  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${binDir}:${realPath}`;
    process.env.FAKE_ZELLIJ_LOG = logPath;
    const cap = capture();
    cap.install();
    const code = main(["start", "--root", root]);
    cap.restore();
    assert.equal(code, 1);
    assert.match(cap.err.join(""), /team manifest invalid/);
    const logExists = await readFile(logPath, "utf8").then(
      () => true,
      () => false,
    );
    assert.equal(logExists, false, "zellij must not be invoked on a red preflight");
  } finally {
    process.env.PATH = realPath;
    delete process.env.FAKE_ZELLIJ_LOG;
    cleanup();
  }
});

test("start --fresh=builder removes only that role's sessionDir", async () => {
  const { root, cleanup } = await validWorld();
  // Both roles have existing session dirs on disk.
  await put(root, ".agent-workspace/sessions/planner/.keep", "");
  await put(root, ".agent-workspace/sessions/builder/.keep", "");
  const zellijCalls = await installFakeZellij(root);
  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${join(root, "bin")}:${realPath}`;
    const cap = capture();
    cap.install();
    const code = main(["start", "--root", root, "--fresh=builder"]);
    cap.restore();
    assert.equal(code, 0);
    const { access } = await import("node:fs/promises");
    const plannerGone = await access(join(root, ".agent-workspace/sessions/planner")).then(
      () => false,
      () => true,
    );
    const builderGone = await access(join(root, ".agent-workspace/sessions/builder")).then(
      () => false,
      () => true,
    );
    assert.equal(plannerGone, false, "planner's session must survive a --fresh=builder");
    assert.equal(builderGone, true, "builder's session dir must be removed");
    // The fake zellij saw: the team session delete (fresh reset), the list, then the attach.
    const calls = await zellijCalls();
    assert.deepEqual(
      calls.filter((argv) => argv[0] === "delete-session"),
      [["delete-session", "--force", "demo"]],
    );
  } finally {
    process.env.PATH = realPath;
    cleanup();
  }
});

// A fake zellij on a stub PATH: records every argv (first element = the
// mode) into an in-repo log, so tests assert the real invocation shape
// without launching a real multiplexer.
async function installFakeZellij(root, withEmptyLog = false) {
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const logPath = join(root, "zellij-calls.log");
  if (withEmptyLog) await writeFile(logPath, "");
  await writeFile(
    join(binDir, "zellij"),
    '#!/bin/sh\n' +
      'for arg in "$@"; do echo "$arg" >> "$CALLS_LOG"; done\n' +
      'echo "---" >> "$CALLS_LOG"\n' +
      'if [ "$1" = "list-sessions" ]; then echo "demo [Created 0s ago]"; fi\n',
  );
  await chmod(join(binDir, "zellij"), 0o755);
  process.env.CALLS_LOG = logPath;
  const read = async () => {
    const text = await readFile(logPath, "utf8");
    return text
      .split("---\n")
      .filter((block) => block.trim().length > 0)
      .map((block) => block.trim().split("\n"));
  };
  return read;
}

test("start with no zellij on PATH exits 1 with the fix", async () => {
  const { root, cleanup } = await validWorld();
  const realPath = process.env.PATH;
  try {
    process.env.PATH = join(root, "emptybin");
    const cap = capture();
    cap.install();
    const code = main(["start", "--root", root]);
    cap.restore();
    assert.equal(code, 1);
    assert.match(cap.err.join(""), /zellij not found on PATH/);
  } finally {
    process.env.PATH = realPath;
    cleanup();
  }
});