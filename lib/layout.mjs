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

export function renderLayout(root, binPath, { roles, config }) {
  const bin = resolvePath(root, binPath);
  const hubRole = config?.hub?.role ?? null;
  const lines = [];
  lines.push("layout {");
  if (roles.length === 1) {
    lines.push(...paneLines(root, bin, roles[0], config, false, "        "));
  } else {
    lines.push('    pane split_direction="vertical" {');
    for (const role of roles) {
      lines.push(...paneLines(root, bin, role, config, role === hubRole, "        "));
    }
    lines.push("    }");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function paneLines(root, bin, roleKey, config, focus, indent) {
  const role = config?.roles?.[roleKey] ?? {};
  const label = role.role ? `${roleKey}: ${role.role}` : roleKey;
  const attrs = [`name="${label}"`, 'command="node"', `cwd="${root}"`];
  if (focus) attrs.push("focus=true");
  return [
    `${indent}pane ${attrs.join(" ")} {`,
    `${indent}    args "${bin}" "run" "${roleKey}"`,
    `${indent}}`,
  ];
}