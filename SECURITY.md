# Security policy

## Supported versions

One release line is supported at a time: the latest tag on the default
branch. Older tags receive no security patches; upgrade before reporting
a version-specific issue.

## Reporting a vulnerability

Open a GitHub security advisory on this repository ("Report a
vulnerability" under the Security tab). Do not open a public issue for a
security problem: the advisory keeps it out of search until it is fixed.

Include:

- the affected paths (`lib/` module names) and, where known, the
  function or code path
- the manifest shape or command line that triggers it
- the impact you believe it has

## What is in scope

- anything that executes manifest data as more than data: a team.json
  must never gain code execution over the caller (the layout generator
  interpolates values into a KDL string; an argv array must stay an argv
  array and never a shell string)
- sentinel-file handling defects in `lib/terminal.mjs`: `.stop` /
  `.reset` consumption must remove only the kit's own sentinels inside
  the declared sessionDir
- path-resolution defects in `lib/inventory.mjs` / `lib/manifest.mjs`:
  a repo-relative field escaping the team root (a `..` traversal) or
  resolving through a symlink outside it in a way the preflight would
  validate as inside
- subprocess handling in `lib/cli.mjs`: argv construction from manifest
  fields must never inject into a shell (no `shell: true` anywhere)

## What is out of scope

- the agents the kit launches: `omp` is the harness behind each pane;
  report its defects upstream (github.com/kylebrodeur/omp-rpc-cli is a
  sibling, not the same product)
- the link hub's own protocol (pi-link drives it; report there)
- zellij multiplexer defects: report to the zellij project
- the crash guard's regex-free design: it counts runs and stops; there
  is no policy language to bypass

## Handling

Reports are acknowledged within a week. Fixes land with a test that
reproduces the report, and the advisory is published when the fix is
tagged.