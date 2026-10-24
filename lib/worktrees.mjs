// The per-role git worktrees: every DECLARED lane works in its own
// working tree, so one lane's `git add -A` can never sweep in a sibling's
// staged files (the 2026-10-31 handoff: a commit did that twice, in both
// directions).
//
// `ensureWorktrees` is the only mechanism: `start` calls it after the
// preflight and role selection, before the layout is written. The rules,
// checked against REAL git (the contract is git's own):
//
//   - `git worktree add <path> -b <branch>` when the branch is new
//   - `git worktree add <path> <branch>` when the branch exists
//   - reuse when the path exists AND is a worktree whose branch matches
//   - a path that exists and is NOT a git worktree is an error (fail
//     closed: never delete operator files)
//
// Manifest validation (lib/manifest.mjs) rejects the bad shapes before
// this runs: a `worktree` object needs repo-relative `path` and `branch`
// strings, may not share `path` or `branch` with another role, may not
// pair with `cwd` on one role, and its path must stay inside the root.
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { spawnSync } from "node:child_process";

// The default runner anchors at the TEAM ROOT: `git worktree add` runs
// against the repo that owns the worktree, never against whatever
// directory the process happens to sit in (a cwd-anchored run registers
// the worktree in the WRONG repo).
function systemRunGit(root) {
  return (args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

export function ensureWorktrees(root, config, roleKeys, { runGit } = {}) {
  const git = runGit ?? systemRunGit(root);
  const results = [];
  for (const roleKey of roleKeys) {
    const role = config?.roles?.[roleKey] ?? {};
    if (!role.worktree) continue;
    const path = resolvePath(root, role.worktree.path);
    const branch = role.worktree.branch;
    if (existsSync(path)) {
      assertWorktree(git, root, path, branch, role.worktree.path);
      results.push({ roleKey, path, branch, created: false });
      continue;
    }
    mkdirSync(resolvePath(root, role.worktree.path, ".."), { recursive: true });
    // The branch may exist already (a previous run created it): adding a
    // worktree with -b on an existing branch fails, so probe first.
    const branchExists = git(["rev-parse", "--verify", "--quiet", `${branch}`]).status === 0;
    const args = branchExists
      ? ["worktree", "add", path, branch]
      : ["worktree", "add", path, "-b", branch];
    const added = git(args);
    if (added.status !== 0) {
      throw new Error(
        `git worktree add failed for role ${roleKey} (${branch} in ${role.worktree.path}): ${added.stderr.trim()}`,
      );
    }
    results.push({ roleKey, path, branch, created: true });
  }
  return results;
}

// A path that exists must BE the right worktree: its worktree HEAD must
// name this role's branch. Anything else is an operator file this kit
// refuses to destroy.
function assertWorktree(runGit, root, path, branch, relPath) {
  // rev-parse alone cannot tell "a worktree HERE" from "a plain dir
  // inside the main repo" (both answer via upward lookup): the working
  // TREE ROOT must be path itself, and the HEAD branch must be this
  // role's branch.
  const toplevel = runGitInside(runGit, path, "rev-parse", "--show-toplevel");
  if (toplevel === false || realPath(toplevel.trim()) !== realPath(path)) {
    throw new Error(
      `role's worktree path exists but is not a git worktree: ${relPath}; move or remove it yourself - the kit never deletes operator files`,
    );
  }
  const inside = runGitInside(runGit, path, "rev-parse", "--abbrev-ref", "HEAD");
  if (inside === false) {
    throw new Error(
      `role's worktree path exists but is not a git worktree: ${relPath}; move or remove it yourself - the kit never deletes operator files`,
    );
  }
  const current = typeof inside === "string" ? inside.trim() : "";
  if (current !== branch) {
    throw new Error(
      `role's worktree path exists but points at ${current}, not the declared ${branch}: ${relPath}; fix the manifest or the worktree yourself`,
    );
  }
}

// macOS TMPDIR is a symlinked path (/var vs /private/var): git answers in
// realpaths, so the comparison resolves both sides.
function realPath(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolvePath(p);
  }
}

// runGit receives args resolved against the TEAM root (git -C root ... in
// the tests); the worktree probe needs its own cwd, so the probe runs a
// one-off `git -C <worktree> ...` through the same runner.
function runGitInside(runGit, cwd, ...args) {
  const probe = runGit(["-C", cwd, ...args]);
  return probe.status === 0 ? probe.stdout : false;
}
