# Contributing

How to set up the repo, run the tests, and open a change.

## Set up

Node 20 or later; nothing else. The kit has zero runtime dependencies:

```bash
git clone https://github.com/kylebrodeur/agent-workspace-kit
cd agent-workspace-kit
npm test
```

Zellij is needed only for `teamctl start` (and no test needs it: the
tests stub it with a fake on a stub PATH).

## Run the tests

```bash
npm test
```

Expected output: `81 passed` (check date: 2026-10-22). Every test is
offline: manifest worlds live in `mktemp` sandboxes, the fake zellij is
a shell script on a stub PATH, and no agent binary is ever launched.

## The prose gate

```bash
sh scripts/prose-gate.sh
```

Expected: `prose-gate: ok`. It scans every tracked markdown file for em
or en dashes and the four banned AI-slop words, fail-closed. Fix the
prose, never the gate.

## Verify the documentation

The repo belongs to the AI ECP documentation family. Run these before any
commit that adds or moves a doc:

```bash
npm test
npm run prose-gate
```

Those commands print node's test output and the prose-gate result, not
`agent-workspace-kit:` lines. The family harness that prints those lines
checks the required doc files, README link resolution, the prose gates,
funding parity, and the member artifacts (examples and tests). It lives
in the PRIVATE system repo and is maintainer-only; a public contributor
runs the commands above, and the family harness runs on the maintainer's
side.

Repo docs carry their check date; when you verify a claim about the
code, note the date in the doc.

## Open a change

1. Make the change, tests first where the change is behavior.
2. `npm test` and `sh scripts/prose-gate.sh` green.
3. If you touched a doc: the harness green, and the check date updated.
4. Open a pull request. Keep the diff one boundary: the manifest schema,
   the mode surface, the crash-guard constants, and the layout shape are
   contract surfaces. A change to one comes with a RUNBOOK section
   naming the new law.

## Ground rules

- The manifest is the single description of a team; the launcher reads
  it and never restates a role's facts (see AGENTS.md rule 1).
- Stdlib only: a runtime dependency needs a written reason, not
  convenience.
- No product strings, no secret handling, no absolute paths in shipped
  code or docs.
- Fail closed: unknown manifest shapes and unknown tool data are errors
  naming the field, never skipped.

## What makes a good change here

The kit's value is being boring: a manifest that can launch, a guard
that stops a crash loop, a layout that reads exactly like the team it
describes. A PR that changes measured behavior (guard constants, launch
fact source, read-only guarantees) without operating evidence in the
description is not merged. Extension belongs in new modes or manifest
fields the validator documents; not in bypassing the preflight.