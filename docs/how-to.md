<!-- STATUS: VERIFIED 2026-10-31 against lib/*.mjs (161 tests passing on node 24.19.0). Every command below ran live against the demo team or a sandbox world. -->
# How-to: day-to-day operation

Task-shaped answers for the things you do repeatedly once a team manifest
exists. Setup is [quickstart.md](quickstart.md); every flag and error is
indexed in [RUNBOOK.md](RUNBOOK.md).

## Validate a team before touching anything

```bash
node bin/teamctl.mjs check --root <team-repo>
```

Machine-readable (for CI or a launcher):

```bash
node bin/teamctl.mjs check --root <team-repo> --json
```

Exit 1 with zero errors is impossible; warnings alone still exit 0. The
JSON object carries `hub: null` plus `{port, team, terminals}` when a
hub answered on the declared port.

## Add a role

Add a key under `roles` with at least a `profile`, create the profile
file, and nothing else: the launcher reads the rest from the manifest.
Then re-run `check`.

```json
"reviewer": {
  "profile": ".pi-link/profiles/reviewer.md",
  "cwd": ".",
  "sessionDir": ".agent-workspace/sessions/reviewer"
}
```

## Give each lane its own git worktree (the isolation contract)

Declare the worktree on the role (repo-relative path, branch):

```json
"builder": {
  "profile": ".pi-link/profiles/builder.md",
  "worktree": { "path": "worktrees/builder", "branch": "lane/builder" }
}
```

A role with a `worktree` may not also carry `cwd` (the worktree IS the
lane's working tree); two roles may not share a path or a branch, and
the path must stay inside the team root. `teamctl start` creates the
worktree (`git worktree add`, new branch or existing one) before
anything else is written and refuses to touch a path that already
exists but is not the declared worktree.

```bash
node bin/teamctl.mjs start --root <team-repo>
```

The generated lane prompt carries the discipline section: commit only
your files with explicit pathspecs (`git commit -- <paths>`), never a
bare `git add -A` (a lane's add sweeping a sibling's staged files is the
exact incident this kills). The lane's pane (and `teamctl run <role>`)
runs with the worktree as its directory; `run` fails closed when the
worktree is missing.

## Run a subset (parallel lanes)

```bash
node bin/teamctl.mjs start --root <team-repo> --roles planner,builder
```

The role list comes from the manifest; an unknown name in the list is a
usage error (`exit 64`) naming the valid roles. `layout --roles` renders
the same filtered layout without a session.

## Reset a lane fresh

```bash
node bin/teamctl.mjs start --root <team-repo> --fresh=builder
```

`--fresh=LIST` deletes those roles' session dirs (their history goes
with them), resets the Zellij session, and starts the named roles; the
fresh start regenerates the lanes' prompts from the current profiles.
Bare `--fresh` resets the whole selected set.

## Stop one lane

Touch the stop sentinel in that role's session dir:

```bash
touch <team-repo>/.agent-workspace/sessions/builder/.stop
```

The role's restart loop exits after its current agent run. The pane then
closes; the rest of the team keeps running.

## Reset one lane's conversation

```bash
touch <team-repo>/.agent-workspace/sessions/builder/.reset
```

The next agent run starts fresh (no `--continue`), then the loop carries
on. Use this when a lane's context is poisoned but its session dir is
fine.

## Run a lane with no panes at all

```bash
node bin/teamctl.mjs run builder --root <team-repo>
```

Same manifest, same guard, no panes. This is the shape to use in a
script or from a coordinating agent. A `worktree` role fails closed
here when the worktree is not on disk; run `start` first.

## Give a lane its first-turn brief

Add `firstTurn` to the role in the manifest:

```json
"builder": { "profile": "...", "firstTurn": "Read scratchpads/builder.md and reply DONE with evidence." }
```

The launcher appends the bootstrap section to the role's prompt built
from its profile. On a brand-new session the lane reads its brief first;
after that the note is inert. To change where the prompt COMES from
entirely, declare `prompt` (an existing file) instead of `profile`
stitching.

## Fix a lane's profile without a manual prompt edit

Prompts regenerate on EVERY `teamctl start` from the current profile
(the pre-existing failure: a profile fix needed a manual edit or a lane
rebuild). Change `.pi-link/profiles/<role>.md`, then:

```bash
node bin/teamctl.mjs start --root <team-repo>
```

A role whose manifest declares its own `prompt` file still resolves to
that file; regeneration does not overwrite it.

## Keep two teams off each other's hub

Declare the team's hub identity in the manifest; lanes get
`<roleKey>@<team.group>` as their default link name, so two teams never
share a peer name even on one shared hub:

```json
"team": { "name": "my-team", "group": "my-team" },
"hub": { "role": "planner", "port": 9920 }
```

`teamctl start` shows who is on the port (`hub: <team> (port <port>)`,
one line per terminal) and refuses to launch when the hub there serves
terminals outside your selected roles:

```text
error: port 9900 is a different hub: advisor, app-ui; stop that session or move this team to its own hub
```

Nothing is written when that happens. `teamctl check` reports the same
roster read-only. One limitation, stated plainly: the current pi-link
extension binds 9900 and ignores `PI_LINK_PORT`, so `hub.port` takes
effect only when the installed pi-link runtime honors it; the kit
already writes and reads the env var.

## Never stack full test runs against one machine

```bash
node bin/teamctl.mjs tests --root <team-repo> npm test
```

`teamctl tests` takes `<root>/.agent-workspace/tests.lock` (holder pid
plus start timestamp) and runs your command alone under it; a second
invocation waits (default 60s, `--wait-seconds` or
`TEST_WAIT_SECONDS`) and prints the exact wait error when the deadline
passes. A lock whose holder pid is dead is replaced automatically.

## Install the kit into an agent harness

The skill in `skills/agent-workspace-kit/SKILL.md` teaches the boundary;
copy that directory into the harness's skill root (`.omp/skills/`,
`.agents/skills/`, or `skills/` are the three discovery roots pi-link
reads).

## Mount it as `ecp team` (the control plane)

The repo ships `ecp-commands.toml`, so an `ecp` control plane with this
checkout under `repos.root` mounts `ecp team ...` automatically; no ecp
source change is needed. The commands are passthrough: `ecp team
check`, `ecp team start`, and friends forward argv verbatim.

## Wire the preflight into a Zellij launcher this kit does not own

A repo with its own layout keeps it and adds the gate before the first
pane (the pi-link pattern this kit implements):

```sh
node /path/to/agent-workspace-kit/bin/teamctl.mjs check --root "$REPO" >/dev/null || {
  echo "team manifest invalid - run: teamctl check" >&2
  exit 1
}
```

## Deal with a crash loop

A lane that keeps dying shows one clear line and the pane settles:

```text
crash guard triggered for builder: 5 restarts under 3s inside a 60s window; stopping the restart loop
```

Fix the cause (usually a missing profile or a bad `args` flag the
harness rejects), then start the role again. The floor, the count, and
the window are proven constants in `lib/crashguard.mjs`; they are not
manifest data.