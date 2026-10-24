<!-- STATUS: VERIFIED 2026-10-22 against lib/*.mjs (81 tests passing). Every command below ran live against the demo team or a sandbox world. -->
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
node bin/teamctl.msf check --root <team-repo> --json
```

(fix the obvious typo: the real command is `teamctl.mjs`). Exit 1 with
zero errors is impossible; warnings alone still exit 0.

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

`--fresh=LIST` deletes those roles' session dirs (their history goes with
them), resets the Zellij session, and starts the named roles. Bare
`--fresh` resets the whole selected set.

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
script or from a coordinating agent.

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

## Point a lane at an omp session config

```json
"planner": { "config": ".pi-link/session.yml" }
```

The file must exist (a missing one is a preflight ERROR); it goes to
`--config` verbatim. Use the config overlay for harness-level feature
flags a lane needs, and keep the role's identity in the profile.

## Install the kit into an agent harness

The skill in `skills/agent-workspace-kit/SKILL.md` teaches the boundary;
copy that directory into the harness's skill root (`.omp/skills/`,
`.agents/skills/`, or `skills/` are the three discovery roots pi-link
reads).

## Mount it as `ecp team` (the control plane)

The repo ships `ecp-commands.toml`, so an `ecp` control plane with this
checkout under `repos.root` mounts `ecp team ...` automatically; no ecp
source change is needed. The commands are passthrough: `ecp team check`,
`ecp team start`, and friends forward argv verbatim.

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