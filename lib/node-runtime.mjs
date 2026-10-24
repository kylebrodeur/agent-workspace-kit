// The Node runtime contract: the kit runs on the Node its engines field
// names, and every pane gets the SAME runtime.
//
// Two jobs, both stdlib-only:
//
//   1. The startup check. `runtimeRequirementError(process.version)`
//      compares the running version with package.json's engines.node
//      BEFORE any mode dispatch, so an old Node fails with one plain
//      line instead of a syntax-error pile ("a lane silently on the
//      wrong Node" from the 2026-10-31 handoff).
//   2. The PATH helper. `pathWithRuntimeFirst` puts the running Node's
//      directory first on a PATH string, so zellij's pane children
//      resolve the same `node` (and the same npm/npx beside it) that
//      launched the team.
//
// The version range is the canonical `>=<major>` form and nothing else:
// the family-supported shape, parsed by hand. Anything else fails
// CLOSED, because a range shape this kit cannot understand must not be
// read as "no requirement".
import { createRequire } from "node:module";
import { delimiter, dirname } from "node:path";
const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;

// nodeRangeError(version, range) -> string | null.
// version: the running Node's, "vMAJOR.MINOR.PATCH". range: the engines
// value, canonical ">=<major>". Null means supported.
export function nodeRangeError(version, range) {
  const rangeMatch = /^>=(\d+)$/.exec(String(range ?? ""));
  const versionMatch = SEMVER.exec(String(version ?? ""));
  if (!rangeMatch || !versionMatch) {
    // Fail closed with the same message shape, never a bare pass.
    return `error: agent-workspace-kit requires Node ${range}; running ${version}`;
  }
  const requiredMajor = Number(rangeMatch[1]);
  const runningMajor = Number(versionMatch[1]);
  if (runningMajor < requiredMajor) {
    return `error: agent-workspace-kit requires Node >=${requiredMajor}; running ${version}`;
  }
  return null;
}

// runtimeRequirementError(version = process.version) -> string | null.
// Reads engines.node from THIS package via createRequire, so the check
// cannot drift from the declared engines field.
export function runtimeRequirementError(version = process.version) {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json");
  return nodeRangeError(version, pkg?.engines?.node);
}

// pathWithRuntimeFirst(pathValue = process.env.PATH, execPath =
// process.execPath) -> string. The runtime's directory goes first,
// without duplicating an entry that is already there.
export function pathWithRuntimeFirst(pathValue = process.env.PATH ?? "", execPath = process.execPath) {
  const runtimeDir = dirname(execPath ?? "");
  const entries = String(pathValue ?? "").split(delimiter).filter((entry) => entry.length > 0);
  const kept = entries.filter((entry) => entry !== runtimeDir);
  return [runtimeDir, ...kept].join(delimiter);
}