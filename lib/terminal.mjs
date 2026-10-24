// The per-role terminal runner: one agent's launch facts, prompt file, and
// restart loop. Generalized from the proven family agent-terminal script
// (generalization items 1 to 4, 8):
//
//   - Every launch fact (session dir, link name, model, cwd, config) is
//     READ from the manifest; this module restates none of them.
//   - The prompt file is built from the role's declared profile (stripped
//     of frontmatter) plus the manifest's firstTurn note. The manifest
//     that can launch prevents the silent drift of a naming convention
//     serving a 19-byte stub instead of the real profile.
//   - The hub role starts first to win the link hub race; every other role
//     waits briefly for the hub port. The hub is named by the manifest.
//   - The restart loop honors .stop and .reset sentinels and is bounded by
//     the crash guard.
//   - No key or secret wiring: a key is an operator concern (the
//     operator's environment carries it), handled by nothing in here.
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

import { profileBody } from "./inventory.mjs";
import { CrashGuard, CRASH_GUARD_MESSAGE } from "./crashguard.mjs";

// The link hub port. pi-link's default hub port; overridable for a team
// that runs its hub elsewhere.
export const DEFAULT_HUB_PORT = 9900;

const HUB_WAIT_SECONDS_DEFAULT = 5;

// The role's omp argv, read field by field from the manifest. Absent
// fields are omitted; linkName falls back to the role key; cwd falls back
// to the repo root; the prompt path is the one buildPromptFile writes.
export function roleArgv(root, config, roleKey) {
  const role = config?.roles?.[roleKey] ?? {};
  const sessionDir = role.sessionDir
    ? resolvePath(root, role.sessionDir)
    : defaultSessionDir(root, roleKey);
  const promptPath = role.prompt
    ? resolvePath(root, role.prompt)
    : join(sessionDir, "system-prompt.md");

  const argv = ["omp"];
  argv.push("--session-dir", sessionDir);
  argv.push("--link-name", role.linkName ?? roleKey);
  if (role.model) argv.push("--model", role.model);
  argv.push("--cwd", role.cwd ? resolvePath(root, role.cwd) : root);
  argv.push("--system-prompt", `@${promptPath}`);
  if (role.config) argv.push("--config", resolvePath(root, role.config));
  if (Array.isArray(role.args)) argv.push(...role.args.map(String));
  return { argv, promptPath, sessionDir };
}

export function defaultSessionDir(root, roleKey) {
  return join(resolvePath(root, LOCAL_STATE_DIR), "sessions", roleKey);
}

export const LOCAL_STATE_DIR = ".agent-workspace";

// Build (or locate) the role's system prompt file and return its absolute
// path. A manifest-declared prompt file wins; otherwise the declared
// profile's body (frontmatter stripped) is written into the role's session
// dir, with the firstTurn bootstrap appended when the manifest carries one.
export function buildPromptFile(root, config, roleKey) {
  const role = config?.roles?.[roleKey] ?? {};
  if (role.prompt) return resolvePath(root, role.prompt);

  const profilePath = role.profile ? resolvePath(root, role.profile) : null;
  const body = profilePath && existsSync(profilePath) ? profileBody(profilePath) : `# Role: ${roleKey}\n`;

  const sessionDir = role.sessionDir
    ? resolvePath(root, role.sessionDir)
    : defaultSessionDir(root, roleKey);
  mkdirSync(sessionDir, { recursive: true });
  const promptPath = join(sessionDir, "system-prompt.md");
  writePrompt(promptPath, body, role.firstTurn);
  return promptPath;
}

function writePrompt(promptPath, body, firstTurn) {
  if (!firstTurn) {
    writeFileSync(promptPath, body);
    return;
  }
  writeFileSync(
    promptPath,
    body +
      "\n## First turn bootstrap\n\n" +
      "On your very first turn in a brand-new session, " +
      firstTurn +
      " Once a conversation is underway, just respond normally.\n",
  );
}

// Non-hub roles wait briefly for the link hub so the team comes up in
// order (the hub role wins the race because it does not wait). Best
// effort: after the deadline the role starts anyway, exactly like the
// proven source. waitSeconds 0 skips the wait entirely.
export function waitForHub({ port = DEFAULT_HUB_PORT, waitSeconds = HUB_WAIT_SECONDS_DEFAULT } = {}) {
  const deadline = Date.now() + waitSeconds * 1000;
  return new Promise((resolveWait) => {
    const probe = () => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.on("connect", () => {
        socket.destroy();
        resolveWait(true);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) resolveWait(false);
        else setTimeout(probe, 100);
      });
    };
    // HUB_WAIT_SECONDS=0 skips: the deadline is already past.
    if (Date.now() >= deadline) {
      resolveWait(false);
      return;
    }
    probe();
  });
}

// One role's terminal loop: spawn omp with the manifest's argv, honor the
// .stop and .reset sentinels, bound the restarts with the crash guard.
// Returns the loop's exit reason: "stop", "reset" never returns (it loops
// internally), "guard", or "exit" (the child exited after a real run and
// the loop has nothing to restart).
export async function runRoleLoop({ root, config, roleKey, spawn: spawnImpl = defaultSpawn, log = () => {}, onGuardTrip = null }) {
  const role = config?.roles?.[roleKey] ?? {};
  const sessionDir = role.sessionDir
    ? resolvePath(root, role.sessionDir)
    : resolvePath(root, LOCAL_STATE_DIR, `${roleKey}.sessions`);
  mkdirSync(sessionDir, { recursive: true });

  const guard = new CrashGuard();
  let fresh = false;
  for (;;) {
    const hasHistory = existsSync(join(sessionDir, "session.jsonl")) ||
      existsSync(join(sessionDir, "history.jsonl"));
    const startedAt = Date.now();
    const argv = roleArgvArgs(root, config, roleKey, !fresh && hasHistory);
    const code = await spawnImpl(argv, { cwd: root });
    const elapsed = Date.now() - startedAt;

    if (existsSync(join(sessionDir, ".stop"))) {
      rmSentinel(join(sessionDir, ".stop"));
      return "stop";
    }
    if (existsSync(join(sessionDir, ".reset"))) {
      rmSentinel(join(sessionDir, ".reset"));
      fresh = true;
      continue;
    }
    if (guard.record(elapsed) === "trip") {
      log(CRASH_GUARD_MESSAGE(roleKey, guard.crashCount, Math.round(guard.windowMs / 1000)));
      if (onGuardTrip) onGuardTrip();
      return "guard";
    }
    if (code === 0) {
      // The agent exited cleanly after a real run; the pane is done.
      return "exit";
    }
  }
}

function roleArgvArgs(root, config, roleKey) {
  return roleArgv(root, config, roleKey).argv;
}

function rmSentinel(path) {
  try {
    rmSync(path);
  } catch {
    // best effort
  }
}

function defaultSpawn(argv, options) {
  // The real spawn lives in lib/cli.mjs (inherited stdio); tests inject a
  // fake. This default is only for direct library use.
  return new Promise((resolveDone) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", ...options });
    child.on("exit", (code) => resolveDone(code ?? 1));
    child.on("error", () => resolveDone(1));
  });
}