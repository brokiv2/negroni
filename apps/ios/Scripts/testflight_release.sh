#!/usr/bin/env bash
set -euo pipefail
umask 077
IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_RELEASE_CONFIG="${PRIVATE_RELEASE_CONFIG:-$IOS_DIR/../mobile/.env.testflight.local}"
MOBILE_RUNTIME_CONFIG="$(dirname "$PRIVATE_RELEASE_CONFIG")/.env.local"
if [[ -f "$MOBILE_RUNTIME_CONFIG" ]]; then
  set -a
  source "$MOBILE_RUNTIME_CONFIG"
  set +a
fi
if [[ -f "$PRIVATE_RELEASE_CONFIG" ]]; then
  set -a
  source "$PRIVATE_RELEASE_CONFIG"
  set +a
fi
export NEGRONI_API_URL="${NEGRONI_API_URL:-${EXPO_PUBLIC_API_URL:-}}"
export NEGRONI_TUNNEL_KEY="${NEGRONI_TUNNEL_KEY:-${EXPO_PUBLIC_TUNNEL_KEY:-}}"
if [[ -z "$NEGRONI_TUNNEL_KEY" ]]; then
  NEGRONI_TUNNEL_KEY="$(security find-generic-password -a "$USER" -s dev.negroni.tunnel-key -w 2>/dev/null || true)"
fi
TEAM_ID="${TEAM_ID:-$(sed -n 's/.*DEVELOPMENT_TEAM = \([^;]*\);/\1/p' "$IOS_DIR/../mobile/ios/Negroni.xcodeproj/project.pbxproj" | head -n 1)}"
: "${TEAM_ID:?Set TEAM_ID}"
: "${ASC_KEY_ID:?Set ASC_KEY_ID}"
: "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID}"
ASC_KEY_PATH="${ASC_KEY_PATH:-$HOME/Downloads/AuthKey_${ASC_KEY_ID}.p8}"
[[ -f "$ASC_KEY_PATH" ]] || { echo 'App Store Connect signing key is missing'; exit 1; }
BUILD_NUMBER="${BUILD_NUMBER:-37}"
OUTPUT_DIR="${OUTPUT_DIR:-$HOME/Library/Developer/Negroni-Releases/native-build$BUILD_NUMBER}"
export OUTPUT_DIR
ARCHIVE="$OUTPUT_DIR/Negroni.xcarchive"
IPA="$OUTPUT_DIR/export/Negroni.ipa"
AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
mkdir -p "$OUTPUT_DIR"
prepare() {
  python3 - <<'PY'
import os, urllib.parse
u=urllib.parse.urlsplit(os.environ['NEGRONI_API_URL'])
assert u.scheme=='https' and u.hostname not in ('localhost','127.0.0.1','::1'), 'A release requires the production HTTPS gateway'
PY
  "$IOS_DIR/Scripts/prepare.sh"
}
archive() {
  [[ ! -e "$ARCHIVE" ]] || { echo 'Archive already exists; choose a new OUTPUT_DIR.'; exit 1; }
  prepare
  xcodebuild -project "$IOS_DIR/Negroni.xcodeproj" -scheme Negroni -configuration Release -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath "$OUTPUT_DIR/DerivedData" -allowProvisioningUpdates "${AUTH[@]}" DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" archive > "$OUTPUT_DIR/archive.log" 2>&1
  echo 'Native iOS archive succeeded.'
}
export_app() {
  export TEAM_ID
  python3 - <<'PY'
import os,plistlib
with open(os.path.join(os.environ['OUTPUT_DIR'],'ExportOptions.plist'),'wb') as f:
 plistlib.dump({'method':'app-store-connect','destination':'export','signingStyle':'automatic','teamID':os.environ['TEAM_ID'],'manageAppVersionAndBuildNumber':False,'stripSwiftSymbols':True,'uploadSymbols':True},f)
PY
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUTPUT_DIR/export" -exportOptionsPlist "$OUTPUT_DIR/ExportOptions.plist" -allowProvisioningUpdates "${AUTH[@]}" > "$OUTPUT_DIR/export.log" 2>&1
  echo 'IPA exported.'
}
inspect() {
  python3 "$IOS_DIR/Scripts/inspect-release.py" "$IPA" "$BUILD_NUMBER"
}
validate() {
  inspect
  xcrun altool --validate-app -f "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" --p8-file-path "$ASC_KEY_PATH" --output-format json > "$OUTPUT_DIR/validation.json" 2>&1
  shasum -a 256 "$IPA" > "$OUTPUT_DIR/validated.sha256"
  echo 'Apple validation succeeded.'
}
upload() {
  if [[ ! -f "$OUTPUT_DIR/validated.sha256" ]] || ! shasum -a 256 -c "$OUTPUT_DIR/validated.sha256" >/dev/null 2>&1; then
    validate
  fi
  xcrun altool --upload-app -f "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" --p8-file-path "$ASC_KEY_PATH" --output-format json > "$OUTPUT_DIR/upload.json" 2>&1
  echo 'Native build uploaded; verify Apple processing separately.'
}
case "${1:-}" in
 prepare) prepare;; archive) archive;; export) export_app;; inspect) inspect;; validate) validate;; upload) upload;;
 local) archive; export_app; inspect;; testflight) archive; export_app; upload;;
 *) echo 'Usage: testflight_release.sh {prepare|archive|export|inspect|validate|upload|local|testflight}'; exit 2;;
esac
