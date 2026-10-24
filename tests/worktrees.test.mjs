// Tests for lib/worktrees.mjs: per-declared-lane git worktrees, created
// by `teamctl start`.
//
// These tests run REAL git binaries against a REAL scratch repo (the
// worktree contract is git's own; a fake would prove nothing). No agent,
// no network: git init in a mktemp dir is the whole fixture.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorktrees } from "../lib/worktrees.mjs";

async function gitRepo() {
  const root = await mkdtemp(join(tmpdir(), "awt-wt-"));
  const run = (args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result;
  };
  run(["init", "-q"]);
  run(["config", "user.email", "team@example.invalid"]);
  run(["config", "user.name", "team"]);
  run(["commit", "--allow-empty", "-qm", "root"]);
  return { root, run, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function runGit(root) {
  return (args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
}

const CONFIG = {
  version: 1,
  team: { name: "demo", group: "demo" },
  hub: { role: "planner", mode: "designated" },
  roles: {
    planner: { profile: ".pi-link/profiles/planner.md", cwd: "." },
    builder: {
      profile: ".pi-link/profiles/builder.md",
      worktree: { path: "worktrees/builder", branch: "lane/builder" },
    },
    reviewer: {
      profile: ".pi-link/profiles/reviewer.md",
      worktree: { path: "worktrees/reviewer", branch: "lane/reviewer" },
    },
  },
};

test("ensureWorktrees creates a new worktree with a new branch", async () => {
  const { root, run, cleanup } = await gitRepo();
  try {
    const results = ensureWorktrees(root, CONFIG, ["builder"], { runGit: runGit(root) });
    assert.deepEqual(results, [{ roleKey: "builder", path: join(root, "worktrees/builder"), branch: "lane/builder", created: true }]);
    const wt = run(["worktree", "list", "--porcelain"]).stdout;
    assert.ok(wt.includes("worktrees/builder"), wt);
    const branchHead = run(["rev-parse", "--abbrev-ref", "lane/builder"]).stdout.trim();
    assert.equal(branchHead, "lane/builder");
  } finally {
    cleanup();
  }
});

test("ensureWorktrees reuses an existing worktree whose branch matches", async () => {
  const { root, run, cleanup } = await gitRepo();
  try {
    ensureWorktrees(root, CONFIG, ["builder"], { runGit: runGit(root) });
    // A second pass over the SAME declaration reuses, never re-adds.
    const results = ensureWorktrees(root, CONFIG, ["builder"], { runGit: runGit(root) });
    assert.equal(results[0].created, false);
    const wtList = run(["worktree", "list", "--porcelain"]).stdout;
    assert.equal(wtList.split("worktrees/builder").length - 1, 1, wtList);
  } finally {
    cleanup();
  }
});

test("ensureWorktrees adds an existing branch to a new worktree path", async () => {
  const { root, run, cleanup } = await gitRepo();
  try {
    run(["branch", "lane/reviewer", "HEAD"]);
    const results = ensureWorktrees(root, CONFIG, ["reviewer"], { runGit: runGit(root) });
    assert.deepEqual(
      results.map((r) => ({ branch: r.branch, created: r.created })),
      [{ branch: "lane/reviewer", created: true }],
    );
    assert.ok(run(["rev-parse", "--verify", "lane/reviewer"]).status === 0);
  } finally {
    cleanup();
  }
});

test("a role with no worktree declaration is skipped", async () => {
  const { root, run, cleanup } = await gitRepo();
  try {
    const results = ensureWorktrees(root, CONFIG, ["planner", "builder"], { runGit: runGit(root) });
    assert.deepEqual(results.map((r) => r.roleKey), ["builder"]);
  } finally {
    cleanup();
  }
});

test("a non-worktree path where the worktree should go is an error", async () => {
  const { root, cleanup } = await gitRepo();
  try {
    await mkdir(join(root, "worktrees/builder"), { recursive: true });
    await writeFile(join(root, "worktrees/builder/junk.txt"), "a plain dir\n");
    assert.throws(
      () => ensureWorktrees(root, CONFIG, ["builder"], { runGit: runGit(root) }),
      (error) => error.message.includes("worktrees/builder") && error.message.includes("not a git worktree"),
    );
  } finally {
    cleanup();
  }
});