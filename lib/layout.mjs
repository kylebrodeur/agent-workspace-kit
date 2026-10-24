// The Zellij layout: one pane per selected role, the hub pane focused.
//
// Generalization items 5 and 6 in one layer: the hub is NAMED BY THE
// MANIFEST (never a hardcoded role), and the layout is generated fresh
// from the selected roles per launch, with the manifest carrying every
// launch fact. The generator is a pure string function: no zellij is
// spawned here, so the layout can be tested (and printed by `teamctl
// layout --out -`) without a terminal multiplexer installed.
//
// Zellij is a different layer, not an integration (the pi-link lesson): a
// repo that depends on a KDL layout keeps it and adds the preflight. This
// generator is the kit's OWN layout lane for repos that launch through
// `teamctl start`.
import { resolve as resolvePath } from "node:path";

export function renderLayout(root, binPath, { roles, config, nodePath }) {
  const bin = resolvePath(root, binPath);
  const runtime = nodePath ?? process.execPath;
  const hubRole = config?.hub?.role ?? null;
  const lines = [];
  lines.push("layout {");
  if (roles.length === 1) {
    // The single-role layout is one pane, with no split wrapper. The
    // pane is still the hub's when the manifest names this role as the
    // hub, and a one-pane layout is exactly the case where the focus
    // matters: without it, the pane has no focus at all, and Zellij
    // opens the layout with nothing focused.
    lines.push(
      ...paneLines(root, bin, runtime, roles[0], config, roles[0] === hubRole, "        "),
    );
  } else {
    lines.push('    pane split_direction="vertical" {');
    for (const role of roles) {
      lines.push(...paneLines(root, bin, runtime, role, config, role === hubRole, "        "));
    }
    lines.push("    }");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function paneLines(root, bin, nodePath, roleKey, config, focus, indent) {
  const role = config?.roles?.[roleKey] ?? {};
  const label = role.role ? `${roleKey}: ${role.role}` : roleKey;
  // The pane's working tree: a declared worktree IS the lane's cwd (the
  // same resolution roleArgv applies for the no-pane run mode). A
  // worktree and a cwd never combine; the preflight rejects that pair.
  const paneCwd = role.worktree ? resolvePath(root, role.worktree.path) : root;
  // command is the ABSOLUTE runtime binary, never the bare `node`: the
  // pane's Node is the one teamctl ran under, not whatever PATH resolves
  // when Zellij starts (the wrong-runtime trap from 2026-10-31).
  const attrs = [`name="${label}"`, `command="${nodePath}"`, `cwd="${paneCwd}"`];
  if (focus) attrs.push("focus=true");
  return [
    `${indent}pane ${attrs.join(" ")} {`,
    `${indent}    args "${bin}" "run" "${roleKey}"`,
    `${indent}}`,
  ];
}