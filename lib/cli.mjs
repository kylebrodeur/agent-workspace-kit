// agent-workspace-kit CLI: mode dispatch.
//
//   check   validate the manifest and report (read-only, never writes)
//   layout  render the team's KDL layout for the selected roles (writes
//           only with --out)
//   run     one role's terminal loop without panes (the no-pane
//           alternative to Zellij)
//   start   preflight, then attach-or-create the team's Zellij session
//
// The launcher READS every launch fact from the manifest; nothing here
// restates a role's model, cwd, profile, session dir, config, or link
// name. Read-only inspection modes never write (the pi-link rule).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve as resolvePath } from "node:path";

import { loadManifest } from "./manifest.mjs";
import { RoleSelectionError, selectRoles } from "./roles.mjs";
import { renderLayout } from "./layout.mjs";
import { pathWithRuntimeFirst } from "./node-runtime.mjs";
import { ensureWorktrees } from "./worktrees.mjs";
import { acquireTestsLock, releaseTestsLock, testsLockPath } from "./testlock.mjs";
import { hubStatusSync, resolveHubPort } from "./hub.mjs";
import { DEFAULT_HUB_PORT, LOCAL_STATE_DIR, buildPromptFile, runRoleLoop, waitForHub } from "./terminal.mjs";

const USAGE_EXIT = 64;
const MANIFEST_REL = join(".pi-link", "team.json");

export function main(argv) {
  const mode = argv[0];
  if (mode === undefined || mode === "--help" || mode === "-h") {
    usage(null);
    return USAGE_EXIT;
  }
  if (!MODES.has(mode)) {
    usage(mode);
    return USAGE_EXIT;
  }
  return MODES.get(mode)(argv.slice(1));
}

const MODES = new Map([
  ["check", modeCheck],
  ["layout", modeLayout],
  ["run", modeRun],
  ["start", modeStart],
  ["tests", modeTests],
]);

// ── flag parsing (small by design; the surface is five modes) ────────────

class UsageError extends Error {}

function parseFlags(args, spec) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    let inline = eq === -1 ? null : arg.slice(eq + 1);
    const kind = spec.get(name) ?? (name === "--root" ? "value" : null);
    if (kind === null) throw new UsageError(`error: unknown flag '${name}'`);
    if (kind === "flag") {
      flags[name] = true;
    } else if (kind === "value") {
      if (inline === null) {
        inline = args[++i];
        if (inline === undefined) throw new UsageError(`error: ${name} requires a value`);
      }
      flags[name] = inline;
    } else if (kind === "optional-list") {
      // --fresh [list]: bare flag, an inline =list, or an adjacent list value.
      if (inline !== null) flags[name] = inline;
      else if (args[i + 1] !== undefined && !args[i + 1].startsWith("--")) flags[name] = args[++i];
      else flags[name] = true;
    }
  }
  return { flags, positionals };
}

function withUsageExit(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(error.message + "\n");
      return USAGE_EXIT;
    }
    throw error;
  }
}

function resolveRoot(flags) {
  return resolvePath(flags["--root"] ?? process.env.AGT_TEAM_ROOT ?? process.cwd());
}

function manifestUnderTest(flags, root) {
  return flags["--manifest"] ? resolvePath(root, flags["--manifest"]) : join(root, MANIFEST_REL);
}

// The team's expected link names for a roster check, in role order: the
// declared linkName, else the group-suffixed default (the same rule
// roleArgv applies when launching).
function expectedLinkNames(config, roleKeys) {
  const group = config?.team?.group ?? null;
  return roleKeys.map((roleKey) => {
    const declared = config?.roles?.[roleKey]?.linkName;
    return declared ?? (group ? `${roleKey}@${group}` : roleKey);
  });
}

// The SYNC hub roster: `{ port, status }` where status is the validated
// payload or null (no hub answer, whatever the cause). A foreign-roster
// hub is a returned conflict, not a throw, because check and start
// report it differently.
function hubRoster(config, roleKeys) {
  const port = resolveHubPort(config, process.env);
  const { status, kind } = hubStatusSync(port);
  if (status === null) {
    return { port, status, kind };
  }
  const expected = expectedLinkNames(config, roleKeys);
  const foreign = status.terminals.map((t) => t.name).filter((name) => !expected.includes(name));
  if (foreign.length > 0) {
    return {
      port,
      status,
      kind: "conflict",
      conflict:
        `error: port ${port} is a different hub: ${foreign.join(", ")}; stop that session or move this team to its own hub`,
    };
  }
  return { port, status, kind: "ok" };
}

function writeHubLines(out, port, status) {
  out.write(`hub: ${status.team ?? "(unnamed)"} (port ${port})\n`);
  for (const terminal of status.terminals) {
    const state = terminal.status ? ` (${terminal.status})` : "";
    out.write(`  ${terminal.name}${state}\n`);
  }
}

// ── check: the preflight, read-only ──────────────────────────────────────

function modeCheck(args) {
  if (flagsHasHelp(args)) {
    printModeHelp("check");
    return 0;
  }
  return withUsageExit(() => {
    const parsed = parseFlags(
      args,
      new Map([["--manifest", "value"], ["--json", "flag"]]),
    );
    const root = resolveRoot(parsed.flags);
    const result = loadManifest(root, manifestUnderTest(parsed.flags, root));
    if (result.errors.length > 0) {
      if (parsed.flags["--json"]) {
        process.stdout.write(
          JSON.stringify({ ok: false, errors: result.errors, warnings: result.warnings }, null, 2) + "\n",
        );
        return 1;
      }
      reportProblems(result);
      return 1;
    }
    // The hub roster is read-only and best-effort: "no answer" reports
    // nothing, "unsupported payload" reports that line, a foreign roster
    // is an error (check still never writes).
    const roster = hubRoster(result.config, Object.keys(result.config?.roles ?? {}));
    if (roster.kind === "conflict") {
      if (parsed.flags["--json"]) {
        process.stdout.write(
          JSON.stringify({ ok: false, errors: [roster.conflict.replace(/^error: /, "")], warnings: result.warnings }, null, 2) + "\n",
        );
        return 1;
      }
      process.stdout.write("hub: different hub - " + roster.conflict.replace(/^error: /, "") + "\n");
      return 1;
    }
    if (parsed.flags["--json"]) {
      process.stdout.write(
        JSON.stringify(
          { ok: true, errors: [], warnings: result.warnings, hub: roster.status ? { port: roster.port, team: roster.status.team, terminals: roster.status.terminals } : null },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }
    const roleCount = Object.keys(result.config?.roles ?? {}).length;
    const hubRole = result.config?.hub?.role ?? "(none)";
    process.stdout.write(`Team manifest valid: ${roleCount} roles, hub ${hubRole}\n`);
    for (const warning of result.warnings) process.stdout.write(`WARN ${warning}\n`);
    if (roster.status !== null) {
      writeHubLines(process.stdout, roster.port, roster.status);
    } else if (roster.kind === "unsupported") {
      process.stdout.write("hub: unsupported status payload\n");
    }
    return 0;
  });
}

function flagsHasHelp(args) {
  return args.includes("--help") || args.includes("-h");
}

function reportProblems(result) {
  for (const error of result.errors) process.stderr.write(`ERROR ${error}\n`);
  for (const warning of result.warnings) process.stderr.write(`WARN ${warning}\n`);
}

// ── layout: generate, print or write ─────────────────────────────────────

function modeLayout(args) {
  if (flagsHasHelp(args)) {
    printModeHelp("layout");
    return 0;
  }
  return withUsageExit(() => {
    const parsed = parseFlags(
      args,
      new Map([["--roles", "value"], ["--out", "value"], ["--manifest", "value"]]),
    );
    const root = resolveRoot(parsed.flags);
    const result = loadManifest(root, manifestUnderTest(parsed.flags, root));
    if (result.errors.length > 0) {
      reportProblems(result);
      return 1;
    }
    let selection;
    try {
      selection = selectRoles(result.config, { roles: parsed.flags["--roles"] ?? undefined });
    } catch (error) {
      if (error instanceof RoleSelectionError) {
        process.stderr.write(error.message + "\n");
        return USAGE_EXIT;
      }
      throw error;
    }
    // The pane command is the absolute node running teamctl, so the
    // pane's runtime IS this process's runtime (never PATH luck).
    const kdl = renderLayout(root, thisKitPath(), {
      roles: selection.selected,
      config: result.config,
      nodePath: process.execPath,
    });
    if (parsed.flags["--out"]) {
      const outPath = resolvePath(root, parsed.flags["--out"]);
      mkdirSync(join(outPath, ".."), { recursive: true });
      writeFileSync(outPath, kdl);
      return 0;
    }
    process.stdout.write(kdl);
    return 0;
  });
}

// The absolute path of this kit's CLI, for the layout's pane args: the
// pane command is `node <this path> run <role>`.
function thisKitPath() {
  const here = import.meta.dirname ? resolvePath(import.meta.dirname) : process.cwd();
  if (here.endsWith(`${join("bin")}`) || here.endsWith("bin")) {
    return join(here, "teamctl.mjs");
  }
  return join(here, "..", "bin", "teamctl.mjs");
}

// ── run: one role, no panes ──────────────────────────────────────────────

function modeRun(args) {
  if (flagsHasHelp(args)) {
    printModeHelp("run");
    return 0;
  }
  return withUsageExit(() => {
    const parsed = parseFlags(
      args,
      new Map([["--manifest", "value"], ["--wait-seconds", "value"]]),
    );
    const root = resolveRoot(parsed.flags);
    const roleKey = parsed.positionals[0];
    if (!roleKey) throw new UsageError("error: run requires a role");
    const result = loadManifest(root, manifestUnderTest(parsed.flags, root));
    if (result.errors.length > 0) {
      reportProblems(result);
      return 1;
    }
    const config = result.config;
    if (!config.roles[roleKey]) {
      process.stderr.write(`error: unknown role '${roleKey}'. Valid: ${Object.keys(config.roles).join(", ")}\n`);
      return USAGE_EXIT;
    }

    buildPromptFile(root, config, roleKey);
    // The hub role never waits (it IS what the others wait for), so it
    // wins the hub race by construction; the hub name comes from the
    // manifest, never from here.
    if (roleKey !== config.hub?.role) {
      const waitSeconds = parsed.flags["--wait-seconds"] !== undefined
        ? Number(parsed.flags["--wait-seconds"])
        : Number(process.env.HUB_WAIT_SECONDS ?? 5);
      // The wait is async (a socket probe must be); the loop below is the
      // process's reason to live, so awaiting here is correct.
      return runModeAsync(waitForHubPort(waitSeconds).then(() => enterRoleLoop(root, config, roleKey)));
    }
    return runModeAsync(enterRoleLoop(root, config, roleKey));
  });
}

function waitForHubPort(waitSeconds) {
  if (!(waitSeconds > 0)) return Promise.resolve();
  return waitForHub({
    port: Number(process.env.PI_LINK_PORT ?? DEFAULT_HUB_PORT),
    waitSeconds,
  });
}

// The CLI hands its own exit code over to bin/teamctl.mjs via
// process.exitCode; an async mode resolves it and sets the code.
function runModeAsync(promise) {
  promise
    .then((reason) => {
      process.exitCode = reason === "stop" || reason === "exit" ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`error: ${error.message}\n`);
      process.exitCode = 1;
    });
  return 0;
}

async function enterRoleLoop(root, config, roleKey) {
  const reason = await runRoleLoop({ root, config, roleKey });
  process.stderr.write(`teamctl run: role ${roleKey} loop ended (${reason})\n`);
  return reason;
}

// ── start: preflight, then Zellij ────────────────────────────────────────

function modeStart(args) {
  if (flagsHasHelp(args)) {
    printModeHelp("start");
    return 0;
  }
  return withUsageExit(() => {
    const parsed = parseFlags(
      args,
      new Map([
        ["--roles", "value"],
        ["--fresh", "optional-list"],
        ["--manifest", "value"],
      ]),
    );
    const root = resolveRoot(parsed.flags);

    // The preflight runs BEFORE role selection and BEFORE anything writes:
    // a red manifest must stop the launch before any pane exists.
    const result = loadManifest(root, manifestUnderTest(parsed.flags, root));
    if (result.errors.length > 0) {
      reportProblems(result);
      process.stderr.write("team manifest invalid - run: teamctl check\n");
      return 1;
    }
    const config = result.config;
    const sessionName = config.team?.name ?? config.team?.group;

    const fresh = parsed.flags["--fresh"];
    let selection;
    try {
      selection = selectRoles(config, {
        roles: parsed.flags["--roles"] ?? undefined,
        fresh: fresh ? fresh : undefined,
      });
    } catch (error) {
      if (error instanceof RoleSelectionError) {
        process.stderr.write(error.message + "\n");
        return USAGE_EXIT;
      }
      throw error;
    }

    // The hub check runs AFTER selection and BEFORE anything writes: a
    // foreign hub (another team's terminals on this team's port) stops
    // the launch with the named fix. No hub answering (nothing listening
    // yet, or the payload unreadable before the hub's own team starts)
    // proceeds; this team's own hub wins the port race on start.
    const roster = hubRoster(config, selection.selected);
    if (roster.kind === "conflict") {
      process.stderr.write(roster.conflict + "\n");
      return 1;
    }
    if (roster.status !== null) {
      writeHubLines(process.stdout, roster.port, roster.status);
    }

    // Declared worktrees are created here, after the preflight, hub
    // check, and role selection, BEFORE anything else writes: a lane's
    // worktree is a precondition, not something to repair mid-flight.
    try {
      ensureWorktrees(root, config, selection.selected);
    } catch (error) {
      process.stderr.write(`error: ${error.message}\n`);
      return 1;
    }

    if (fresh) {
      if (zellijSessionExists(sessionName)) {
        zellij(["delete-session", "--force", sessionName]);
      }
      for (const roleKey of selection.reset) {
        const dir = config.roles[roleKey]?.sessionDir
          ? resolvePath(root, config.roles[roleKey].sessionDir)
          : join(root, LOCAL_STATE_DIR, "sessions", roleKey);
        rmSync(dir, { recursive: true, force: true });
      }
    }

    // Prompts regenerate on EVERY start (the handoff: a profile fix
    // needed a manual edit or a lane rebuild otherwise). A role that
    // declares its own prompt file still resolves to that file.
    for (const roleKey of selection.selected) {
      buildPromptFile(root, config, roleKey);
    }

    const kdl = renderLayout(root, thisKitPath(), {
      roles: selection.selected,
      config,
      nodePath: process.execPath,
    });
    const layoutDir = join(root, LOCAL_STATE_DIR);
    mkdirSync(layoutDir, { recursive: true });
    const layoutPath = join(layoutDir, `${sessionName}.kdl`);
    writeFileSync(layoutPath, kdl);

    // Delete exited sessions of this team name before attaching again.
    cleanupExitedSessions(sessionName);

    if (!zellijOnPath()) {
      process.stderr.write("error: zellij not found on PATH; install zellij first\n");
      return 1;
    }
    const attach = spawnSync("zellij", ["--layout", layoutPath, "attach", "--create", sessionName], {
      stdio: "inherit",
      env: runtimeEnv(),
    });
    return attach.status ?? 1;
  });
}

function zellijOnPath() {
  const found = spawnSync("zellij", ["--version"], {
    encoding: "utf8",
    env: runtimeEnv(),
  });
  return found.error ? null : "zellij";
}

function zellij(args) {
  spawnSync("zellij", args, { stdio: "ignore", env: runtimeEnv() });
}

function zellijSessionExists(sessionName) {
  const out = spawnSync("zellij", ["list-sessions", "--no-formatting"], {
    encoding: "utf8",
    env: runtimeEnv(),
  });
  if (out.error) return false;
  return (out.stdout ?? "").split("\n").some((line) => line.includes(`${sessionName} [`));
}

function cleanupExitedSessions(sessionName) {
  const out = spawnSync("zellij", ["list-sessions", "--no-formatting"], {
    encoding: "utf8",
    env: runtimeEnv(),
  });
  if (out.error) return;
  const exited = (out.stdout ?? "")
    .split("\n")
    .filter((line) => line.includes(`${sessionName} [`) && line.includes("EXITED"))
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean);
  for (const name of exited) {
    zellij(["delete-session", "--force", name]);
  }
}

// Every zellij child (and its pane children) resolves the runtime that
// launched teamctl first: the runtime's dir goes at the head of PATH.
function runtimeEnv() {
  return { ...process.env, PATH: pathWithRuntimeFirst(process.env.PATH, process.execPath) };
}

// ── tests: one full test run per team, under the team lock ───────────────

// The ONE writer of the tests lock: acquire (default wait 60s,
// TEST_WAIT_SECONDS), run the command, release in finally. The lock keeps
// two teams (or two agents) from running full suites against the same
// machine at once (the load-150 incident).
function modeTests(args) {
  if (flagsHasHelp(args)) {
    printModeHelp("tests");
    return 0;
  }
  // The lock acquire is the one await; main()'s caller (bin/teamctl.mjs)
  // awaits a promise return, and the tests await it too.
  return withUsageExit(() => modeTestsAsync(args));
}

async function modeTestsAsync(args) {
  const parsed = parseFlags(
    args,
    new Map([["--root", "value"], ["--manifest", "value"], ["--wait-seconds", "value"]]),
  );
  const root = resolveRoot(parsed.flags);
  const command = parsed.positionals;
  if (command.length === 0) throw new UsageError("error: tests requires a command");
  const result = loadManifest(root, manifestUnderTest(parsed.flags, root));
  if (result.errors.length > 0) {
    reportProblems(result);
    process.stderr.write("team manifest invalid - run: teamctl check\n");
    return 1;
  }
  const waitSeconds = parsed.flags["--wait-seconds"] !== undefined
    ? Number(parsed.flags["--wait-seconds"])
    : Number(process.env.TEST_WAIT_SECONDS ?? 60);
  const lock = await acquireTestsLock(root, { waitSeconds: Number.isFinite(waitSeconds) ? waitSeconds : 60 });
  if (lock === null) {
    process.stderr.write(
      `error: tests lock held by another run: ${testsLockPath(root)} (waited ${waitSeconds}s)\n`,
    );
    return 1;
  }
  try {
    const run = spawnSync(command[0], command.slice(1), { stdio: "inherit", env: runtimeEnv() });
    if (run.error) {
      process.stderr.write(`error: ${run.error.message}\n`);
      return 1;
    }
    return run.status ?? 1;
  } finally {
    await releaseTestsLock(root);
  }
}

// ── usage ────────────────────────────────────────────────────────────────

function usage(badMode) {
  const out = badMode === null ? process.stdout : process.stderr;
  if (badMode !== null) out.write(`error: unknown mode '${badMode}'\n`);
  out.write(
    [
      "usage: teamctl <mode> [flags]",
      "",
      "modes:",
      "  check     validate the team manifest; read-only",
      "  layout    print the Zellij layout for the selected roles",
      "  run ROLE  run one role's terminal loop without panes",
      "  start     preflight, then attach-or-create the team's Zellij session",
      "  tests     run one command under the team's tests lock",
      "",
      "run 'teamctl <mode> --help' for that mode's flags.",
    ].join("\n") + "\n",
  );
}

function printModeHelp(mode) {
  const help = {
    check:
      [
        "usage: teamctl check [--root DIR] [--manifest PATH] [--json]",
        "",
        "Validates the team manifest against what exists on disk. Exit 0 with",
        "zero errors; exit 1 otherwise. Read-only: reports and never writes.",
      ].join("\n") + "\n",
    layout:
      [
        "usage: teamctl layout [--root DIR] [--roles a,b] [--out FILE]",
        "",
        "Prints the team's Zellij layout (one pane per role, the hub focused).",
        "--out writes the KDL to a file instead of stdout.",
      ].join("\n") + "\n",
    run:
      [
        "usage: teamctl run ROLE [--root DIR] [--wait-seconds N]",
        "",
        "Runs one role's terminal loop without panes: the no-pane alternative",
        "to Zellij. Builds the role's prompt from the manifest, waits briefly",
        "for the hub (unless this role IS the hub), then restarts the agent",
        "under the crash guard. A .stop sentinel in the session dir stops the",
        "loop; a .reset sentinel starts the next run fresh.",
      ].join("\n") + "\n",
    start:
      [
        "usage: teamctl start [--root DIR] [--roles a,b] [--fresh[=a,b]]",
        "",
        "Preflights the manifest, checks the hub roster (a different team's",
        "hub stops the launch), creates declared worktrees, regenerates the",
        "selected roles' prompt files, then attach-or-creates the team's",
        "Zellij session: one pane per selected role (the absolute node that",
        "ran teamctl as the command), the hub pane focused. --fresh deletes",
        "the named roles' session dirs (or all selected, bare) and resets",
        "the session. Read-only modes never write; this mode does.",
      ].join("\n") + "\n",
    tests:
      [
        "usage: teamctl tests [--root DIR] [--wait-seconds N] <command...>",
        "",
        "Runs one command per team root under `<root>/.agent-workspace/",
        "tests.lock` (holder pid + start timestamp). A lock whose holder is",
        "dead is replaced; a live holder fails after the wait with",
        "error: tests lock held by another run: <path> (waited <N>s).",
        "The wait default is 60 seconds; TEST_WAIT_SECONDS overrides it.",
      ].join("\n") + "\n",
  };
  process.stdout.write(help[mode]);
}