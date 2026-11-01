<!-- STATUS: VERIFIED 2026-10-31 against the shipped v0.2.0 behavior (the exact error strings are quoted from lib/*.mjs and were captured live). -->
# UPGRADING.md: moving an existing setup to a new release

The upgrade unit is the release TAG. An upgrade is a pin-bump plus a
state check, never a re-setup: your manifest, profiles, and local state
are the tracked files that matter, and the new code validates them.

## From v0.1.0 to v0.2.0

v0.2.0 adds the runtime contract, worktrees, hub identity, prompt
regeneration, and the tests lock. Nothing it adds removes a v0.1.0
field; everything new is off until declared.

### 1. The install

v2.0 refuses a Node older than 24 at its own boundary, before any mode:

```text
error: agent-workspace-kit requires Node >=24; running v22.23.2
```

A v0.1.0 install was typically global under a version-scoped nvm prefix
(`~/.nvm/versions/node/vX/lib/node_modules/agent-workspace-kit`), so
switching nvm makes the binary disappear. Replace it with the fixed
user prefix (independent of the active nvm version):

```bash
mkdir -p "$HOME/.local/npm-global"
npm install --global --prefix "$HOME/.local/npm-global" \
  "github:kylebrodeur/agent-workspace-kit#v0.2.0"
export PATH="$HOME/.local/npm-global/bin:$PATH"
```

Put the `export PATH` line in your shell profile. Check the result:

```bash
node --version          # >= 24 first on PATH
which -a teamctl        # the fixed prefix's bin first
teamctl check --root <team-repo>
```

### 2. The manifest

No field changes meaning. The new optional fields:

- `node` (team floor): the exact shape `">=<major>"` (one decimal,
  no spaces). Unset means only the package's own floor applies. Set,
  it is checked against the RUNNING teamctl in every mode that loads
  the manifest. Adding it on upgrade is a decision, not a migration
  step.
- `hub.port` (integer 1-65535): where this team's hub lives.
  Resolution order is manifest `hub.port`, then `$PI_LINK_PORT`, then
  9900. The limitation, plainly: the current pi-link extension binds
  9900 and ignores `PI_LINK_PORT`, so a set port takes effect only
  when the installed extension honors it; the kit already writes and
  reads the env var.

The compatibility proof is the preflight on your UNTOUCHED manifest:

```bash
teamctl check --root <team-repo>
```

Exit 0 with the same warning set as before means compatible. Any new
error names its field and fix.

### 3. What start regenerates (nothing to migrate)

- **Layouts.** The generated `.agent-workspace/<team>.kdl` is rewritten
  on every start, now with the absolute node binary as each pane's
  command (never the bare `node`) and a worktree role's path as its
  pane cwd. Delete a stale file hand-written tooling might read; start
  overwrites it anyway.
- **Lane prompts.** Every selected role's prompt file rebuilds from its
  current profile on every start. A role that declares its own `prompt`
  file still resolves to that file (and is not rewritten).

### 4. A live team: the identity change

Under v0.2.0, a role without `linkName` launches as
`<roleKey>@<team.group>`. Two consequences:

- Lanes running under v0.1.0 hold the OLD identity (the bare role key)
  for as long as they run. Restart the team to take the new default
  names; do not mix live lanes across versions.
- An explicitly declared `linkName` stays exactly as declared.

The restart, in order:

```bash
zellij kill-session <team> 2>/dev/null || true
touch <team>/.agent-workspace/sessions/<lane>/.stop   # once per lane to stop loops
sleep 2                                               # let the loops drain
rm -f <team>/.agent-workspace/sessions/<lane>/.stop
teamctl start --root <team-repo>                      # regenerates prompts + layout
```

Nothing of yours is lost: prompts rebuild from profiles, history lives
in the session dirs, and the manifest is unchanged.

### 5. Worktrees: opt-in, per lane

v0.1.0 teams upgrade to shared-working-tree behavior unchanged.
Declaring a worktree is opt-in per role:

```json
"builder": {
  "profile": ".pi-link/profiles/builder.md",
  "worktree": { "path": "worktrees/builder", "branch": "lane/builder" }
}
```

Rules the preflight enforces: repo-relative path and branch, unique
across roles, not combined with `cwd`, path inside the team root.
`teamctl start` creates it (`git worktree add`, new branch or an
existing one), reuses a worktree whose branch matches, and refuses to
touch an existing path that is NOT the declared worktree (the kit never
deletes operator files). `teamctl run <role>` runs in the worktree and
fails closed when it is missing. The generated lane prompt carries the
worktree discipline section: commit only your files with explicit
`git commit -- <paths>`, never a bare `git add -A`.

### 6. The tests lock: inert until used

`<root>/.agent-workspace/tests.lock` appears only when `teamctl tests`
runs. Two teams (or two agents) that run full suites against one
machine start taking it:

```bash
teamctl tests --root <team-repo> npm test
```

Default wait 60 seconds (`--wait-seconds N`, or `TEST_WAIT_SECONDS`);
a lock whose holder pid is dead is replaced automatically; expiry
prints `error: tests lock held by another run: <path> (waited <N>s)`.

## The ordered upgrade, summarized

```bash
# 1. read every release note between your pin and the target
#    (the kit's GitHub releases page)
# 2. bump the pin (the fixed prefix above), PATH export in the profile
# 3. preflight the untouched state
teamctl check --root <team-repo>
# 4. run your own suite; the kit's own suite runs offline too
# 5. restart the live team only after step 3 exits 0
```

## What NOT to do

- Do not re-run any v0.1.0 setup script "to be safe": the manifest is
  the state, and a setup script is not idempotent against a new
  version.
- Do not migrate generated files by hand. Regenerate or delete them.
- Do not rename a declared `linkName` to the new group-suffixed default
  while its peers are live; the suffixed default applies to roles that
  declare nothing.
- Do not keep a version-scoped nvm global install and a fixed-prefix
  install both on PATH at once; `which -a teamctl` tells you which one
  resolves first, and the fixed prefix should.