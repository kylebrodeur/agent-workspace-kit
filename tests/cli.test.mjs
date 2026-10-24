// Tests for lib/cli.mjs mode dispatch: check, layout, run, start.
//
// start is exercised against a fake `zellij` on a stub PATH that records
// its argv, so the tests prove the real invocation shape without a
// multiplexer (and without launching any agent).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";

import { spawnSync } from "node:child_process";

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
    hub: { role: "planner", mode: "designated", port: 19777 },
    roles: {
      planner: { profile: ".pi-link/profiles/planner.md", cwd: "." },
      builder: { profile: ".pi-link/profiles/builder.md", cwd: "." },
    },
  };
}

async function validWorld(update = null) {
  const { root, cleanup } = await sandbox("ok");
  const manifest = validManifest();
  if (update) update(manifest);
  await put(root, ".pi-link/team.json", manifest);
  await put(root, ".pi-link/profiles/planner.md", "---\nname: planner\n---\nYou coordinate.\n");
  await put(root, ".pi-link/profiles/builder.md", "---\nname: builder\n---\nYou build.\n");
  return { root, cleanup };
}

async function brokenWorld() {
  const { root, cleanup } = await sandbox("bad");
  await put(root, ".pi-link/team.json", {
    version: 1,
    team: { name: "demo", group: "demo" },
    hub: { role: "ghost", mode: "designated", port: 19778 },
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
    // Every pane command is the EXACT absolute node running teamctl,
    // never the bare `node` (the wrong-runtime trap).
    assert.ok(!layout.includes('command="node"'), layout);
    assert.ok(layout.includes(`command="${process.execPath}"`), layout);
  } finally {
    process.env.PATH = realPath;
    delete process.env.FAKE_ZELLIJ_LOG;
    cleanup();
  }
});

test("start puts the runtime dir first on zellij's PATH", async () => {
  const { root, cleanup } = await validWorld();
  await installFakeZellij(root);
  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${join(root, "bin")}:/usr/bin:${realPath}`;
    process.env.CALLS_ENV_LOG = join(root, "zellij-env.log");
    const code = main(["start", "--root", root]);
    assert.equal(code, 0);
    const pathLines = await envLog(root);
    assert.ok(pathLines.length > 0, "the fake zellij must have run");
    const runtimeDir = dirname(process.execPath);
    for (const line of pathLines) {
      assert.ok(line.startsWith(`PATH=${runtimeDir}:`), line);
    }
  } finally {
    process.env.PATH = realPath;
    delete process.env.CALLS_LOG;
    delete process.env.CALLS_ENV_LOG;
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
    assert.equal(plannerGone, false, "planner's session must survive a --fresh=builder");
    // The fresh reset deletes builder's dir (history gone); start's
    // prompt regeneration may then recreate it holding ONLY the fresh
    // prompt, never the old .keep history.
    const { readdir } = await import("node:fs/promises");
    const builderEntries = await readdir(join(root, ".agent-workspace/sessions/builder")).then(
      (entries) => entries,
      () => null,
    );
    assert.ok(
      builderEntries === null || (builderEntries.length === 1 && builderEntries[0] === "system-prompt.md"),
      JSON.stringify(builderEntries),
    );
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
      'echo "PATH=$PATH" >> "$CALLS_ENV_LOG"\n' +
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

// Reads the fake zellij's env log: one PATH=<value> line per invocation,
// in call order.
async function envLog(root) {
  const text = await readFile(join(root, "zellij-env.log"), "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.startsWith("PATH="));
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

// ── hub roster in start and check ─────────────────────────────────────

// A fake pi-link status server on 127.0.0.1:<port>: a real listener the
// CLI's fetch hits. No agent; status payloads only. The manifest under
// test carries hub.port pointing at it.

// The fake hub must answer from its OWN process: the CLI's probe is a
// spawnSync child, and an in-test-process server would deadlock (the
// parent's event loop is blocked while the probe child waits for a
// response the blocked process cannot write).
const HUB_SERVER_SOURCE = `
const [port, payloadJson, status] = process.argv.slice(1);
const http = require("node:http");
const server = http.createServer((req, res) => {
  res.writeHead(Number(status ?? 200), { "content-type": "application/json" });
  res.end(payloadJson);
});
server.listen(Number(port), "127.0.0.1", () => process.stdout.write("listening"));
`;

async function installFakeHub(root, port, payload, { status = 200 } = {}) {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", HUB_SERVER_SOURCE, String(port), JSON.stringify(payload), String(status)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fake hub did not start")), 3000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      const message = String(chunk);
      clearTimeout(timer);
      reject(new Error(`fake hub failed: ${message}`));
    });
  });
  return { port, stop: () => child.kill("SIGTERM") };
}

const REAL_ROSTER = {
  team: "demo",
  sinceSeconds: 2,
  terminals: [
    { name: "planner@demo", status: "idle" },
    { name: "builder@demo", status: "thinking" },
  ],
};

test("start prints the hub line and refuses a different team's hub", async () => {
  // This team is name demo/group demo. A hub carrying another team's
  // terminals must stop the launch before any write.
  const { root, cleanup } = await validWorld((m) => { m.hub.port = 19841; });
  const hub = await installFakeHub(root, 19841, {
    team: "other",
    terminals: [{ name: "advisor@folia", status: "idle" }],
  });
  await installFakeZellij(root);
  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${join(root, "bin")}:${realPath}`;
    const cap = capture();
    cap.install();
    const code = main(["start", "--root", root]);
    cap.restore();
    assert.equal(code, 1);
    assert.match(
      cap.err.join(""),
      /error: port 19841 is a different hub: advisor@folia; stop that session or move this team to its own hub/,
    );
    // The layout was never written: no .agent-workspace dir at all.
    const layoutExists = await readFile(join(root, ".agent-workspace", "demo.kdl")).then(
      () => true,
      () => false,
    );
    assert.equal(layoutExists, false, "no layout before the hub check passes");
  } finally {
    hub.stop();
    process.env.PATH = realPath;
    delete process.env.CALLS_LOG;
    cleanup();
  }
});

test("start stops with one terminal name line per peer when the hub is ours", async () => {
  const { root, cleanup } = await validWorld((m) => { m.hub.port = 19842; });
  const hub = await installFakeHub(root, 19842, REAL_ROSTER);
  await installFakeZellij(root);
  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${join(root, "bin")}:${realPath}`;
    const cap = capture();
    cap.install();
    const code = main(["start", "--root", root]);
    cap.restore();
    assert.equal(code, 0);
    const out = cap.out.join("");
    assert.match(out, /hub: demo \(port 19842\)/);
    assert.match(out, /planner@demo/);
    assert.match(out, /builder@demo/);
  } finally {
    hub.stop();
    process.env.PATH = realPath;
    delete process.env.CALLS_LOG;
    cleanup();
  }
});

test("start proceeds when nothing listens on the hub port (no hub yet)", async () => {
  const { root, cleanup } = await validWorld((m) => { m.hub.port = 19843; });
  await installFakeZellij(root);
  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${join(root, "bin")}:${realPath}`;
    const cap = capture();
    cap.install();
    const code = main(["start", "--root", root]);
    cap.restore();
    assert.equal(code, 0);
  } finally {
    process.env.PATH = realPath;
    delete process.env.CALLS_LOG;
    cleanup();
  }
});

test("check reports a hub with a malformed payload as unsupported, read-only", async () => {
  const { root, cleanup } = await validWorld((m) => { m.hub.port = 19844; });
  const hub = await installFakeHub(root, 19844, { hello: "world" });
  try {
    const cap = capture();
    cap.install();
    const code = main(["check", "--root", root]);
    cap.restore();
    assert.equal(code, 0);
    assert.match(cap.out.join(""), /hub: unsupported status payload/);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(root, { recursive: true });
    const unexpected = entries.filter((e) => e.includes("agent-workspace"));
    assert.deepEqual(unexpected, []);
  } finally {
    hub.stop();
    cleanup();
  }
});

test("check prints the roster when the hub answers", async () => {
  const { root, cleanup } = await validWorld((m) => { m.hub.port = 19845; });
  const hub = await installFakeHub(root, 19845, REAL_ROSTER);
  try {
    const cap = capture();
    cap.install();
    const code = main(["check", "--root", root]);
    cap.restore();
    const out = cap.out.join("");
    assert.equal(code, 0);
    assert.match(out, /hub: demo \(port 19845\)/);
    assert.match(out, /planner@demo/);
  } finally {
    hub.stop();
    cleanup();
  }
});

test("check exits 0 and prints no hub lines when no hub is on the port", async () => {
  const { root, cleanup } = await validWorld((m) => { m.hub.port = 19846; });
  try {
    const cap = capture();
    cap.install();
    const code = main(["check", "--root", root]);
    cap.restore();
    assert.equal(code, 0);
    assert.ok(!cap.out.join("").includes("hub:"), cap.out.join(""));
  } finally {
    cleanup();
  }
});

// ── worktrees: start creates them; run uses and fails closed ─────────

const WT_MANIFEST = () => {
  const base = validManifest();
  const { cwd, ...builderNoCwd } = base.roles.builder;
  return {
    ...base,
    roles: {
      ...base.roles,
      builder: {
        ...builderNoCwd,
        worktree: { path: "worktrees/builder", branch: "lane/builder" },
      },
    },
  };
};

test("start creates a declared role worktree before writing the layout", async () => {
  const { root, cleanup } = await validWorld((m) => {
    m.roles.builder.worktree = { path: "worktrees/builder", branch: "lane/builder" };
    delete m.roles.builder.cwd;
  });
  await installFakeZellij(root);
  const realPath = process.env.PATH;
  const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  try {
    process.env.PATH = `${join(root, "bin")}:${realPath}`;
    git("init", "-q");
    git("config", "user.email", "team@example.invalid");
    git("config", "user.name", "team");
    git("add", "-A");
    git("commit", "--allow-empty", "-qm", "root");
    const code = main(["start", "--root", root]);
    assert.equal(code, 0);
    const wt = git("worktree", "list", "--porcelain").stdout;
    assert.ok(wt.includes("worktrees/builder"), wt);
    const head = git("-C", join(root, "worktrees/builder"), "rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
    assert.equal(head, "lane/builder");
    // The lane's argv carries the worktree as cwd (read the generated layout).
    const kdl = await readFile(join(root, ".agent-workspace", "demo.kdl"), "utf8");
    assert.ok(kdl.includes(`cwd="${join(root, "worktrees/builder")}"`), kdl);
  } finally {
    process.env.PATH = realPath;
    delete process.env.CALLS_LOG;
    cleanup();
  }
});

test("start refuses a worktree path that is a plain dir (never destroys it)", async () => {
  const { root, cleanup } = await validWorld((m) => {
    m.roles.builder.worktree = { path: "worktrees/builder", branch: "lane/builder" };
    delete m.roles.builder.cwd;
  });
  await installFakeZellij(root);
  await put(root, "worktrees/builder/junk.txt", "operator file\n");
  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${join(root, "bin")}:${realPath}`;
    const cap = capture();
    cap.install();
    const code = main(["start", "--root", root]);
    cap.restore();
    assert.equal(code, 1);
    assert.match(cap.err.join(""), /not a git worktree/);
    const junk = await readFile(join(root, "worktrees/builder/junk.txt"), "utf8");
    assert.equal(junk, "operator file\n");
  } finally {
    process.env.PATH = realPath;
    delete process.env.CALLS_LOG;
    cleanup();
  }
});

test("the worktree lane prompt names explicit-pathspec commits", async () => {
  const { buildPromptFile } = await import("../lib/terminal.mjs");
  const { root, cleanup } = await sandbox("wtprompt");
  try {
    await put(root, ".pi-link/team.json", WT_MANIFEST());
    await put(root, ".pi-link/profiles/builder.md", "---\nname: builder\n---\nYou build.\n");
    const config = WT_MANIFEST();
    const promptPath = buildPromptFile(root, config, "builder");
    const body = await readFile(promptPath, "utf8");
    assert.match(body, /You build\./);
    assert.match(body, /git commit -- /);
  } finally {
    cleanup();
  }
});

// ── mode tests + prompt regeneration on start ────────────────────────

test("tests mode takes the lock and runs its command", async () => {
  const { root, cleanup } = await validWorld();
  try {
    const cap = capture();
    cap.install();
    const code = await main(["tests", "--root", root, "sh", "-c", "echo ran-under-lock"]);
    cap.restore();
    assert.equal(code, 0);
    // The command runs with stdio inherit (the raw fd, not the swapped
    // writer), so only the exit code is asserted here; the serialization
    // test proves the wait actually happened.
  } finally {
    cleanup();
  }
});

test("a second tests invocation waits for the first to release (real serialization)", async () => {
  const { root, cleanup } = await validWorld();
  const { spawn } = await import("node:child_process");
  const marker = join(root, "first-done.flag");
  // First: a 1.5s holder that writes the marker before its last ms. The
  // CLI's own lock is taken by the CHILD process (real pid, real lock).
  const child = spawn(process.execPath, [join(root, "holder.mjs")], {
    cwd: root,
    env: { ...process.env },
  });
  await put(
    root,
    "holder.mjs",
    "import { mkdirSync, writeFileSync } from 'node:fs';\n" +
    "mkdirSync('.agent-workspace', { recursive: true });\n" +
    "writeFileSync('.agent-workspace/tests.lock', JSON.stringify({ pid: process.pid, startedAt: Date.now() }));\n" +
    "setTimeout(() => { writeFileSync('%s', ''); process.exit(0); }, 1500);\n".replace("%s", marker),
  );
  try {
    const started = Date.now();
    const cap = capture();
    cap.install();
    const code = await main(["tests", "--root", root, "--wait-seconds", "10", "sh", "-c", `until [ -f ${marker} ]; do sleep 0.05; done; echo after-first`]);
    cap.restore();
    assert.equal(code, 0);
    const waited = Date.now() - started;
    assert.ok(waited >= 1200, `the second run must wait out the holder: ${waited}ms`);
  } finally {
    child.kill("SIGTERM");
    cleanup();
  }
});

test("tests fails with the exact error when the wait expires", async () => {
  const { root, cleanup } = await validWorld();
  try {
    // A LIVE foreign holder: this test process is alive, so write its pid.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, ".agent-workspace"), { recursive: true });
    await (await import("node:fs/promises")).writeFile(
      join(root, ".agent-workspace", "tests.lock"),
      JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
    );
    const cap = capture();
    cap.install();
    const code = await main(["tests", "--root", root, "--wait-seconds", "0", "echo", "no"]);
    cap.restore();
    assert.equal(code, 1);
    assert.match(
      cap.err.join(""),
      /error: tests lock held by another run: .*tests\.lock \(waited 0s\)/,
    );
  } finally {
    cleanup();
  }
});

test("TEST_WAIT_SECONDS overrides the default wait", async () => {
  const { root, cleanup } = await validWorld();
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(root, ".agent-workspace"), { recursive: true });
    await writeFile(join(root, ".agent-workspace", "tests.lock"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    process.env.TEST_WAIT_SECONDS = "0";
    const cap = capture();
    cap.install();
    const code = await main(["tests", "--root", root, "echo", "no"]);
    cap.restore();
    delete process.env.TEST_WAIT_SECONDS;
    assert.equal(code, 1);
    assert.match(cap.err.join(""), /\(waited 0s\)/);
  } finally {
    delete process.env.TEST_WAIT_SECONDS;
    cleanup();
  }
});

test("start regenerates each selected role's prompt file", async () => {
  const { root, cleanup } = await validWorld();
  await installFakeZellij(root);
  const realPath = process.env.PATH;
  try {
    process.env.PATH = `${join(root, "bin")}:${realPath}`;
    // A STALE prompt on disk (from an older profile) must be overwritten
    // by the current profile body on start.
    await put(root, ".agent-workspace/sessions/planner/system-prompt.md", "STALE PROMPT\n");
    const code = main(["start", "--root", root]);
    assert.equal(code, 0);
    const plannerPrompt = await readFile(join(root, ".agent-workspace/sessions/planner/system-prompt.md"), "utf8");
    assert.match(plannerPrompt, /You coordinate\./);
    assert.ok(!plannerPrompt.includes("STALE PROMPT"));
    const builderPrompt = await readFile(join(root, ".agent-workspace/sessions/builder/system-prompt.md"), "utf8");
    assert.match(builderPrompt, /You build\./);
  } finally {
    process.env.PATH = realPath;
    delete process.env.CALLS_LOG;
    cleanup();
  }
});
