<!-- STATUS: VERIFIED 2026-10-22. Every error string below is quoted from lib/*.mjs source or captured from a live run of this checkout; every flag was checked against the flag tables in lib/cli.mjs. -->
# RUNBOOK.md: the operator's reference

The full command surface, every manifest key, the error strings and their
fixes, and the recovery procedures. Task-shaped guidance lives in
[how-to.md](how-to.md).

## The command surface

Exactly four modes (`lib/cli.mjs`), no more:

```
teamctl check  [--root DIR] [--manifest PATH] [--json]
teamctl layout [--root DIR] [--roles a,b] [--out FILE] [--manifest PATH]
teamctl run    ROLE [--root DIR] [--wait-seconds N] [--manifest PATH]
teamctl start  [--root DIR] [--roles a,b] [--fresh[=a,b]] [--manifest PATH]
```

`--root DIR` is always the TEAM root the manifest resolves against
(default: `$AGT_TEAM_ROOT`, else `$PWD`). `--manifest PATH` is
repo-relative to that root (only needed when a manifest lives somewhere
other than `.pi-link/team.json`).

## Mode by mode

### `teamctl check`

Validates the manifest against what exists on disk. Prints `Team manifest
valid: <n> roles, hub <role>` plus each warning on stdout, or `ERROR
<e>` / `WARN <w>` lines on stderr. `--json` prints one object
`{ok, errors, warnings}` on stdout. Exit 0 only with zero errors.
Strictly read-only: `check` never writes a byte to the team repo.

### `teamctl layout`

Prints the KDL layout for the selected roles (default: every role, in
manifest order). `--out FILE` writes it instead (the only write of this
mode). Exit 64 on usage errors, 1 on a red manifest.

### `teamctl run ROLE`

One role's terminal loop: builds the prompt file, waits for the hub
(unless the role IS the manifest's hub), then restarts `omp ...` under
the crash guard until a `.stop` sentinel, an `omp` clean exit after a
real run, or a guard trip. Exit 0 on `stop`/`exit`, 1 on `guard`.

### `teamctl start`

The launch: preflight, then role selection, then (with `--fresh`) session
and sessionDir reset, then the filtered layout written to
`<root>/.agent-workspace/<team>.kdl`, then EXITED-session cleanup, then
`zellij --layout <file> attach --create <team>` with inherited stdio and
its exit code. A red manifest exits 1 before zellij runs.

## The environment

| Variable | Default | Meaning |
|---|---|---|
| `AGT_TEAM_ROOT` | `$PWD` | The team root when `--root` is not passed. |
| `PI_LINK_PORT` | `9900` | The hub port the wait probes (pi-link's default). |
| `HUB_WAIT_SECONDS` | `5` | How long a non-hub role waits for the hub. `0` disables the wait. |

No credential env var is read or exported by the kit. A key an agent lane
needs is an operator concern: put it in the operator's environment or the
omp session config file the manifest declares. The kit carries no key
export, no `.env` path, no secret handling (extraction item 8).

## The manifest schema (`.pi-link/team.json`)

Top level: `version` (must be `1`), `team.name`, `team.group`,
`hub.role`, optional `hub.mode` (carried, not validated). `hub.role` MUST
name a key in `roles`.

Per role (keys of `roles`, at least one required):

| Key | Kind | Rule |
|---|---|---|
| `profile` | file | **Required.** Repo-relative; must exist. |
| `role` | string | Optional. Pane title: `<key>: <role>`. |
| `model` | string | Optional. The ONLY source for `--model` (the manifest wins by construction; a profile frontmatter disagreement is a warning). |
| `cwd` | dir | Optional. **Must already exist.** Defaults to the team root. |
| `sessionDir` | dir | Optional. Need not exist; created on first launch (warning until it is). Defaults to `.agent-workspace/sessions/<role>`. Two roles may not share one. |
| `config` | file | Optional. Must exist when declared; passed as `--config`. |
| `prompt` | file | Optional. Must exist when declared; wins over building a prompt from `profile`. |
| `linkName` | string | Optional. Defaults to the role key; two roles may not share one. |
| `firstTurn` | string | Optional. The first-turn bootstrap sentence appended to the built prompt. |
| `args` | string[] | Optional. Extra omp flags appended after the facts (e.g. `["--no-lsp"]`). |
| `skills.required` | string[] | Each must exist in a skill root; missing is an ERROR. |
| `skills.optional` | string[] | Each should exist in a skill root; missing is a WARNING. |
| `tools.*` | string[] | Declared intent only; never granted by the kit. |

Skill roots, in discovery order: `.omp/skills`, `.agents/skills`,
`skills`. The same id in two roots warns (a source-to-install shadow).
All paths are repo-relative; an absolute path is an ERROR.

## Error strings and their fixes

### Preflight (check / start)

| Error string | Cause and fix |
|---|---|
| `no team manifest at <path>` | No manifest there. Create `.pi-link/team.json`, or pass `--manifest`. |
| `team manifest is not valid JSON: <detail>` | The file has a syntax error. Fix the JSON (the detail carries line info). |
| `team manifest version must be 1` | `version` is missing, or not `1`. |
| `team.name is required` | Add `team.name`. |
| `team.group is required` | Add `team.group`. |
| `roles must contain at least one role` | The `roles` object is empty or missing. |
| `hub.role is required` | Add `hub.role`. |
| `hub.role "<x>" does not name a configured role` | `hub.role` names nothing in `roles`. Fix the key or add the role. |
| `roles.<k>.profile is required` | Every role needs a `profile`. |
| `roles.<k>.profile is missing: <p>` | The declared profile file does not exist. Create it or fix the path. |
| `roles.<k>.<field> must be a repo-relative path: <p>` | An absolute path (profile, prompt, config, cwd, or sessionDir). Make it repo-relative. |
| `roles.<k>.prompt is missing: <p>` | Declared prompt does not exist. |
| `roles.<k>.config is missing: <p>` | Declared config does not exist. |
| `roles.<k>.cwd is not an existing directory: <p>` | `cwd` MUST already exist. Create the directory (and do not confuse it with sessionDir). |
| `roles.<k>.linkName duplicates roles.<j>: <n>` | Two roles share one linkName. Every role needs its own. |
| `roles.<k>.sessionDir is shared with roles.<j>: <p>` | Two roles would resume the same history under different identities. Give each its own dir. |
| `roles.<k>.skills.required references missing skill: <id>` | A required skill is in no skill root. Add it or drop the requirement. |
| `roles.<k>.tools must be an object whose values are arrays of strings: <v>` | Malformed `tools`. Use `{"required": [...], "requestable": [...]}`. |

Warnings (never fatal):

| Warning string | Meaning |
|---|---|
| `roles.<k>.sessionDir does not exist yet (created on first launch): <p>` | Normal on a fresh checkout. The launcher creates it. |
| `roles.<k>.skills.optional references missing skill: <id>` | An optional skill is absent. |
| `roles.<k>.model "<m>" overrides the profile's declared "<pm>", so the manifest value is what launches` | Deliberate override made visible. |
| `skill "<id>" appears in <n> skill roots, ...` | Source-to-install shadow. If the install is current, ignore it. |

### Usage (exit 64)

| Error string | Cause and fix |
|---|---|
| `usage: teamctl <mode> [flags]` | No mode, `--help`, or an unknown mode. |
| `error: unknown mode '<m>'` | Not one of check/layout/run/start. |
| `error: unknown flag '<f>'` | Not a flag of this mode. Check RUNBOOK's surface. |
| `error: --roles must select at least one role` | An empty `--roles` list. |
| `error: unknown role '<r>'. Valid: <roles>` | A name not in the manifest. Fix the spelling or add the role. |
| `error: run requires a role` | `teamctl run` without a role argument. |
| `error: <flag> requires a value` | A value flag given nothing after it. |
| `error: unknown role '<r>'. Valid: <roles>` (run mode) | A role key the manifest does not declare. |

### Launch (start / run)

| Error string | Cause and fix |
|---|---|
| `error: zellij not found on PATH; install zellij first` | start mode needs the multiplexer. Install zellij, or use `teamctl run` (no panes). |
| `team manifest invalid - run: teamctl check` | The preflight failed inside start. Run `teamctl check` for the full list; zellij was NOT invoked. |
| `crash guard triggered for <role>: <n> restarts under 3s inside a 60s window; stopping the restart loop` | Five fast exits inside a minute. Fix the role's launch facts; the loop stopped itself. |
| `teamctl run: role <r> loop ended (<reason>)` | The loop's exit line: `stop` (sentinel), `exit` (clean agent exit), `guard` (tripped). |

## Read-only vs writing modes

| Mode | Writes |
|---|---|
| `check` | Nothing. Ever. |
| `layout` | Nothing without `--out`; with `--out`, exactly that file. |
| `run` | The role's sessionDir: the prompt file, agent history, `.stop`/`.reset` consumption. |
| `start` | The sessionDir(s) with `--fresh`, the generated `.agent-workspace/<team>.kdl`, zellij's own session state. |

## Recovery procedures

### A red preflight stops the launch

1. Run `teamctl check --root <team>` and read every ERROR line.
2. Each error names its role, field, and path; fix the named thing (or
   create the missing directory).
3. Re-run `check` until exit 0. The sessionDir warnings alone are fine.

Nothing was created by the failed attempt: the preflight runs before any
write.

### A lane crash-loops

1. Read the guard line: it names the role.
2. Run the role's argv by hand to see the real failure:
   `node bin/teamctl.mjs run <role> --wait-seconds 0` (its stderr carries
   the harness's error).
3. Fix the cause (a deleted profile, a bad `args` flag, a moved cwd).
4. Restart the lane. The guard state is per-loop; a fresh loop starts
   clean.

### A stale or EXITED session blocks attaching

`teamctl start` deletes EXITED sessions of the same team name
automatically. A session in a weird state (a killed pane still "attached"
in another terminal) needs the explicit reset:

```bash
zellij delete-session --force <team>
node bin/teamctl.mjs start --root <team> --fresh
```

### Reset everything back to a clean checkout

```bash
rm -rf <team>/.agent-workspace
node bin/teamctl.mjs start --root <team>
```

Only `.agent-workspace/` is kit state; the manifest and profiles are
tracked files you own.

## What this runbook does NOT cover

- omp session flag administration: the kit forwards what the manifest
  declares; harness-level flags belong to that harness's docs.
- pi-link hub operation (ports, peer discovery): the hub is a dependency
  this kit launches agents AROUND, not inside.
- Agent behavior inside a session: that is the profile's job, not the
  launcher's.