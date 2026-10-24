#!/bin/sh
# The prose gate over this repo's tracked markdown: fail closed on the two
# character rules (em dash U+2014, en dash U+2013) and the four banned
# AI-slop words. Findings name the file and the line; the fix belongs in
# the prose, never in a suppression. Run from the repo root: `sh
# scripts/prose-gate.sh`.
set -eu

cd "$(dirname "$0")/.."

fail=0

check_chars() {
  for f in $(git ls-files '*.md'); do
    lineno=$(awk 'index($0, "\342\200\224") || index($0, "\342\200\223") { print NR; exit }' "$f" 2>/dev/null || true)
    if [ -n "$lineno" ]; then
      echo "prose-gate: em/en dash at $f:$lineno" >&2
      fail=1
    fi
  done
}

check_words() {
  # rob|ust, leverage, seamlessly, utilize, case-insensitive, word-bounded.
  for f in $(git ls-files '*.md'); do
    hits=$(awk '
      BEGIN { IGNORECASE = 1 }
      /\<robust\>|\<leverage\>|\<seamlessly\>|\<utilize\>/ { print NR ":" $0; exit }
    ' "$f" 2>/dev/null || true)
    if [ -n "$hits" ]; then
      echo "prose-gate: banned word at $f:$hits" >&2
      fail=1
    fi
  done
}

check_chars
check_words

if [ "$fail" -ne 0 ]; then
  echo "prose-gate: FAIL (fix the prose; never suppress the check)" >&2
  exit 1
fi
echo "prose-gate: ok"