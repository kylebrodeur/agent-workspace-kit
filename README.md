# agent-workspace-kit

The manifest-driven multi-agent workspace launcher of the AI Engineering
Control Plane (AI ECP) family: one `team.json` describes a team of agent
roles, and the launcher reads it, validates it, and runs one agent per
pane in a Zellij session. `teamctl check` is the preflight; nothing
restates what the manifest already declares.

**First command:** `teamctl check` (see [docs/quickstart.md](docs/quickstart.md)).

## Family

This kit is a member of the AI Engineering Control Plane (AI ECP)
family: independent, single-purpose repos. Siblings:

- [ecp-toolkit](https://github.com/kylebrodeur/ecp-toolkit) (the `ecp`
  control-plane CLI).
- [repo-guards](https://github.com/kylebrodeur/repo-guards) (the `guv`
  repo-discipline gates).
- [actions-runner](https://github.com/kylebrodeur/actions-runner) (the
  `arun` local agent-pipeline runner).
- [agent-workspace-kit](https://github.com/kylebrodeur/agent-workspace-kit)
  (the manifest-driven role launcher for multi-agent teams).
- [docs-policy-kit](https://github.com/kylebrodeur/docs-policy-kit) (the
  `docpol` documentation policy engine).
- [op-safe](https://github.com/kylebrodeur/op-safe) (the `op://` secrets
  reference resolution).
- [anti-slop-kit](https://github.com/kylebrodeur/anti-slop-kit) (the
  vendored neutral lint policy).

## What it does

A role-specific team of `omp` sessions launches into one visible surface:
one pane per role, each with its own session dir, model, profile, and
link name. The launcher reads every launch fact from the manifest, so the
manifest cannot drift from what actually starts. Role selection
(`--roles`, `--fresh`), a crash guard on the per-role restart loop, and
the hub role's head start on the link hub are all manifest-driven
mechanisms, not product wiring.

```
teamctl check  [--root DIR] [--manifest PATH] [--json]
teamctl layout [--root DIR] [--roles a,b] [--out FILE]
teamctl run    ROLE [--root DIR] [--wait-seconds N]
teamctl start  [--root DIR] [--roles a,b] [--fresh[=a,b]]
```

`teamctl run` is the no-pane alternative (one process per role, no
tiling); Zellij is a different layer, not an integration. A repo that
depends on its own KDL layout keeps it and adds the preflight.

## Install

From a checkout (npm global install is PLANNED until the first release
tag):

```bash
node bin/teamctl.mjs check --root <team-repo>
# after an npm global install (PLANNED):
teamctl check --root <team-repo>
```

## In the family

agent-workspace-kit is the agent-team kit of the AI Engineering Control
Plane (AI ECP) family: independent, single-purpose repos. Siblings:
[repo-guards](https://github.com/kylebrodeur/repo-guards) (repo-discipline
guards),
[actions-runner](https://github.com/kylebrodeur/actions-runner) (the
deterministic agent-pipeline runner),
[omp-rpc-cli](https://github.com/kylebrodeur/omp-rpc-cli) (persistent `omp`
RPC sessions driven by an agent),
[ecp-toolkit](https://github.com/kylebrodeur/ecp-toolkit) (the `ecp`
control-plane CLI),
[docs-policy-kit](https://github.com/kylebrodeur/docs-policy-kit) (the docs
policy engine), and
[op-safe](https://github.com/kylebrodeur/op-safe) (the secrets-first CLI
helper). The family standard:
the family documentation standard (in the private control-plane repo).
The kit consumes [`pi-link`](https://github.com/kylebrodeur/pi-link)
(MIT) for multi-terminal coordination and validates manifests against
the same field rules its `--team-check` enforces.

The team subsystem design (the two operating modes, the lessons, the
generalization checklist this kit implements) is
the team subsystem design (in the private control-plane repo). [llms.txt](llms.txt) is the
map of this repo's docs for agents.

Where to read next: day-to-day tasks in [docs/how-to.md](docs/how-to.md),
the full command surface with every error string in
[docs/RUNBOOK.md](docs/RUNBOOK.md), agent rules in
[AGENTS.md](AGENTS.md).

Verified 2026-10-22 (81 tests passing; see CONTRIBUTING.md for the commands).