#!/usr/bin/env node
// agent-workspace-kit CLI entry. Thin by contract: the runtime gate lives
// FIRST (an old Node never reaches mode dispatch; it reads one plain
// line and exits 1), then the mode boundary in lib/cli.mjs, and this
// file resolves the caller's argv and exits with the process exit code
// main() returns.
import { runtimeRequirementError } from "../lib/node-runtime.mjs";

const runtimeError = runtimeRequirementError();
if (runtimeError !== null) {
  process.stderr.write(runtimeError + "\n");
  process.exit(1);
}

const { main } = await import("../lib/cli.mjs");
const result = main(process.argv.slice(2));
process.exitCode = result instanceof Promise ? await result : result;