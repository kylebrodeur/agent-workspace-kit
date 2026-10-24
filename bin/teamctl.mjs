#!/usr/bin/env node
// agent-workspace-kit CLI entry. Thin by contract: the boundary lives in
// lib/cli.mjs, this file resolves the caller's argv and exits with the
// process exit code main() returns.
import { main } from "../lib/cli.mjs";

process.exitCode = main(process.argv.slice(2));