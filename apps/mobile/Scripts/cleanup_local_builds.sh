#!/usr/bin/env bash
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$MOBILE_DIR/../.." && pwd)"
BUNDLE_ID="$(node -p "require('$MOBILE_DIR/app.json').expo.ios.bundleIdentifier")"
PREFIX="TestFlight-$BUNDLE_ID-build"
VERIFIED_BUILD="${VERIFIED_BUILD:-}"
MODE="${1:---dry-run}"

if [[ "$MODE" != "--dry-run" && "$MODE" != "--apply" ]]; then
  printf 'Usage: VERIFIED_BUILD=<number> %s [--dry-run|--apply]\n' "$0" >&2
  exit 2
fi
if [[ ! "$VERIFIED_BUILD" =~ ^[0-9]+$ ]]; then
  printf 'Set VERIFIED_BUILD to the build number confirmed VALID in App Store Connect.\n' >&2
  exit 2
fi

current="$REPO_DIR/build/$PREFIX$VERIFIED_BUILD"
if [[ ! -d "$current/Negroni.xcarchive" || ! -f "$current/export/Negroni.ipa" ]]; then
  printf 'Verified local archive and IPA are missing: %s\n' "$current" >&2
  exit 1
fi
if pgrep -x xcodebuild >/dev/null; then
  printf 'Xcode is building; leave archives alone until it finishes.\n' >&2
  exit 1
fi

previous=0
for candidate in "$REPO_DIR"/build/"$PREFIX"*; do
  [[ -d "$candidate" && ! -L "$candidate" ]] || continue
  basename="${candidate##*/}"
  [[ "$basename" =~ ^${PREFIX}([0-9]+)(-attempt[0-9]+)?$ ]] || continue
  number="${BASH_REMATCH[1]}"
  if (( number < VERIFIED_BUILD && number > previous )) &&
    [[ -d "$candidate/Negroni.xcarchive" && -f "$candidate/export/Negroni.ipa" ]]; then
    previous="$number"
  fi
done

printf 'Keeping verified build %s and previous local build %s.\n' "$VERIFIED_BUILD" "$previous"
for candidate in "$REPO_DIR"/build/"$PREFIX"*; do
  [[ -d "$candidate" && ! -L "$candidate" ]] || continue
  basename="${candidate##*/}"
  [[ "$basename" =~ ^${PREFIX}([0-9]+)(-attempt[0-9]+)?$ ]] || continue
  number="${BASH_REMATCH[1]}"
  if (( number == VERIFIED_BUILD || number == previous )); then continue; fi
  if [[ "$MODE" == "--apply" ]]; then
    command -v trash >/dev/null || { printf 'macOS trash command is required.\n' >&2; exit 1; }
    trash "$candidate"
    printf 'Moved to Trash: %s\n' "$basename"
  else
    printf 'Would move to Trash: %s\n' "$basename"
  fi
done
df -h / | tail -n 1
