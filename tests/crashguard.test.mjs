// Tests for lib/crashguard.mjs: the proven restart-loop guard.
//
// Proven behavior (generalization item 4): a run that exits too fast is a
// crash; five crashes inside one 60 second window stops the restart loop.
// A run at or over the 3 second floor resets the count and the window.
// The guard is a pure class with an injectable clock, so the tests never
// sleep.
import assert from "node:assert/strict";
import test from "node:test";

import { CRASH_GUARD_MESSAGE, CrashGuard } from "../lib/crashguard.mjs";

function guardAt(startMs) {
  let now = startMs;
  const guard = new CrashGuard({
    now: () => now,
  });
  return {
    guard,
    advance(ms) {
      now += ms;
    },
  };
}

test("a run shorter than the floor counts one crash", () => {
  const { guard } = guardAt(0);
  assert.equal(guard.record(100), "ok");
});

test("five rapid crashes trip the guard", () => {
  const { guard } = guardAt(0);
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "trip");
});

test("the trip message names the role, the count, and the window", () => {
  const message = CRASH_GUARD_MESSAGE("reviewer", 5, 60);
  assert.equal(
    message,
    "crash guard triggered for reviewer: 5 restarts under 3s inside a 60s window; stopping the restart loop",
  );
});

test("a run at the floor resets the counter and the window", () => {
  const { guard } = guardAt(0);
  guard.record(100);
  guard.record(100);
  guard.record(100);
  guard.record(100);
  // A long healthy run advances the clock past the floor AND is recorded.
  assert.equal(guard.record(3000), "ok");
  // After the reset, four more rapid crashes still do not trip...
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  // ...until the fifth.
  assert.equal(guard.record(100), "trip");
});

test("crashes older than the window age out before counting", () => {
  const { guard, advance } = guardAt(0);
  guard.record(100);
  guard.record(100);
  guard.record(100);
  guard.record(100);
  // The window (60s) elapses; the four old crashes no longer count.
  advance(61000);
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "trip");
});

test("exactly the floor is not a crash (a 3s run is healthy)", () => {
  const { guard } = guardAt(0);
  assert.equal(guard.record(3000), "ok");
  // Four sub-floor runs after the reset: four crashes, not five, no trip.
  assert.equal(guard.record(2999), "ok");
  assert.equal(guard.record(2999), "ok");
  assert.equal(guard.record(2999), "ok");
  assert.equal(guard.record(100), "ok");
  assert.equal(guard.record(100), "trip");
});

test("a trip keeps tripping while rapid crashes continue", () => {
  const { guard } = guardAt(0);
  for (let i = 0; i < 5; i++) guard.record(100);
  assert.equal(guard.record(100), "trip");
  assert.equal(guard.record(100), "trip");
});