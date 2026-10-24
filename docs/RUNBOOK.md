<!-- STATUS: VERIFIED 2026-10-31 against bin/teamctl.mjs, lib/*.mjs, and the captured live runs of this checkout (161 tests passing on node 24.19.0). -->
# RUNBOOK.md: the operator's reference

The full command surface, every manifest key, the error strings and their
fixes, and the recovery procedures. Task-shaped guidance lives in
[how-to.md](how-to.md).

## The command surface

Exactly five modes (`lib/cli.mjs`), no more:

```
teamctl check  [--root DIR] [--manifest PATH] [--json]
teamctl layout [--root DIR] [--roles a,b] [--out FILE] [--manifest PATH]
teamctl run    ROLE [--root DIR] [--wait-seconds N] [--manifest PATH]
teamctl start  [--root DIR] [--roles a,b] [--fresh[=a,b]] [--manifest PATH]
teamctl tests  [--root DIR] [--wait-seconds N] <command...> [--manifest PATH]
```

The node floor is not a mode: `teamctl` itself refuses an old Node before
any mode runs (below, under Runtime).

`--root DIR` is always the TEAM root the manifest resolves against
(default: `$AGT_TEAM_ROOT`, else `$PWD`). `--manifest PATH` is
repo-relative to that root (only needed when a manifest lives somewhere
other than `.pi-link/team.json`).

## Runtime (the node floor)

Every invocation compares `process.version` with package.json's
`engines.node` (currently `>=24`) BEFORE any mode dispatch. Too old:

```text
error: agent-workspace-kit requires Node >=24; running v22.23.2
```

Exit 1, one plain line on stderr; nothing else runs. The engines field
is the single source of the requirement (the manifest-is-the-only-
description rule, applied to the runtime), and the range shape this kit
parses is exactly `>=<major>`: anything else fails closed with the same
message shape.

`teamctl start` also carries the runtime to the panes: each pane's
`command` is the absolute `process.execPath` that launched teamctl (a
layout never says the bare `node`), and zellij and its pane children get
`PATH` with that binary's directory first. A lane therefore runs on the
same Node that ran the launcher.

## Mode by mode

### `teamctl check`

Validates the manifest against what exists on disk. Prints `Team manifest
valid: <n> roles, hub <role>` plus each warning on stdout, or `ERROR
<e>` / `WARN <w>` lines on stderr. `--json` prints one object
`{ok, errors, warnings, hub}` on stdout, where `hub` is null or
`{port, team, terminals}`. Exit 0 only with zero errors.
Strictly read-only about the team repo: `check` never writes a byte.

When the manifest declares `hub.port` (or `PI_LINK_PORT` is set),
`check` also probes that port once (2s timeout) and prints the roster
read-only:

```text
hub: <team> (port <port>)
  <linkName> (<status>)
  <linkName> (<status>)
```

No hub answering prints nothing; a 4xx or a payload that does not
validate prints `hub: unsupported status payload`.

### `teamctl layout`

Prints the KDL layout for the selected roles (default: every role, in
manifest order). `--out FILE` writes it instead (the only write of this
mode). Exit 64 on usage errors, 1 on a red manifest. Every pane carries
the absolute node binary as its command; a role with a declared
`worktree` gets that worktree's path as its pane `cwd`.

### `teamctl run ROLE`

One role's terminal loop: builds the prompt file, waits for the hub
(unless the role IS the manifest's hub), then restarts `omp ...` under
the crash guard until a `.stop` sentinel, an `omp` clean exit after a
real run, or a guard trip. Exit 0 on `stop`/`exit`, 1 on `guard`. A role
that declares a `worktree` runs with that worktree as its cwd and FAILS
CLOSED (exit 1, `error: role <k> declares worktree <path> but it does
not exist; run teamctl start first`) when the worktree is missing.

### `teamctl start`

The launch, in order: the runtime gate ran before any of this; then the
preflight; then role selection; then the hub roster check; then declared
worktree creation; then (with `--fresh`) session and sessionDir reset;
then prompt regeneration for every selected role; then the filtered
layout written to `<root>/.agent-workspace/<team>.kdl`; then
EXITED-session cleanup; then `zellij --layout <file> attach --create
<team>` with inherited stdio and its exit code. A red manifest exits 1
before zellij runs, and a foreign hub or a broken worktree exits 1
before the layout is written.

`start` prints the hub roster when a hub answers (same lines as
`check`), and stops before anything is written when the hub on the
port serves terminals this team does not own:

```text
error: port <port> is a different hub: <names>; stop that session or move this team to its own hub
```

### `teamctl tests <command...>`

One full command per team root, under the team's tests lock. The lock
file `<root>/.agent-workspace/tests.lock` holds `{pid, startedAt}` of
the holder. Acquire is the exclusive create (`wx`), so there is no race
window; a holder pid that is not alive is replaced, not waited on; the
wait default is 60 seconds (`--wait-seconds N`, or `TEST_WAIT_SECONDS`),
after which:

```text
error: tests lock held by another run: <root>/.agent-workspace/tests.lock (waited <N>s)
```

Exit code is the command's, and the lock releases in a `finally` (a
crashed run releases too). Read-only modes never take the lock; `tests`
is a writing mode in the sense that it runs your command and holds the
lock meanwhile.

## The environment

| Variable | Default | Meaning |
|---|---|---|
| `AGT_TEAM_ROOT` | `$PWD` | The team root when `--root` is not passed. |
| `PI_LINK_PORT` | `9900` | The hub port when the manifest declares none. |
| `HUB_WAIT_SECONDS` | `5` | How long a non-hub role waits for the hub. `0` disables the wait. |
| `TEST_WAIT_SECONDS` | `60` | How long `teamctl tests` waits for the tests lock. |

No credential env var is read or exported by the kit. A key an agent lane
needs is an operator concern: put it in the operator's environment or the
omp session config file the manifest declares. The kit carries no key
export, no `.env` path, no secret handling.

**The pi-link port limitation, plainly:** the current pi-link extension
binds port 9900 and ignores `PI_LINK_PORT`, so a manifest `hub.port` is
a forward contract: the kit writes and reads the env var and resolves
`hub.port` first, but the port only takes effect when the installed
pi-link runtime honors it. Until then, teams that need separate hubs
must run their own hub on their own port and declare it in the
manifest.

## The manifest schema (`.pi-link/team.json`)

Top level: `version` (must be `1`), `team.name`, `team.group`,
`hub.role`, `hub.port` (optional, integer 1-65535), `node` (optional
floor, the exact shape `">=<major>"`). `hub.role` MUST name a key in
`roles`; `node` is checked against the RUNNING teamctl in every mode
that loads the manifest.

| Top-level key | Kind | Rule |
|---|---|---|
| `version` | number | Must be `1`. |
| `team.name` | string | Required. Also the zellij session name. |
| `team.group` | string | Required. Suffixed onto a role's default link name (`<roleKey>@<group>`) and names the team's hub identity. |
| `hub.role` | string | Required; must name a configured role. That role starts first (it wins the hub race). |
| `hub.port` | number | Optional, integer 1-65535. Resolved as `hub.port`, then `$PI_LINK_PORT`, then `9900`. See the port limitation above. |
| `node` | string | Optional; the exact shape `">=<major>"`. `">=24"` rejects running node v22.23.2 with `running node v22.23.2 does not satisfy the team's node floor >=24`. There is no per-role node field. |

Per role (keys of `roles`, at least one required):

| Key | Kind | Rule |
|---|---|---|
| `profile` | file | **Required.** Repo-relative; must exist. |
| `role` | string | Optional. Pane title: `<key>: <role>`. |
| `model` | string | Optional. The ONLY source for `--model` (the manifest wins by construction; a profile frontmatter disagreement is a warning). |
| `cwd` | dir | Optional. **Must already exist.** Defaults to the team root. May not combine with `worktree`. |
| `worktree` | object | Optional. `{path, branch}`, both repo-relative strings; `start` creates it (`git worktree add`), `run` fails closed when it is missing. `path` must stay inside the team root. |
| `sessionDir` | dir | Optional. Need not exist; created on first launch (warning until it is). Defaults to `.agent-workspace/sessions/<role>`. Two roles may not share one. |
| `config` | file | Optional. Must exist when declared; passed as `--config`. |
| `prompt` | file | Optional. Must exist when declared; wins over building a prompt from `profile`. |
| `linkName` | string | Optional. Defaults to `<roleKey>@<team.group>` (or the bare key when no group); an explicit value stays as declared; two roles may not share one. |
| `firstTurn` | string | Optional. The first-turn bootstrap sentence appended to the built prompt. |
| `args` | string[] | Optional. Extra omp flags appended after the facts (e.g. `["--no-lsp"]`). |
| `skills.required` | string[] | Each must exist in a skill root; missing is an ERROR. |
| `skills.optional` | string[] | Each should exist in a skill root; missing is a WARNING. |
| `tools.*` | string[] | Declared intent only; never granted by the kit. |

Skill roots, in discovery order: `.omp/skills`, `.agents/skills`,
`skills`. The same id in two roots warns (a source-to-install shadow).
All paths are repo-relative; an absolute path is an ERROR.

## Error strings and their fixes

### Runtime + preflight (check / start)

| Error string | Cause and fix |
|---|---|
| `error: agent-workspace-kit requires Node >=24; running v22.23.2` | The Node running teamctl is below the package's engines floor. Switch Node (`nvm use 24` or newer) or install the kit under a Node 24+ prefix, then rerun. |
| `no team manifest at <path>` | No manifest there. Create `.pi-link/team.json`, or pass `--manifest`. |
| `team manifest is not valid JSON: <detail>` | The file has a syntax error. Fix the JSON (the detail carries line info). |
| `team manifest version must be 1` | `version` is missing, or not `1`. |
| `team.name is required` | Add `team.name`. |
| `team.group is required` | Add `team.group`. |
| `roles must contain at least one role` | The `roles` object is empty or missing. |
| `hub.role is required` | Add `hub.role`. |
| `hub.role "<x>" does not name a configured role` | `hub.role` names nothing in `roles`. Fix the key or add the role. |
| `team.node must be the exact shape ">=<major>", got: <v>` | Malformed `node` floor (a bare number, a compound range, non-string). Use exactly `">=24"`-style. |
| `running node <v> does not satisfy the team's node floor <range>` | The manifest's `node` floor is higher than the running teamctl Node. Raise the runtime, or lower the floor. |
| `roles.<k>.profile is required` | Every role needs a `profile`. |
| `roles.<k>.profile is missing: <p>` | The declared profile file does not exist. Create it or fix the path. |
| `roles.<k>.<field> must be a repo-relative path: <p>` | An absolute path (profile, prompt, config, cwd, sessionDir, or worktree path). Make it repo-relative. |
| `roles.<k>.prompt is missing: <p>` | Declared prompt does not exist. |
| `roles.<k>.config is missing: <p>` | Declared config does not exist. |
| `roles.<k>.cwd is not an existing directory: <p>` | `cwd` MUST already exist. Create the directory (and do not confuse it with sessionDir). |
| `roles.<k>.linkName duplicates roles.<j>: <n>` | Two roles share one linkName. Every role needs its own. |
| `roles.<k>.sessionDir is shared with roles.<j>: <p>` | Two roles would resume the same history under different identities. Give each its own dir. |
| `roles.<k>.worktree must be an object with repo-relative path and branch strings, got: <v>` | Malformed `worktree`. Use `{"path": "...", "branch": "..."}`, nothing else. |
| `roles.<k>.worktree may not be combined with cwd: give the lane its worktree path instead` | The role declared both. Drop `cwd`; the worktree IS the lane's working tree. |
| `roles.<k>.worktree shares path with roles.<j>: <p>` | Two lanes cannot checkout one path. Give each role its own path. |
| `roles.<k>.worktree shares branch with roles.<j>: <b>` | Two lanes cannot sit on one branch. Give each role its own branch. |
| `roles.<k>.worktree.path must stay inside the team root: <p>` | The resolved path escapes the root (`../`). Keep worktrees inside the team. |
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
| `error: unknown mode '<m>'` | Not one of check/layout/run/start/tests. |
| `error: unknown flag '<f>'` | Not a flag of this mode. Check RUNBOOK's surface. |
| `error: --roles must select at least one role` | An empty `--roles` list. |
| `error: unknown role '<r>'. Valid: <roles>` | A name not in the manifest. Fix the spelling or add the role. |
| `error: run requires a role` | `teamctl run` without a role argument. |
| `error: tests requires a command` | `teamctl tests` with no command after the flags. |
| `error: <flag> requires a value` | A value flag given nothing after it. |
| `error: unknown role '<r>'. Valid: <roles>` (run mode) | A role key the manifest does not declare. |

### Launch (start / run / tests)

| Error string | Cause and fix |
|---|---|
| `error: zellij not found on PATH; install zellij first` | start mode needs the multiplexer. Install zellij, or use `teamctl run` (no panes). |
| `team manifest invalid - run: teamctl check` | The preflight failed inside start or tests. Run `teamctl check` for the full list; zellij was NOT invoked. |
| `error: port <port> is a different hub: <names>; stop that session or move this team to its own hub` | The hub on the port serves terminals this team does not own. Stop that session, move your team to another declared `hub.port`, or adopt those names into your manifest. Nothing was written. |
| `hub: unsupported status payload` | A hub answered with a payload this kit cannot validate (a 4xx or wrong shape). Check what is bound to the port. |
| `error: git worktree add failed for role <k> (<branch> in <path>): <detail>` | git refused the worktree (an existing branch checked out elsewhere, a dirty path...). Read git's line; fix the branch or path. Nothing was written. |
| `role's worktree path exists but is not a git worktree: <path>; move or remove it yourself - the kit never deletes operator files` | The path exists and is a plain directory. The kit refuses to destroy it; move it yourself and rerun. |
| `role's worktree path exists but points at <current>, not the declared <branch>: <path>; fix the manifest or the worktree yourself` | The worktree sits on another branch. Fix the manifest's branch or the worktree. |
| `role's worktree path exists but is not a git worktree` (run mode variant) / `error: role <k> declares worktree <path> but it does not exist; run teamctl start first` | `run` found no worktree. `start` creates declared worktrees; run start first. |
| `error: tests lock held by another run: <path> (waited <N>s)` | Another live run holds `<root>/.agent-workspace/tests.lock`. Wait for it, or raise `--wait-seconds`. A lock with a dead holder pid is replaced automatically. |
| `crash guard triggered for <role>: <n> restarts under 3s inside a 60s window; stopping the restart loop` | Five fast exits inside a minute. Fix the role's launch facts; the loop stopped itself. |
| `teamctl run: role <r> loop ended (<reason>)` | The loop's exit line: `stop` (sentinel), `exit` (clean agent exit), `guard` (tripped). |

## Generated layout shape

Every command pane is written by the generator with:

- `command` = the absolute node binary that ran teamctl (never the bare
  `node`)
- `cwd` = the team root, except a role whose manifest declares
  `worktree` gets the worktree path
- `args` = the kit's own `teamctl.mjs` then `run <roleKey>`
- `focus=true` on the hub role's pane only

`teamctl start` additionally runs zellij with the node binary's
directory first on `PATH`, so any `node`/`npm`/`npx` the panes resolve
is the same runtime.

## Read-only vs writing modes

| Mode | Writes |
|---|---|
| `check` | Nothing. Ever. |
| `layout` | Nothing without `--out`; with `--out`, exactly that file. |
| `run` | The role's sessionDir: the prompt file, agent history, `.stop`/`.reset` consumption. |
| `start` | Declared worktrees (`git worktree add`), the sessionDir(s) with `--fresh`, every selected role's regenerated prompt file, the generated `.agent-workspace/<team>.kdl`, zellij's own session state. |
| `tests` | The tests lock file `<root>/.agent-workspace/tests.lock` while your command runs, plus whatever your command itself writes. |

## Recovery procedures

### A red preflight stops the launch

1. Run `teamctl check --root <team>` and read every ERROR line.
2. Each error names its role, field, and path; fix the named thing (or
   create the missing directory).
3. Re-run `check` until exit 0. The sessionDir warnings alone are fine.

Nothing was created by the failed attempt: the preflight runs before any
write.

### A foreign hub stopped the start

1. Read the names in the error: those are the OTHER team's lanes.
2. Stop that session (its team's owner decides), or declare your own
   `hub.port` in your manifest (see the port limitation above) and
   rerun.
3. Nothing of yours was written: the layout file does not exist yet.

### A worktree path is not a worktree (or not mine)

1. `error: ... not a git worktree ... the kit never deletes operator
   files` means the path has content the kit refuses to touch.
2. Move or delete it yourself, then rerun `start`; the worktree is
   created fresh.
3. `points at <current>, not the declared <branch>`: either fix the
   manifest's branch to match the worktree, or run
   `git -C <worktree> checkout <declared-branch>` yourself.

### A lane crash-loops

1. Read the guard line: it names the role.
2. Run the role's argv by hand to see the real failure:
   `node bin/teamctl.mjs run <role> --wait-seconds 0` (its stderr carries
   the harness's error).
3. Fix the cause (a deleted profile, a bad `args` flag, a moved cwd).
4. Restart the lane. The guard state is per-loop; a fresh loop starts
   clean.

### A tests lock is in the way

1. `error: tests lock held by another run: <path> (waited <N>s)` means a
   LIVE holder exists. Check the pid inside the lock file.
2. If that pid is dead, `teamctl tests` replaces the lock automatically;
   if you replaced it by hand anyway, `rm <lock>` is the recovery.
3. Raise the wait with `--wait-seconds` for long suites.

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
git worktree remove <declared worktree paths>   # or prune: git worktree prune
node bin/teamctl.mjs start --root <team>
```

Only `.agent-workspace/` is kit state; the manifest and profiles are
tracked files you own. Declared worktrees are real checkouts: remove
them with git's own commands, never by hand.

## What this runbook does NOT cover

- omp session flag administration: the kit forwards what the manifest
  declares; harness-level flags belong to that harness's docs.
- pi-link hub operation beyond the roster read (ports it binds, peer
  discovery): the hub is a dependency this kit launches agents AROUND,
  not inside. One limitation is named above (the hardcoded 9900).
- Agent behavior inside a session: that is the profile's job, not the
  launcher's.