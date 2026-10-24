// Tests for lib/terminal.mjs: the per-role terminal runner's testable
// pieces. No real agent is launched: argv assembly, prompt-file building,
// and the hub wait are pure or injectable.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPromptFile, roleArgv, waitForHub } from "../lib/terminal.mjs";

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "awt-term-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function put(root, rel, body) {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile2(join(root, rel), body);
}

import { writeFile as writeFile2 } from "node:fs/promises";

const ROOT = "/repo";
const CONFIG = {
  version: 1,
  team: { name: "demo", group: "demo" },
  hub: { role: "planner", mode: "designated" },
  roles: {
    planner: {
      profile: ".pi-link/profiles/planner.md",
      model: "example-model-large",
      cwd: "workspaces/planner",
      sessionDir: ".agent-workspace/sessions/planner",
      config: ".pi-link/session.yml",
      linkName: "planner",
      args: ["--no-lsp"],
    },
    builder: {
      profile: ".pi-link/profiles/builder.md",
    },
  },
};

test("roleArgv emits omp with the manifest's launch facts in order", () => {
  const { argv } = roleArgv(ROOT, CONFIG, "planner");
  assert.deepEqual(argv, [
    "omp",
    "--session-dir", join(ROOT, ".agent-workspace/sessions/planner"),
    "--link-name", "planner",
    "--model", "example-model-large",
    "--cwd", join(ROOT, "workspaces/planner"),
    "--system-prompt", "@/repo/.agent-workspace/sessions/planner/system-prompt.md",
    "--config", "/repo/.pi-link/session.yml",
    "--no-lsp",
  ]);
});

test("roleArgv omits facts the manifest does not declare", () => {
  const { argv } = roleArgv(ROOT, CONFIG, "builder");
  assert.deepEqual(argv, [
    "omp",
    "--session-dir", join(ROOT, ".agent-workspace/sessions/builder"),
    "--link-name", "builder",
    "--cwd", ROOT,
    "--system-prompt", "@/repo/.agent-workspace/sessions/builder/system-prompt.md",
  ]);
});

test("roleArgv defaults linkName to the role key when linkName is absent", () => {
  const config = { roles: { reviewer: { profile: "p.md" } } };
  const { argv } = roleArgv("/", config, "reviewer");
  assert.match(argv.join(" "), /--link-name reviewer/);
});

test("roleArgv respects a declared linkName", () => {
  const config = { roles: { reviewer: { profile: "p.md", linkName: "chief" } } };
  const { argv } = roleArgv("/", config, "reviewer");
  assert.match(argv.join(" "), /--link-name chief/);
});

test("buildPromptFile strips the profile's frontmatter and appends the bootstrap", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await put(root, ".pi-link/profiles/planner.md", "---\nname: planner\nmodel: m\n---\nYou coordinate.\n");
    await put(root, ".pi-link/team.json", JSON.stringify({
      version: 1,
      team: { name: "demo", group: "demo" },
      hub: { role: "planner", mode: "designated" },
      roles: {
        planner: {
          profile: ".pi-link/profiles/planner.md",
          cwd: ".",
          sessionDir: ".agent-workspace/sessions/planner",
          firstTurn: "Read scratchpads/planner.md before dispatching.",
        },
      },
    }));
    const promptPath = await buildPromptFile(root, {
      roles: {
        planner: {
          profile: ".pi-link/profiles/planner.md",
          sessionDir: ".agent-workspace/sessions/planner",
          firstTurn: "Read scratchpads/planner.md before dispatching.",
        },
      },
    }, "planner");
    const body = await readFile(promptPath, "utf8");
    assert.equal(body,
      "You coordinate.\n" +
      "\n## First turn bootstrap\n\n" +
      "On your very first turn in a brand-new session, Read scratchpads/planner.md before dispatching. " +
      "Once a conversation is underway, just respond normally.\n");
  } finally {
    cleanup();
  }
});

test("the bootstrap section is omitted when the manifest declares no firstTurn", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await put(root, ".pi-link/profiles/builder.md", "You build.\n");
    await buildPromptFile(root, { roles: { builder: { profile: ".pi-link/profiles/builder.md", sessionDir: ".agent-workspace/sessions/builder" } } }, "builder");
    const body = await readFile(join(root, ".agent-workspace/sessions/builder/system-prompt.md"), "utf8");
    assert.equal(body, "You build.\n");
  } finally {
    cleanup();
  }
});

test("buildPromptFile creates a missing sessionDir (the fresh-checkout normal case)", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await put(root, ".pi-link/profiles/planner.md", "You plan.\n");
    await buildPromptFile(root, { roles: { planner: { profile: ".pi-link/profiles/planner.md", sessionDir: ".agent-workspace/sessions/planner" } } }, "planner");
    const s = await stat(join(root, ".agent-workspace/sessions/planner"));
    assert.ok(s.isDirectory());
  } finally {
    cleanup();
  }
});

test("a role with no sessionDir falls back to .agent-workspace local state", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await put(root, ".pi-link/profiles/builder.md", "You build.\n");
    const promptPath = await buildPromptFile(root, { roles: { builder: { profile: ".pi-link/profiles/builder.md" } } }, "builder");
    assert.equal(promptPath, join(root, ".agent-workspace", "sessions", "builder", "system-prompt.md"));
    const body = await readFile(promptPath, "utf8");
    assert.equal(body, "You build.\n");
  } finally {
    cleanup();
  }
});

test("the manifest's declared prompt file wins over building one", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await put(root, ".pi-link/prompts/planner.md", "The declared prompt.\n");
    const promptPath = await buildPromptFile(root, { roles: { planner: { profile: "p.md", prompt: ".pi-link/prompts/planner.md" } } }, "planner");
    assert.equal(promptPath, join(root, ".pi-link/prompts/planner.md"));
  } finally {
    cleanup();
  }
});

test("waitForHub resolves once a server is listening", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const start = Date.now();
    await waitForHub({ port, waitSeconds: 2 });
    assert.ok(Date.now() - start < 2000, "should not consume the whole deadline");
  } finally {
    server.close();
  }
});

test("waitForHub returns after the deadline when nothing listens (best effort)", async () => {
  const start = Date.now();
  await waitForHub({ port: 1, waitSeconds: 1 });
  assert.ok(Date.now() - start >= 900, "should wait out the deadline");
});

test("waitForHub with waitSeconds 0 skips immediately", async () => {
  const start = Date.now();
  await waitForHub({ port: 1, waitSeconds: 0 });
  assert.ok(Date.now() - start < 500);
});