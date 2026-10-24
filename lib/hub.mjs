// The per-team hub: which port this team's hub is on, and who is on it.
//
// The 2026-10-31 handoff: "the hub is the first process to bind port
// 9900", so two teams shared one link hub and a lane briefly messaged
// another team's advisor. Two fixes land here:
//
//   1. Link identity: a role's default link name becomes
//      "<roleKey>@<team.group>" (lib/terminal.mjs), so two teams' peers
//      never collide even when they share a hub.
//   2. Hub status: `start` refuses to launch into a port occupied by a
//      hub whose terminals are not this team's lanes (a foreign hub),
//      and `check` reports the roster read-only.
//
// The port is READ as: manifest hub.port, then PI_LINK_PORT, then 9900.
// The kit writes and reads the env var; whether the running pi-link
// extension honors PI_LINK_PORT is a property of the installed runtime,
// documented plainly in the RUNBOOK.
import { spawnSync } from "node:child_process";

import { DEFAULT_HUB_PORT } from "./terminal.mjs";

const STATUS_TIMEOUT_MS = 2000;

// resolveHubPort(config, env = process.env) -> number. Manifest
// hub.port wins; it is validated fail-closed. PI_LINK_PORT is
// second but only honors an integer 1-65535 (a malformed env value
// silently falls through, never crashes a start).
export function resolveHubPort(config, env = process.env) {
  const declared = config?.hub?.port;
  if (declared !== undefined && declared !== null) {
    if (!Number.isInteger(declared) || declared < 1 || declared > 65535) {
      throw new Error(`team.hub.port must be an integer 1-65535, got: ${JSON.stringify(declared)}`);
    }
    return declared;
  }
  const fromEnv = Number(env?.PI_LINK_PORT);
  if (Number.isInteger(fromEnv) && fromEnv >= 1 && fromEnv <= 65535 && String(env?.PI_LINK_PORT ?? "").trim() !== "") {
    return fromEnv;
  }
  return DEFAULT_HUB_PORT;
}

// The resolved port for a terminal-name roster check: the manifest may
// declare hub.port; the resolved value is what the team actually probes.
export function hubPortFromEnvResolvedArgs(config, env, port) {
  return port ?? resolveHubPort(config, env);
}

// hubStatus(port, fetchImpl, { timeoutMs, seen }) -> payload | null.
// fetchImpl is injected for tests; the CLI passes the global fetch. A
// validated payload's shape:
//   { team: string | null, sinceSeconds: number | null,
//     terminals: [{ name: string, status: string | null, sinceSeconds: number | null }, ...] }
// Anything that does not validate is null; `seen` records WHY ("refused",
// "timeout", "http", "unsupported") so the caller can distinguish no-hub
// from a wrong hub.
export async function hubStatus(port, fetchImpl, { timeoutMs = STATUS_TIMEOUT_MS, seen = null } = {}) {
  const note = (kind) => {
    if (typeof seen === "function") seen(kind);
  };
  let response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}/status`, {
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (error) {
    // A connection refused, a timeout, or an abort: no hub answer.
    note(error?.code === "ABORT_ERR" ? "timeout" : "refused");
    return null;
  }
  if (!response.ok) {
    note("http");
    return null;
  }
  let payload;
  try {
    const text = await response.text();
    payload = JSON.parse(text);
  } catch {
    note("unsupported");
    return null;
  }
  const validated = validateStatusPayload(payload);
  if (validated === null) {
    note("unsupported");
    return null;
  }
  return validated;
}

// validateStatusPayload(payload) -> normalized payload | null. A wrong
// shape is a wrong hub, not a pass.
export function validateStatusPayload(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const terminalsRaw = payload.terminals;
  if (!Array.isArray(terminalsRaw)) return null;
  const terminals = [];
  for (const terminal of terminalsRaw) {
    if (terminal === null || typeof terminal !== "object" || Array.isArray(terminal)) return null;
    if (typeof terminal.name !== "string") return null;
    // The row passes through once its shape is right: the roster check
    // reads only `name`, and the reader sees the hub's own fields.
    terminals.push(terminal);
  }
  return {
    team: typeof payload.team === "string" ? payload.team : null,
    sinceSeconds: typeof payload.sinceSeconds === "number" ? payload.sinceSeconds : null,
    terminals,
  };
}

// The SYNC probe the CLI modes use: check and start are sync modes with
// a read-only, best-effort roster, so the probe cannot be awaited. A
// one-shot child of THIS node binary does the fetch (the runtime the
// gate guarantees) and prints a one-line envelope:
//   HUBSTATUS <json-or-marker>
// where the marker is one of REFUSED, Timeout, HTTP, UNSUPPORTED.
const PROBE_SOURCE = `
const [url, timeoutMs] = process.argv.slice(1);
const seen = (marker) => { process.stdout.write("HUBSTATUS " + marker); };
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(Number(timeoutMs)) });
  if (!response.ok) seen("HTTP" + response.status);
  else {
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { seen("UNSUPPORTED"); }
    if (payload !== undefined) process.stdout.write("HUBSTATUS " + JSON.stringify(payload));
  }
} catch (error) {
  seen("REFUSED");
}
`;

export function hubStatusSync(port, { timeoutMs = STATUS_TIMEOUT_MS } = {}) {
  const result = spawnSync(process.execPath, ["-e", PROBE_SOURCE, `http://127.0.0.1:${port}/status`, String(timeoutMs)], {
    encoding: "utf8",
    timeout: timeoutMs + 1000,
  });
  const body = (result.stdout ?? "").trim();
  if (!body.startsWith("HUBSTATUS ")) return { status: null, kind: "refused" };
  const payloadText = body.slice("HUBSTATUS ".length);
  if (payloadText === "REFUSED") return { status: null, kind: "refused" };
  if (payloadText === "UNSUPPORTED") return { status: null, kind: "unsupported" };
  if (payloadText.startsWith("HTTP")) return { status: null, kind: "http" };
  if (payloadText === "Timeout") return { status: null, kind: "timeout" };
  try {
    const validated = validateStatusPayload(JSON.parse(payloadText));
    if (validated === null) return { status: null, kind: "unsupported" };
    return { status: validated, kind: "ok" };
  } catch {
    return { status: null, kind: "unsupported" };
  }
}
