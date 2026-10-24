// The crash guard: the proven restart-loop safety net, generalized
// (generalization item 4).
//
// The loop it protects: a role's terminal runner restarts its agent when
// the agent exits, honoring the .stop and .reset sentinels. Without a
// guard, a misconfigured role (a missing binary, a bad flag, a broken
// config) crashes in a tight loop forever, burning CPU and filling logs.
//
// The measured behavior: a run shorter than 3 seconds is a crash; 5
// crashes inside one 60 second window stops the restart loop. A run at or
// over the floor resets the count and the window (the agent ran, it did
// not crash). These constants are the default and are NOT manifest data:
// a restart policy is code, not a per-team preference.
export const RUN_FLOOR_MS = 3000;
export const MAX_CRASHES = 5;
export const WINDOW_MS = 60000;

export function CRASH_GUARD_MESSAGE(role, count, windowSeconds) {
  return (
    `crash guard triggered for ${role}: ${count} restarts under ${RUN_FLOOR_MS / 1000}s ` +
    `inside a ${windowSeconds}s window; stopping the restart loop`
  );
}

// record(elapsedMs) -> "ok" | "trip". `elapsedMs` is the run's wall time
// immediately before the restart decision. The clock is injectable so the
// guard is testable without sleeping.
export class CrashGuard {
  constructor({ runFloorMs = RUN_FLOOR_MS, maxCrashes = MAX_CRASHES, windowMs = WINDOW_MS, now = Date.now } = {}) {
    this.runFloorMs = runFloorMs;
    this.maxCrashes = maxCrashes;
    this.windowMs = windowMs;
    this.now = now;
    this.crashCount = 0;
    this.windowStart = now();
  }

  record(elapsedMs) {
    if (elapsedMs >= this.runFloorMs) {
      // A real run: the agent worked. Reset the crash accounting.
      this.crashCount = 0;
      this.windowStart = this.now();
      return "ok";
    }
    if (this.now() - this.windowStart > this.windowMs) {
      // The window aged out; old crashes no longer count.
      this.crashCount = 0;
      this.windowStart = this.now();
    }
    this.crashCount += 1;
    if (this.crashCount >= this.maxCrashes) {
      return "trip";
    }
    return "ok";
  }
}