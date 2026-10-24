// Role selection: which manifest roles run, and which get reset fresh.
//
// Both lists are generic role selection (generalization item 7): the valid
// set is the manifest's role keys, in manifest order, and the launcher
// never carries its own roster.
export const USAGE_EXIT = 64;

export class RoleSelectionError extends Error {}

function parseList(value, what, allRoles) {
  if (value === undefined || value === null) return [];
  const items = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    throw new RoleSelectionError(`error: --${what} must select at least one role`);
  }
  for (const item of items) {
    if (!allRoles.includes(item)) {
      throw new RoleSelectionError(
        `error: unknown role '${item}'. Valid: ${allRoles.join(", ")}`,
      );
    }
  }
  return items;
}

// config: a validated manifest config. options: { roles?, fresh? } where
// `roles` is the --roles list and `fresh` is `true` (bare --fresh) or the
// --fresh role list. Returns { selected, reset }.
export function selectRoles(config, options = {}) {
  const allRoles = Object.keys(config?.roles ?? {});
  if (allRoles.length === 0) {
    throw new RoleSelectionError("error: the manifest declares no roles");
  }

  let selected = allRoles;
  if (options.roles !== undefined && options.roles !== null) {
    selected = parseList(options.roles, "roles", allRoles);
  }
  if (selected.length === 0) {
    throw new RoleSelectionError("error: --roles must select at least one role");
  }

  let reset = [];
  if (options.fresh !== undefined && options.fresh !== null && options.fresh !== false) {
    // A list replaces the selection; a bare --fresh resets what runs.
    reset = options.fresh === true ? [...selected] : parseList(options.fresh, "fresh", allRoles);
    selected = [...reset];
  }

  return { selected, reset };
}