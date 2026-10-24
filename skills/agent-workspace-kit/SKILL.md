---
name: agent-workspace-kit
description: Use when launching, validating, or extending a manifest-driven multi-agent Zellij team: writing or checking a team.json, selecting roles, wiring the preflight before panes, isolating lanes in worktrees, or generalizing a product-specific agent launcher into this kit's mechanisms.
---

# agent-workspace-kit skill: the manifest-driven team launcher

Use when a repo needs role-specific agent sessions running side by side
in one visible surface: one manifest describes the team, the launcher
reads it, and one pane per role comes up in Zellij.

## The rules

1. **One team, one manifest.** `.pi-link/team.json` is the single
   description of the team; it carries role, profile, model, cwd or
   worktree, sessionDir, config, and linkName per role. A launcher that
   restates any of those is a second description; the two disagree
   silently (the proven failure: a lane on a 19-byte stub prompt for
   months).
2. **`cwd` must already exist; `sessionDir` and `worktree` need not.**
   Launchers create the session dir before first use, so a missing one
   on a clean checkout warns rather than fails; `start` creates declared
   worktrees (`git worktree add`), and `run` fails closed on a missing
   worktree. A role carries `cwd` OR a `worktree`, never both.
3. **Paths are repo-relative.** Never an absolute path that works on one
   machine only.
4. **Preflight before any pane.** `teamctl check` validates the manifest
   against disk before `start` creates anything; a red manifest never
   reaches zellij. `check` and `layout` are read-only (layout writes only
   with `--out`); `--team`-style inspection never mutates.
5. **Role selection is generic.** `--roles a,b` and `--fresh[=a,b]` draw
   their valid set from the manifest's role keys, never a hardcoded
   roster.
6. **The hub starts first, by manifest name.** The hub role wins the
   link hub race because it does not wait; other roles wait briefly
   (`HUB_WAIT_SECONDS`, `0` disables). The hub is named in the manifest,
   never in code. A team's default link names are
   `<roleKey>@<team.group>`, so two teams never collide even on one
   shared hub, and `start`/`check` show the port's roster
   (`hub: <team> (port <port>)`) while refusing a foreign hub's roster.
7. **The runtime is a contract, not luck.** The launcher refuses a Node
   below `engines.node` with one plain line before any mode, panes get
   the absolute `process.execPath` as their command, and zellij's PATH
   puts that binary's directory first. A manifest `node: ">=24"` floor
   (exact shape `">=<major>"`) is checked against the running teamctl.
8. **One full test run per team root.** `teamctl tests` holds
   `<root>/.agent-workspace/tests.lock` (holder pid + start timestamp,
   taken by exclusive create); a stale holder is replaced, a live one
   fails after the wait with the exact error line.
9. **The crash guard is a net, not a sandbox.** A run under 3s is a
   crash; 5 crashes in 60s stop the restart loop with one clear line.
   Fix the launch facts; the constants are measured code, not manifest
   data.
10. **No products, no secrets in the kit.** Team names, role names,
    models, prompts, and key exports are operator or manifest concerns.
    The kit carries none.

## The commands

```bash
teamctl check  [--root DIR] [--manifest PATH] [--json]
teamctl layout [--root DIR] [--roles a,b] [--out FILE]
teamctl run    ROLE [--root DIR] [--wait-seconds N]
teamctl start  [--root DIR] [--roles a,b] [--fresh[=a,b]]
teamctl tests  [--root DIR] [--wait-seconds N] <command...>
```

From a checkout, run `node bin/teamctl.mjs` in place of `teamctl`.