// The team-level tests lock: two teams (or two agents) must not run full
// test suites against the same machine concurrently (the 2026-10-31
// handoff: load average over 150, several full runs at once, one timed
// out at 300s). One lock per team root; `teamctl tests` is the mode that
// takes it.
//
// The lock is a FILE at <root>/.agent-workspace/tests.lock holding the
// holder pid and the start timestamp:
//
//   - acquire: open(..., "wx") - the exclusive create IS the atomic
//     compare-and-set; no race window, no dependency.
//   - hold: the caller's `finally` releases.
//   - stale: a lock whose pid is not ALIVE is replaced (retried acquire
//     after unlink), because a dead holder can never release.
//   - fail: after the wait deadline the caller gets null and prints the
//     exact error line: error: tests lock held by another run: <path>
//     (waited <N>s)
import { mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export const LOCK_REL = ".agent-workspace/tests.lock";

export function testsLockPath(root) {
  return join(root, ".agent-workspace", "tests.lock");
}

// pidAlive(pid): kill(pid, 0) - signal 0 is the existence probe; EPERM
// (a living process owned by someone else) also means alive.
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// readTestsLock(root) -> { pid, startedAt } | null.
export function readTestsLock(root) {
  const path = testsLockPath(root);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Number.isInteger(parsed?.pid) || !Number.isFinite(parsed?.startedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// acquireTestsLock(root, { waitSeconds = 60, intervalMs = 250, pid =
// process.pid, now = Date.now }) -> lock | null. Null means the wait
// expired with a LIVE holder; the caller prints the error line. A stale
// holder (pid not alive) is replaced the moment it is seen, whatever the
// deadline.
export async function acquireTestsLock(root, { waitSeconds = 60, intervalMs = 250, pid = process.pid, now = Date.now } = {}) {
  const path = testsLockPath(root);
  mkdirSync(join(path, ".."), { recursive: true });
  const deadline = now() + Math.max(0, waitSeconds) * 1000;
  for (;;) {
    // The atomic compare-and-set: wx fails when the file exists.
    let fd;
    try {
      fd = openSync(path, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (fd !== undefined) {
      try {
        writeFileSync(fd, JSON.stringify({ pid, startedAt: now() }));
      } finally {
        closeSync(fd);
      }
      return { pid, startedAt: now() };
    }
    const holder = readTestsLock(root) ?? { pid: NaN, startedAt: NaN };
    if (!pidAlive(holder.pid)) {
      // Stale: the holder cannot release. Replace it. A concurrent
      // replacer may win the wx; the loop simply tries again.
      try {
        rmSync(path, { force: true });
      } catch {
        // lost the replace race; retry
      }
      continue;
    }
    if (now() >= deadline) return null;
    await sleep(Math.min(intervalMs, Math.max(1, deadline - now())));
  }
}

// releaseTestsLock(root): remove the lock only when THE HOLDER IS THIS
// PID (or the lock is unreadable/stale debris); never delete another
// live run's lock.
export async function releaseTestsLock(root, { pid = process.pid } = {}) {
  const path = testsLockPath(root);
  try {
    const holder = readTestsLock(root);
    if (holder && holder.pid !== pid && pidAlive(holder.pid)) {
      return; // someone else's live lock: not ours to remove
    }
    unlinkSync(path);
  } catch {
    // no lock, already gone: releasing is idempotent
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}