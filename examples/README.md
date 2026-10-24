<!-- STATUS: VERIFIED 2026-10-22. The output below is captured verbatim from `sh examples/run-demo.sh` (a real run of this checkout). Sandbox paths differ per run; the shape is the contract. -->
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
carries the role, profile, model, cwd, sessionDir, linkName, the
planner's `firstTurn` bootstrap note, and the builder's `args`
(`--no-lsp` here, any omp flags a lane needs there).

Captured output from a real run:

```text
== teamctl check (both session dirs exist, so zero warnings) ==
Team manifest valid: 2 roles, hub planner
WARN roles.builder.skills.optional references missing skill: team-workflow
exit=0

== teamctl layout --roles planner,builder (hub focused) ==
layout {
    pane split_direction="vertical" {
        pane name="planner: Coordinator" command="node" cwd="<sandbox>/repo" focus=true {
            args "<repo>/bin/teamctl.mjs" "run" "planner"
        }
        pane name="builder: Builder" command="node" cwd="<sandbox>/repo" {
            args "<repo>/bin/teamctl.mjs" "run" "builder"
        }
    }
}

== teamctl layout --roles builder (single pane, no wrapper) ==
layout {
        pane name="builder: Builder" command="node" cwd="<sandbox>/repo" {
            args "<repo>/bin/teamctl.mjs" "run" "builder"
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

(The absolute paths are trimmed to `<sandbox>` / `<repo>`; the real run
carries the mktemp dir and the checkout's absolute bin path.)

What to notice, in order:

1. The preflight passes with zero errors when the declared fields exist.
2. A missing optional skill is a WARNING, never an error.
3. The layout carries the manifest's role title in each pane name, and
   the hub's pane is the one with `focus=true`, because the manifest
   names the hub.
4. On a fresh checkout, missing sessionDirs are warnings ("created on
   first launch"), not errors: the launcher creates them. `cwd`, by
   contrast, must already exist.