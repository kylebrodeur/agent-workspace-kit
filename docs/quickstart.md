<!-- STATUS: VERIFIED 2026-10-22 against bin/teamctl.mjs, lib/*.mjs, and the captured example run (81 tests passing). -->
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

```bash
git clone https://github.com/kylebrodeur/agent-workspace-kit
cd agent-workspace-kit
node --version          # needs node 20 or later
```

Run the tests before anything else (they need no network and no agent):

```bash
npm test
```

```text
# tests 81
# pass 81
# fail 0
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
errors) is in [RUNBOOK.md](RUNBOOK.md). The one rule worth knowing up
front: `cwd` must already exist; `sessionDir` need not (the launcher
creates it on first launch).

## 3. Run the preflight

```bash
node bin/teamctl.mjs check --root my-team
```

```text
Team manifest valid: 1 roles, hub planner
WARN roles.planner.sessionDir does not exist yet (created on first launch): .agent-workspace/sessions/planner
```

Exit 0 with zero errors; the sessionDir warning is the normal
fresh-checkout state. `check` is strictly read-only.

## 4. Print the layout

```bash
node bin/teamctl.mjs layout --root my-team
```

```text
layout {
        pane name="planner" command="node" cwd="<abs-path-to-my-team>" focus=true {
            args "<abs-path-to-kit>/bin/teamctl.mjs" "run" "planner"
        }
}
```

The hub pane carries `focus=true` because the manifest names the hub.
`--out FILE` writes the KDL instead of printing it.

## 5. Start the session

With zellij installed (the one runtime dependency outside node):

```bash
node bin/teamctl.mjs start --root my-team
```

This preflights again (a red manifest stops before any pane exists),
generates the filtered layout into `<team>/.agent-workspace/`, and runs
`zellij --layout <file> attach --create my-team`. One pane per role, the
hub pane focused.

## 6. Run one role without panes

```bash
node bin/teamctl.mjs run planner --root my-team
```

Same restart loop, same crash guard, no multiplexer. A `.stop` sentinel
in the role's session dir stops the loop; a `.reset` sentinel starts the
next run fresh.

## What is PLANNED (not shipped)

**The npm global install is PLANNED, and it is not on npm yet.** The
kit installs from GitHub at a tag in the meantime:

```bash
npm i -g "github:kylebrodeur/agent-workspace-kit#v0.1.0"
```

Everything above runs today from a checkout. The family's one registry
entry is the control plane, `ecp-toolkit`; see the family's distribution
policy.

## Where next

- Day-to-day operation: [how-to.md](how-to.md)
- Every flag, error string, and recovery procedure: [RUNBOOK.md](RUNBOOK.md)
- The runnable example (captured output): [../examples/README.md](../examples/README.md)