<!-- STATUS: VERIFIED 2026-10-31 against bin/teamctl.mjs, lib/*.mjs, and the captured live runs of this checkout (161 tests passing on node 24.19.0). -->
# Quickstart: from nothing to a validated team

The numbered path: get the kit, describe a team, run the preflight, print
a layout, and start the session. Every command is copy-pasteable.

**What you will have at the end:** a team manifest that passes the
preflight, a generated Zellij layout you can read line by line, and the
`teamctl start` command that attaches one pane per role.

## 0. What this is not

Not an agent runtime and not a coordinator: the kit launches role
sessions into panes and keeps their launch facts in one manifest. The
agent runtime is `omp`; multi-terminal messaging is `pi-link` (a
dependency this kit validates against, not a family member).

## 1. Get the kit

The kit needs Node 24 or newer (the launcher itself refuses an older
Node with one plain line). Install it from GitHub at a tag into a FIXED
user prefix, so your install does not depend on which nvm version is
active:

```bash
mkdir -p "$HOME/.local/npm-global"
npm install --global --prefix "$HOME/.local/npm-global" \
  "github:kylebrodeur/agent-workspace-kit#v0.2.0"
export PATH="$HOME/.local/npm-global/bin:$PATH"
```

The `npm --prefix` target lives at one fixed path, independent of the
active nvm version; the `export PATH` line belongs in your shell
profile (`~/.zshrc` or `~/.bashrc`) so it survives new shells.

From a checkout instead (or for development):

```bash
git clone https://github.com/kylebrodeur/agent-workspace-kit
cd agent-workspace-kit
node --version          # needs node 24 or later
npm test
```

```text
# tests 161
# pass 161
# fail 0
```

First command either way (the preflight is read-only):

```bash
teamctl check --root <team-repo>
```

## 2. Describe one team in one manifest

A team's manifest lives at `.pi-link/team.json` under the team repo's
root. The smallest complete one (one role; copy this):

```bash
mkdir -p my-team/.pi-link/profiles my-team/workspaces
cat > my-team/.pi-link/team.json <<'JSON'
{
  "version": 1,
  "team": { "name": "my-team", "group": "my-team" },
  "hub": { "role": "planner", "mode": "designated" },
  "node": ">=24",
  "roles": {
    "planner": {
      "profile": ".pi-link/profiles/planner.md",
      "model": "example-model-small",
      "cwd": ".",
      "sessionDir": ".agent-workspace/sessions/planner",
      "linkName": "planner"
    }
  }
}
JSON
cat > my-team/.pi-link/profiles/planner.md <<'MD'
---
name: planner
role: Coordinator
model: example-model-small
linkName: planner
---

You coordinate the lanes: keep peers unblocked, review finished work.
MD
```

The full field table (which fields must exist, which warn, which are
errors) is in [RUNBOOK.md](RUNBOOK.md). The rules worth knowing up
front: `cwd` must already exist; `sessionDir` need not (the launcher
creates it on first launch); `node` is the team's floor, written as
exactly `">=<major>"`.

## 3. Run the preflight

```bash
teamctl check --root my-team
```

```text
Team manifest valid: 1 roles, hub planner
WARN roles.planner.sessionDir does not exist yet (created on first launch): .agent-workspace/sessions/planner
```

Exit 0 with zero errors; the sessionDir warning is the normal
fresh-checkout state. `check` is strictly read-only. When the manifest
declares `hub.port` (and a hub answers on it), `check` also prints the
roster: `hub: <team> (port <port>)` and one line per terminal, names
only, nothing written.

## 4. Print the layout

```bash
teamctl layout --root my-team
```

```text
layout {
        pane name="planner: Coordinator" command="<abs-path-to-node>" cwd="<abs-path-to-my-team>" focus=true {
            args "<abs-path-to-kit>/bin/teamctl.mjs" "run" "planner"
        }
}
```

Every pane's `command` is the absolute Node binary that ran teamctl,
never the bare `node`: a lane runs on the same runtime as the launcher.
The hub pane carries `focus=true` because the manifest names the hub,
and the pane's name carries the role's title from the manifest
(`planner: Coordinator`). `--out FILE` writes the KDL instead of
printing it.

`teamctl start` additionally puts that binary's directory first on the
PATH it hands to zellij and the panes, so `node`, `npm`, and `npx`
inside a lane resolve to the same installation.

## 5. Start the session

With zellij installed (the one runtime dependency outside node):

```bash
teamctl start --root my-team
```

This preflights again (a red manifest stops before any pane exists),
checks the hub (a hub serving another team's terminals stops the launch
with the exact fix), creates any declared worktrees, regenerates every
selected role's prompt file from its current profile, generates the
filtered layout into `<team>/.agent-workspace/`, and runs
`zellij --layout <file> attach --create my-team`. One pane per role, the
hub pane focused.

## 6. Run one role without panes

```bash
teamctl run planner --root my-team
```

Same restart loop, same crash guard, no multiplexer. A `.stop` sentinel
in the role's session dir stops the loop; a `.reset` sentinel starts the
next run fresh.

## 7. Run a command under the team tests lock

```bash
teamctl tests --root my-team npm test
```

One full command per team root at a time (default wait 60 seconds):
this is how two teams, or two agents, share one machine without stacking
concurrent full-suite runs. See [RUNBOOK.md](RUNBOOK.md#teamctl-tests-command)
for the lock file shape and the wait error.

## Where next

- Day-to-day operation: [how-to.md](how-to.md)
- Every flag, error string, and recovery procedure: [RUNBOOK.md](RUNBOOK.md)
- Moving an existing setup onto a newer release: [UPGRADING.md](UPGRADING.md)
- The runnable example (captured output): [../examples/README.md](../examples/README.md)