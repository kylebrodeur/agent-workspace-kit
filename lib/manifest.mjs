// The team manifest: load and validate `.pi-link/team.json`.
//
// The manifest is the single description of the team. Validation is the
// preflight: it runs BEFORE any pane is created, so "a pane died on
// startup because a profile went missing" becomes a clear failure before
// any pane exists.
//
// Field rules (mirroring pi-link's team-config validation, which is the
// proven behavior):
//   version        must be 1
//   team.name      required
//   team.group     required
//   roles          at least one
//   hub.role       required, must name a configured role
//   profile        required file, repo-relative
//   prompt, config optional files, must exist when declared
//   cwd            optional dir, MUST already exist
//   sessionDir     optional dir, need not exist (created on first launch)
//   linkName       optional string, unique across roles
//   skills.required  missing id is an ERROR
//   skills.optional  missing id is a WARNING
//   tools          declared intent only; never granted
// Every path is repo-relative: a manifest never carries an absolute path
// that works on one machine only.
//
// Errors and warnings are collected, never thrown: a preflight reports its
// full finding list in one pass. Only genuinely unreadable files surface
// as errors.
import { join, relative, isAbsolute } from "node:path";
import { readFileSync, statSync } from "node:fs";

import { SKILL_ROOTS, existsPath, existingDirIds, profileFrontmatter, skillIdsByRoot } from "./inventory.mjs";

export const MANIFEST_DIR = ".pi-link";
export const MANIFEST_NAME = "team.json";

export function defaultManifestPath(root) {
  return join(root, MANIFEST_DIR, MANIFEST_NAME);
}

export function loadManifest(root, manifestPath = defaultManifestPath(root)) {
  const data = readFileUtf8(manifestPath);
  if (data === null) {
    return {
      config: null,
      errors: [`no team manifest at ${manifestPath}`],
      warnings: [],
      manifestPath,
    };
  }
  let config;
  try {
    config = JSON.parse(data);
  } catch (error) {
    return {
      config: null,
      errors: [`team manifest is not valid JSON: ${error.message}`],
      warnings: [],
      manifestPath,
    };
  }
  const { errors, warnings } = validate(config, inventoryFor(root, config));
  return { config, errors, warnings, manifestPath };
}

function readFileUtf8(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function validate(config, inventory) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    errors.push("team manifest must be a JSON object");
    return { errors, warnings };
  }
  if (config.version !== 1) errors.push("team manifest version must be 1");
  if (!config?.team?.name) errors.push("team.name is required");
  if (!config?.team?.group) errors.push("team.group is required");
  if (!config?.roles || Object.keys(config.roles).length === 0) {
    errors.push("roles must contain at least one role");
  }
  if (!config?.hub?.role) {
    errors.push("hub.role is required");
  } else if (!config.roles?.[config.hub.role]) {
    errors.push(`hub.role "${config.hub.role}" does not name a configured role`);
  }

  for (const shadowed of shadowedSkillIds(inventory.skillsByRoot ?? [])) {
    warnings.push(
      `skill "${shadowed.id}" appears in ${shadowed.roots.length} skill roots, so an installed copy may shadow source edits: ${shadowed.roots.join(", ")}`,
    );
  }

  const linkNames = new Map();
  const sessionDirs = new Map();
  for (const [name, role] of Object.entries(config?.roles ?? {})) {
    if (!role || typeof role !== "object") {
      errors.push(`roles.${name} must be an object`);
      continue;
    }
    if (!role.profile) errors.push(`roles.${name}.profile is required`);
    else if (!checkRepoRelative(errors, `roles.${name}.profile`, role.profile)) {
      // path shape error already recorded
    } else if (!inventory.existingPaths.has(role.profile)) {
      errors.push(`roles.${name}.profile is missing: ${role.profile}`);
    } else if (inventory.profileModels?.has(role.profile)) {
      const profileModel = inventory.profileModels.get(role.profile);
      if (role.model && profileModel && role.model !== profileModel) {
        warnings.push(
          `roles.${name}.model "${role.model}" overrides the profile's declared "${profileModel}", so the manifest value is what launches`,
        );
      }
    }
    for (const key of ["prompt", "config"]) {
      if (!role[key]) continue;
      if (!checkRepoRelative(errors, `roles.${name}.${key}`, role[key])) continue;
      if (!inventory.existingPaths.has(role[key])) {
        errors.push(`roles.${name}.${key} is missing: ${role[key]}`);
      }
    }
    if (role.cwd) {
      if (checkRepoRelative(errors, `roles.${name}.cwd`, role.cwd) && !inventory.existingDirs.has(role.cwd)) {
        errors.push(`roles.${name}.cwd is not an existing directory: ${role.cwd}`);
      }
    }
    if (role.sessionDir) {
      if (
        checkRepoRelative(errors, `roles.${name}.sessionDir`, role.sessionDir) &&
        !inventory.existingDirs.has(role.sessionDir)
      ) {
        warnings.push(
          `roles.${name}.sessionDir does not exist yet (created on first launch): ${role.sessionDir}`,
        );
      }
      const previous = sessionDirs.get(role.sessionDir);
      if (previous) {
        errors.push(
          `roles.${name}.sessionDir is shared with roles.${previous}: ${role.sessionDir}`,
        );
      } else {
        sessionDirs.set(role.sessionDir, name);
      }
    }
    if (role.linkName) {
      const previous = linkNames.get(role.linkName);
      if (previous) {
        errors.push(`roles.${name}.linkName duplicates roles.${previous}: ${role.linkName}`);
      } else {
        linkNames.set(role.linkName, name);
      }
    }
    if (role.skills) {
      if (typeof role.skills !== "object" || Array.isArray(role.skills)) {
        errors.push(`roles.${name}.skills must be an object with required and optional arrays`);
      } else {
        for (const skill of role.skills.required ?? []) {
          if (!inventory.skillIds.has(skill)) {
            errors.push(`roles.${name}.skills.required references missing skill: ${skill}`);
          }
        }
        for (const skill of role.skills.optional ?? []) {
          if (!inventory.skillIds.has(skill)) {
            warnings.push(`roles.${name}.skills.optional references missing skill: ${skill}`);
          }
        }
      }
    }
    if (role.tools !== undefined) {
      if (
        typeof role.tools !== "object" ||
        role.tools === null ||
        Array.isArray(role.tools) ||
        !Object.values(role.tools).every(
          (list) => Array.isArray(list) && list.every((item) => typeof item === "string"),
        )
      ) {
        errors.push(
          `roles.${name}.tools must be an object whose values are arrays of strings: ${JSON.stringify(role.tools)}`,
        );
      }
    }
  }
  return { errors, warnings };
}

// A path field must be repo-relative. Absolute paths are repo-side errors:
// they work on one machine only. POSIX paths starting with / (or a drive
// letter on Windows) fail here.
function checkRepoRelative(errors, what, value) {
  if (typeof value !== "string") {
    errors.push(`${what} must be a repo-relative path: ${JSON.stringify(value)}`);
    return false;
  }
  if (isAbsolute(value) || value.startsWith("~/")) {
    errors.push(`${what} must be a repo-relative path: ${value}`);
    return false;
  }
  return true;
}

function shadowedSkillIds(skillsByRoot) {
  const seen = new Map();
  for (const { root, ids } of skillsByRoot) {
    for (const id of ids) {
      if (!seen.has(id)) seen.set(id, []);
      seen.get(id).push(root);
    }
  }
  const out = [];
  for (const [id, roots] of seen) {
    if (roots.length > 1) out.push({ id, roots });
  }
  return out;
}

export function inventoryFor(root, config) {
  const existingPaths = new Set();
  const existingDirs = new Set();
  const roles = config?.roles ?? {};
  const relCandidates = ["."];
  for (const role of Object.values(roles)) {
    for (const key of ["profile", "prompt", "config", "cwd", "sessionDir"]) {
      if (typeof role?.[key] === "string" && !isAbsolute(role[key])) {
        relCandidates.push(role[key]);
      }
    }
  }
  for (const relPath of new Set(relCandidates)) {
    if (existsPath(root, relPath)) {
      existingPaths.add(relPath);
      if (isDirPath(root, relPath)) existingDirs.add(relPath);
    }
  }
  // The manifest itself counts as existing (its dir is a valid cwd target).
  const profileModels = new Map();
  for (const role of Object.values(roles)) {
    if (typeof role?.profile !== "string" || isAbsolute(role.profile)) continue;
    if (!existsPath(root, role.profile)) continue;
    const fm = profileFrontmatter(join(root, role.profile));
    if (fm.model) profileModels.set(role.profile, fm.model);
  }
  return {
    existingPaths,
    existingDirs,
    skillIds: existingDirIds(root),
    skillsByRoot: skillIdsByRoot(root),
    profileModels,
    skillRoots: SKILL_ROOTS,
  };
}

function isDirPath(root, relPath) {
  try {
    return statSync(join(root, relPath)).isDirectory();
  } catch {
    return false;
  }
}

export { relative };