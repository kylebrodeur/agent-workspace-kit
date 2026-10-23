# AGENTS.md: the boundary of this repo, stated as rules

An agent working inside `agent-workspace-kit/` obeys these rules. They are
the contract; everything else in the docs is detail.

## What this repo is

The manifest-driven multi-agent workspace launcher: one `.pi-link/team.json`
describes a team of agent roles, and `teamctl` validates that manifest
(`check`), renders the team's Zellij layout (`layout`), runs one role
without panes (`run`), and launches the team in panes (`start`). The
launch facts come from the manifest; the library modules in `lib/` are
manifest load + validation, role selection, the crash guard, the layout
generator, and the per-role terminal runner.

## Rules an agent keeps here

1. **The manifest is the single description of the team.** A launcher
   that restates a role's model, cwd, profile, sessionDir, config, or
   linkName is a second description, and the two will disagree (a real
   lane ran on a 19-byte stub prompt for months because of exactly
   that). `lib/terminal.mjs` reads these fields; never add a `case`
   block that hardcodes one.
2. **Preflight before any pane.** `start` runs the full preflight BEFORE
   role selection and BEFORE anything writes. A red manifest must stop
   the launch before zellij runs; never reorder that.
3. **Read-only modes never write.** `check` never writes a byte.
   `layout` writes only with `--out`. If a new flag would make `check`
   stateful, it is a new mode, not a flag.
4. **`cwd` must already exist; `sessionDir` need not.** Launchers create
   the session dir (`mkdir -p`) before first use, so a missing one is
   normal on a fresh checkout and warns rather than fails. Getting this
   backwards makes the preflight fail on a clean clone.
5. **Paths are repo-relative.** Every manifest path resolves against the
   team root; an absolute path is a preflight ERROR, not a convenience.
6. **No product strings anywhere.** No team name, role name, model id,
   profile path, or prompt text from any specific project. The manifest
   carries them; the kit reads them. Grep the repo before publishing
   anything.
7. **No key or secret handling in code.** A lane's credentials are the
   operator's environment or the omp session config the manifest
   declares. The kit exports none, reads none, and never carries a
   `.env` path.
8. **The crash guard constants are measured, not preferences.** The 3s
   floor, the 5-crash count, and the 60s window survived real loops. A
   change needs operating evidence in the change description; they are
   also not manifest data.
9. **Fail closed on unknown data.** A manifest field the validator does
   not recognize as valid shape is an error naming it, never a silently
   ignored key. Tools are declared intent; the kit grants nothing.
10. **Keep the docs honest per the family standard** (the
    documentation standard in the private control-plane repo): real
    commands with captured output, errors carrying their fix, no em or
    en dashes, no AI-slop words, no personal identifiers, and check dates
    on factual claims. Run the suite:
    `npm test` and `npm run prose-gate`
    and require every `agent-workspace-kit:` line to read PASS.
11. **Tests are contracts, run without real agents.** Manifest
    validation, role selection, the crash guard, and layout generation
    all test offline. A change to any of those surfaces lands with its
    test updated first.

## Where to start reading

`docs/quickstart.md` is the numbered path. `docs/RUNBOOK.md` indexes the
command surface and every error string. The skill in
`skills/agent-workspace-kit/SKILL.md` is the short form of rules 1
through 9.