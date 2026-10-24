#!/bin/sh
# The runnable example: no agent launched, no zellij required. Builds a
# sandbox copy of the demo team, runs the preflight against it, and
# generates the layout for two role selections. Prints what happened so
# its output can be captured verbatim into examples/README.md.
set -eu

cd "$(dirname "$0")/.."

sandbox="$(mktemp -d "${TMPDIR:-/tmp}/awt-demo-XXXXXX")"
trap 'rm -rf "$sandbox"' EXIT

# The demo team lands in the sandbox at <sandbox>/repo (the repo root),
# manifest at the canonical .pi-link/team.json path. cp -R with a trailing
# slash copies the hidden .pi-link dir too.
cp -R examples/demo-team/ "$sandbox/repo"
mkdir -p "$sandbox/repo/sessions/planner" "$sandbox/repo/sessions/builder"
TEAM="$sandbox/repo"

teamctl() {
  node "$(pwd)/bin/teamctl.mjs" "$@"
}

# The kit's node floor (engines.node >=24, checked at the boundary): the
# demo runs under whatever node is FIRST ON PATH; under nvm that may be
# an older one, so the run pins node 24 when it is available.
if [ "$(node --version | cut -c2- | cut -d. -f1)" -lt 24 ] 2>/dev/null; then
  for candidate in "$HOME/.nvm/versions/node"/v24.*; do
    [ -d "$candidate" ] && export PATH="$candidate/bin:$PATH" && break
  done
fi

echo "== teamctl check (both session dirs exist, so zero warnings) =="
teamctl check --root "$TEAM"
echo "exit=$?"

echo
echo "== teamctl layout --roles planner,builder (hub focused) =="
teamctl layout --root "$TEAM" --roles planner,builder

echo
echo "== teamctl layout --roles builder (single pane, no wrapper) =="
teamctl layout --root "$TEAM" --roles builder
echo "exit=$?"

rm -rf "$TEAM/sessions"
echo
echo "== teamctl check on a fresh checkout (session dirs missing: warnings, not errors) =="
teamctl check --root "$TEAM"
echo "exit=$?"