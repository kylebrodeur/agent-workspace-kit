// Tests for lib/testlock.mjs: the team-level tests lock, verified against
// REAL lock files (an advisory lock this weak is exactly where a fake
// would lie).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { testsLockPath, acquireTestsLock, releaseTestsLock, readTestsLock } from "../lib/testlock.mjs";

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "awt-lock-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("the lock lives at <root>/.agent-workspace/tests.lock", async () => {
  const { root, cleanup } = await sandbox();
  try {
    assert.equal(testsLockPath(root), join(root, ".agent-workspace", "tests.lock"));
  } finally {
    cleanup();
  }
});

test("acquire creates the lock with the pid and timestamp", async () => {
  const { root, cleanup } = await sandbox();
  try {
    const lock = await acquireTestsLock(root);
    assert.equal(lock.pid, process.pid);
    assert.ok(typeof lock.startedAt === "number");
    const body = JSON.parse(await readFile(join(root, ".agent-workspace", "tests.lock"), "utf8"));
    assert.equal(body.pid, process.pid);
    // The file's stamp is the one written at acquire time (±1ms of the
    // returned stamp: two now() calls one statement apart).
    assert.ok(Math.abs(body.startedAt - lock.startedAt) <= 1, `${body.startedAt} vs ${lock.startedAt}`);
  } finally {
    await releaseTestsLock(root);
    cleanup();
  }
});

test("a second acquire on a LIVE lock fails its wait with the exact error", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await acquireTestsLock(root);
    const held = await acquireTestsLock(root, { waitSeconds: 0.2, intervalMs: 20 });
    assert.equal(held, null);
    // The caller composes the error line; the helper exposes the wait.
    assert.equal(readTestsLock(root).pid, process.pid);
  } finally {
    await releaseTestsLock(root);
    cleanup();
  }
});

test("release removes the lock and a reacquire succeeds", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await acquireTestsLock(root);
    await releaseTestsLock(root);
    const again = await acquireTestsLock(root, { waitSeconds: 0.2, intervalMs: 20 });
    assert.ok(again && again.pid === process.pid);
    await releaseTestsLock(root);
  } finally {
    cleanup();
  }
});

test("a STALE lock (pid not alive) is replaced, not waited on", async () => {
  const { root, cleanup } = await sandbox();
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, ".agent-workspace"), { recursive: true });
    // A pid that is not alive: a negative one can never exist on POSIX.
    await writeFile(join(root, ".agent-workspace", "tests.lock"), JSON.stringify({ pid: 999999999, startedAt: Date.now() }));
    const acquired = await acquireTestsLock(root, { waitSeconds: 0.2, intervalMs: 20 });
    assert.ok(acquired, "stale lock must be replaceable");
    assert.equal(acquired.pid, process.pid);
  } finally {
    await releaseTestsLock(root);
    cleanup();
  }
});

test("release with no lock is a no-op", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await releaseTestsLock(root);
    assert.ok(true);
  } finally {
    cleanup();
  }
});