<!-- STATUS: VERIFIED 2026-10-31 from a real run of this checkout. The personal node path and sandbox dirs are trimmed to placeholders; the shape is the contract. -->
# The runnable example

No agent is launched and no zellij is required: the example validates a
demo team manifest and generates its Zellij layouts, which is everything
the kit does before a real pane exists.

Run it from the repo root:

```bash
sh examples/run-demo.sh
```

`examples/demo-team/` is the demo team: a manifest at the canonical
`.pi-link/team.json` path, plus one profile per role. The manifest
carries the role, profile, model, cwd, sessionDir, linkName, the team's
`node` floor (`>=24`), `hub.port`, the planner's `firstTurn` bootstrap
note, and the builder's `args` (`--no-lsp` here, any omp flags a lane
needs there).

Captured output from a real run (absolute paths trimmed):

```text
== teamctl check (both session dirs exist, so zero warnings) ==
Team manifest valid: 2 roles, hub planner
WARN roles.builder.skills.optional references missing skill: team-workflow
exit=0

== teamctl layout --roles planner,builder (hub focused) ==
layout {
    pane split_direction="vertical" {
        pane name="planner: Coordinator" command="<node24>/bin/node" cwd="<sandbox>/repo" focus=true {
            args "<repo>/agent-workspace-kit/bin/teamctl.mjs" "run" "planner"
        }
        pane name="builder: Builder" command="<node24>/bin/node" cwd="<sandbox>/repo" {
            args "<repo>/agent-workspace-kit/bin/teamctl.mjs" "run" "builder"
        }
    }
}

== teamctl layout --roles builder (single pane, no wrapper) ==
layout {
        pane name="builder: Builder" command="<node24>/bin/node" cwd="<sandbox>/repo" {
            args "<repo>/agent-workspace-kit/bin/teamctl.mjs" "run" "builder"
        }
}
exit=0

== teamctl check on a fresh checkout (session dirs missing: warnings, not errors) ==
Team manifest valid: 2 roles, hub planner
WARN roles.planner.sessionDir does not exist yet (created on first launch): sessions/planner
WARN roles.builder.sessionDir does not exist yet (created on first launch): sessions/builder
WARN roles.builder.skills.optional references missing skill: team-workflow
exit=0
```

What to notice, in order:

1. The preflight passes with zero errors when the declared fields exist.
2. A missing optional skill is a WARNING, never an error.
3. Every pane's `command` is the ABSOLUTE node binary that ran the
   launcher (shown as `<node24>`), never the bare `node`: a lane runs on
   the same runtime as the launcher. `teamctl start` also puts that
   binary's directory first on the panes' PATH.
4. The layout carries the manifest's role title in each pane name, and
   the hub's pane is the one with `focus=true`, because the manifest
   names the hub.
5. On a fresh checkout, missing sessionDirs are warnings ("created on
   first launch"), not errors: the launcher creates them. `cwd`, by
   contrast, must already exist. A declared `worktree` need not exist:
   `teamctl start` creates it.