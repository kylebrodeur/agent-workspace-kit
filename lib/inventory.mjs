// The launch inventory: what exists on disk relative to a repo root, and
// what a role's profile frontmatter declares.
//
// Frontmatter scalars are read by hand (key: value lines between two ---
// lines). JSON is the manifest format precisely so no parser dependency is
// needed; profile frontmatter keeps its YAML-shaped scalars, read by hand
// in the same spirit. A profile whose frontmatter is absent or malformed
// reads as nulls, not an error: the profile file itself still exists.
import { accessSync, constants, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// The skill roots pi-link discovers, in order. `.omp/skills` and
// `.agents/skills` are install roots (typically populated by a skill
// installer); `skills` is tracked source. The same id in two roots is the
// normal source-to-install relationship, reported as a shadow warning.
export const SKILL_ROOTS = [".omp/skills", ".agents/skills", "skills"];

export function existsPath(root, relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) return false;
  try {
    accessSync(resolve(root, relPath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function existingDirIds(root, skillRoots = SKILL_ROOTS) {
  const ids = new Set();
  for (const skillRoot of skillRoots) {
    collectSkillIds(join(root, skillRoot), ids);
  }
  return ids;
}

function collectSkillIds(dir, ids) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      ids.add(entry.name);
    }
  }
}

// The per-root skill ids, for the shadow warning: an id present in more
// than one root may shadow its source copy.
export function skillIdsByRoot(root, skillRoots = SKILL_ROOTS) {
  const byRoot = [];
  for (const skillRoot of skillRoots) {
    const ids = new Set();
    collectSkillIds(join(root, skillRoot), ids);
    byRoot.push({ root: skillRoot, ids });
  }
  return byRoot;
}

export function skillIds(root) {
  return existingDirIds(root);
}

// Hand-parsed frontmatter scalars: `name`, `role`, `model`, `linkName` and
// `description` (single-line values only). Returns null values when the
// file has no frontmatter or a key is absent.
export function profileFrontmatter(file) {
  const out = { name: null, description: null, role: null, model: null, linkName: null };
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return out;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return out;
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (key in out) out[key] = value;
  }
  return out;
}

// The body of a profile with its frontmatter stripped (the launcher passes
// it as the system prompt; frontmatter is harness metadata, not prose).
export function profileBody(file) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }
  return text;
}