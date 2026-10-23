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
]);

// ── flag parsing (small by design; the surface is four modes) ────────────

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

// ── check: the preflight, read-only ──────────────────────────────────────

function modeCheck(args) {
  if (flagsHasHelp(args)) {
    printModeHelp("check");
    return 0;
  }
  return withUsageExit(() => {
    const parsed = parseFlags(args, new Map([["--manifest", "value"], ["--json", "flag"]]));
    const root = resolveRoot(parsed.flags);
    const result = loadManifest(root, manifestUnderTest(parsed.flags, root));
    if (parsed.flags["--json"]) {
      process.stdout.write(
        JSON.stringify(
          { ok: result.errors.length === 0, errors: result.errors, warnings: result.warnings },
          null,
          2,
        ) + "\n",
      );
    } else if (result.errors.length > 0) {
      reportProblems(result);
    } else {
      const roleCount = Object.keys(result.config?.roles ?? {}).length;
      const hubRole = result.config?.hub?.role ?? "(none)";
      process.stdout.write(`Team manifest valid: ${roleCount} roles, hub ${hubRole}\n`);
      for (const warning of result.warnings) process.stdout.write(`WARN ${warning}\n`);
    }
    return result.errors.length === 0 ? 0 : 1;
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
    const kdl = renderLayout(root, thisKitPath(), { roles: selection.selected, config: result.config });
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

    const kdl = renderLayout(root, thisKitPath(), { roles: selection.selected, config });
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
    });
    return attach.status ?? 1;
  });
}

function zellijOnPath() {
  const found = spawnSync("zellij", ["--version"], { encoding: "utf8" });
  return found.error ? null : "zellij";
}

function zellij(args) {
  spawnSync("zellij", args, { stdio: "ignore" });
}

function zellijSessionExists(sessionName) {
  const out = spawnSync("zellij", ["list-sessions", "--no-formatting"], { encoding: "utf8" });
  if (out.error) return false;
  return (out.stdout ?? "").split("\n").some((line) => line.includes(`${sessionName} [`));
}

function cleanupExitedSessions(sessionName) {
  const out = spawnSync("zellij", ["list-sessions", "--no-formatting"], { encoding: "utf8" });
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
        "Preflights the manifest, then attach-or-creates the team's Zellij",
        "session: one pane per selected role, the hub pane focused. --fresh",
        "deletes the named roles' session dirs (or all selected, bare) and",
        "resets the session. Read-only modes never write; this mode does.",
      ].join("\n") + "\n",
  };
  process.stdout.write(help[mode]);
}