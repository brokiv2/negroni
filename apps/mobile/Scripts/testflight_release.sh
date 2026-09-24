#!/usr/bin/env bash
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$MOBILE_DIR/../.." && pwd)"
IOS_DIR="$MOBILE_DIR/ios"
WORKSPACE="$IOS_DIR/Negroni.xcworkspace"
SCHEME="Negroni"
APP_NAME="Negroni"
BUNDLE_ID="$(node -p "require('$MOBILE_DIR/app.json').expo.ios.bundleIdentifier")"
TEAM_ID="${TEAM_ID:-$(sed -n 's/.*DEVELOPMENT_TEAM = \([^;]*\);/\1/p' "$IOS_DIR/Negroni.xcodeproj/project.pbxproj" | head -n 1)}"

PRIVATE_RELEASE_CONFIG="$MOBILE_DIR/.env.testflight.local"
if [[ -f "$PRIVATE_RELEASE_CONFIG" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PRIVATE_RELEASE_CONFIG"
  set +a
fi

if [[ -z "${EXPO_PUBLIC_TUNNEL_KEY:-}" ]]; then
  EXPO_PUBLIC_TUNNEL_KEY="$(security find-generic-password -a "$USER" -s dev.negroni.tunnel-key -w 2>/dev/null || true)"
  export EXPO_PUBLIC_TUNNEL_KEY
fi

ASC_KEY_ID="${ASC_KEY_ID:-}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-}"
ASC_KEY_PATH="${ASC_KEY_PATH:-${ASC_KEY_ID:+$HOME/Downloads/AuthKey_${ASC_KEY_ID}.p8}}"

VERSION="$(node -p "require('$MOBILE_DIR/app.json').expo.version")"
BUILD_NUMBER="$(node -p "require('$MOBILE_DIR/app.json').expo.ios.buildNumber")"
OUTPUT_DIR="${OUTPUT_DIR:-$REPO_DIR/build/TestFlight-$BUNDLE_ID-build$BUILD_NUMBER}"
ARCHIVE_PATH="${ARCHIVE_PATH:-$OUTPUT_DIR/$APP_NAME.xcarchive}"
EXPORT_DIR="${EXPORT_DIR:-$OUTPUT_DIR/export}"
EXPORT_OPTIONS_PLIST="$OUTPUT_DIR/ExportOptions.plist"
UPLOAD_OPTIONS_PLIST="$OUTPUT_DIR/UploadOptions.plist"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-/tmp/Negroni-DerivedData-release}"

usage() {
  printf '%s\n' \
    'Usage: apps/mobile/Scripts/testflight_release.sh <command>' \
    '' \
    'Commands:' \
    '  prepare     Install CocoaPods dependencies.' \
    '  archive     Build a signed generic-iOS archive.' \
    '  export      Export an App Store Connect IPA.' \
    '  inspect     Verify the IPA metadata, resources, signature, and profile.' \
    '  upload      Upload the verified archive with the signed-in Xcode account.' \
    '  local       Run prepare, archive, export, and inspect.' \
    '  testflight  Run the complete local pipeline, then upload.' \
    '' \
    'Optional environment: OUTPUT_DIR, ARCHIVE_PATH, EXPORT_DIR, DERIVED_DATA_PATH,' \
    'ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH.'
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

require_asc_key() {
  [[ -n "$ASC_KEY_ID" && -n "$ASC_ISSUER_ID" && -n "$ASC_KEY_PATH" ]] || {
    printf 'Set ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH in %s or the environment.\n' "$PRIVATE_RELEASE_CONFIG" >&2
    exit 1
  }
  [[ -f "$ASC_KEY_PATH" ]] || {
    printf 'App Store Connect key not found: %s\n' "$ASC_KEY_PATH" >&2
    exit 1
  }
}

xcodebuild_auth_args() {
  require_asc_key
  printf '%s\0' \
    -authenticationKeyPath "$ASC_KEY_PATH" \
    -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
}

write_export_options() {
  local path="$1"
  local destination="$2"
  mkdir -p "$OUTPUT_DIR"
  plutil -create xml1 "$path"
  plutil -insert method -string app-store-connect "$path"
  plutil -insert destination -string "$destination" "$path"
  plutil -insert signingStyle -string automatic "$path"
  plutil -insert teamID -string "$TEAM_ID" "$path"
  plutil -insert uploadSymbols -bool YES "$path"
  plutil -insert stripSwiftSymbols -bool YES "$path"
  plutil -insert manageAppVersionAndBuildNumber -bool NO "$path"
}

prepare() {
  require_command pod
  (cd "$IOS_DIR" && pod install)
}

archive_app() {
  require_command xcodebuild
  local native_build_numbers
  native_build_numbers="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([0-9][0-9]*\);/\1/p' "$IOS_DIR/Negroni.xcodeproj/project.pbxproj" | sort -u)"
  if [[ "$native_build_numbers" != "$BUILD_NUMBER" ]]; then
    printf 'Native Xcode build number (%s) must match app.json (%s).\n' "$native_build_numbers" "$BUILD_NUMBER" >&2
    exit 1
  fi
  local plist_build_number
  plist_build_number="$(plutil -extract CFBundleVersion raw -o - "$IOS_DIR/Negroni/Info.plist")"
  if [[ "$plist_build_number" != "$BUILD_NUMBER" ]]; then
    printf 'Native Info.plist build number (%s) must match app.json (%s).\n' "$plist_build_number" "$BUILD_NUMBER" >&2
    exit 1
  fi
  mkdir -p "$OUTPUT_DIR" "$DERIVED_DATA_PATH"
  if [[ -e "$ARCHIVE_PATH" ]]; then
    printf 'Archive already exists: %s\nSet OUTPUT_DIR to a new path or remove it explicitly.\n' "$ARCHIVE_PATH" >&2
    exit 1
  fi
  local build_args=(
    -workspace "$WORKSPACE"
    -scheme "$SCHEME"
    -configuration Release
    -destination 'generic/platform=iOS'
    -archivePath "$ARCHIVE_PATH"
    -derivedDataPath "$DERIVED_DATA_PATH"
    -allowProvisioningUpdates
  )
  while IFS= read -r -d '' arg; do
    build_args+=("$arg")
  done < <(xcodebuild_auth_args)
  build_args+=(archive)
  xcodebuild "${build_args[@]}"
}

export_app() {
  require_command xcodebuild
  [[ -d "$ARCHIVE_PATH" ]] || {
    printf 'Archive not found: %s\n' "$ARCHIVE_PATH" >&2
    exit 1
  }
  if [[ -d "$EXPORT_DIR" ]]; then
    printf 'Export directory already exists: %s\nSet OUTPUT_DIR to a new path or remove it explicitly.\n' "$EXPORT_DIR" >&2
    exit 1
  fi
  write_export_options "$EXPORT_OPTIONS_PLIST" export
  local export_args=(
    -exportArchive
    -archivePath "$ARCHIVE_PATH"
    -exportPath "$EXPORT_DIR"
    -exportOptionsPlist "$EXPORT_OPTIONS_PLIST"
    -allowProvisioningUpdates
  )
  while IFS= read -r -d '' arg; do
    export_args+=("$arg")
  done < <(xcodebuild_auth_args)
  xcodebuild "${export_args[@]}"
}

find_ipa() {
  find "$EXPORT_DIR" -maxdepth 1 -type f -name '*.ipa' -print -quit
}

inspect_ipa() {
  require_command codesign
  require_command unzip
  local ipa_path
  ipa_path="$(find_ipa)"
  [[ -n "$ipa_path" && -f "$ipa_path" ]] || {
    printf 'No IPA found in %s\n' "$EXPORT_DIR" >&2
    exit 1
  }
  local inspect_dir
  inspect_dir="$(mktemp -d /tmp/negroni-ipa-inspect.XXXXXX)"
  trap 'rm -rf "$inspect_dir"' RETURN
  unzip -q "$ipa_path" -d "$inspect_dir"
  local app_path
  app_path="$(find "$inspect_dir/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"
  [[ -d "$app_path" ]] || {
    printf 'App bundle missing from IPA: %s\n' "$ipa_path" >&2
    exit 1
  }

  local actual_id actual_version actual_build encryption
  actual_id="$(plutil -extract CFBundleIdentifier raw -o - "$app_path/Info.plist")"
  actual_version="$(plutil -extract CFBundleShortVersionString raw -o - "$app_path/Info.plist")"
  actual_build="$(plutil -extract CFBundleVersion raw -o - "$app_path/Info.plist")"
  encryption="$(plutil -extract ITSAppUsesNonExemptEncryption raw -o - "$app_path/Info.plist")"
  [[ "$actual_id" == "$BUNDLE_ID" ]] || { printf 'Unexpected bundle ID: %s\n' "$actual_id" >&2; exit 1; }
  [[ "$actual_version" == "$VERSION" ]] || { printf 'Unexpected version: %s\n' "$actual_version" >&2; exit 1; }
  [[ "$actual_build" == "$BUILD_NUMBER" ]] || { printf 'Unexpected build: %s\n' "$actual_build" >&2; exit 1; }
  [[ "$encryption" == "false" ]] || { printf 'ITSAppUsesNonExemptEncryption must be false.\n' >&2; exit 1; }
  local families full_screen orientations
  families="$(plutil -extract UIDeviceFamily json -o - "$app_path/Info.plist" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).sort().join(",")))')"
  [[ "$families" == "1,2" ]] || { printf 'Expected iPhone and iPad device families.\n' >&2; exit 1; }
  full_screen="$(plutil -extract UIRequiresFullScreen raw -o - "$app_path/Info.plist")"
  [[ "$full_screen" == "false" ]] || { printf 'iPad multitasking must remain enabled.\n' >&2; exit 1; }
  orientations="$(plutil -extract 'UISupportedInterfaceOrientations~ipad' json -o - "$app_path/Info.plist")"
  for orientation in Portrait PortraitUpsideDown LandscapeLeft LandscapeRight; do
    [[ "$orientations" == *"UIInterfaceOrientation$orientation\""* ]] || {
      printf 'Missing iPad orientation: %s\n' "$orientation" >&2
      exit 1
    }
  done
  [[ -f "$app_path/main.jsbundle" ]] || { printf 'Release JavaScript bundle is missing.\n' >&2; exit 1; }
  grep -aFq 'getDevicePushTokenAsync' "$app_path/main.jsbundle" || {
    printf 'Native APNs device-token registration is missing from the Release bundle.\n' >&2
    exit 1
  }
  grep -aFq '/api/voice/' "$app_path/main.jsbundle" || {
    printf 'Mobile voice requests are missing from the Release bundle.\n' >&2
    exit 1
  }
  grep -aFq 'Dictate message' "$app_path/main.jsbundle" || {
    printf 'The dictation composer control is missing from the Release bundle.\n' >&2
    exit 1
  }
  if ! grep -aFq 'Interrupt and speak' "$app_path/main.jsbundle"; then
    printf 'Voice call playback controls are missing from the Release bundle.\n' >&2
    exit 1
  fi
  [[ -f "$app_path/EXConstants.bundle/app.config" ]] || { printf 'Expo app.config is missing.\n' >&2; exit 1; }
  [[ ! -d "$app_path/Watch" ]] || { printf 'Unexpected Aisy Watch app is embedded.\n' >&2; exit 1; }
  local expected_api_url="${EXPO_PUBLIC_API_URL:-}"
  if [[ -z "$expected_api_url" && -f "$MOBILE_DIR/.env.local" ]]; then
    expected_api_url="$(sed -n 's/^EXPO_PUBLIC_API_URL=//p' "$MOBILE_DIR/.env.local" | tail -n 1)"
  fi
  if [[ -n "$expected_api_url" ]]; then
    grep -aFq "$expected_api_url" "$app_path/main.jsbundle" || {
      printf 'Configured API URL is missing from the Release bundle: %s\n' "$expected_api_url" >&2
      exit 1
    }
  fi
  if [[ -n "${EXPO_PUBLIC_TUNNEL_KEY:-}" ]]; then
    grep -aFq "$EXPO_PUBLIC_TUNNEL_KEY" "$app_path/main.jsbundle" || {
      printf 'Configured tunnel key is missing from the Release bundle.\n' >&2
      exit 1
    }
  fi
  cmp -s "$MOBILE_DIR/assets/icon.png" "$REPO_DIR/apps/desktop/assets/icon.png" || {
    printf 'Mobile icon must exactly match the Negroni desktop icon.\n' >&2
    exit 1
  }

  codesign --verify --deep --strict "$app_path"
  local profile_plist="$inspect_dir/profile.plist"
  security cms -D -i "$app_path/embedded.mobileprovision" > "$profile_plist"
  local profile_name get_task_allow beta_reports aps_environment
  local microphone_usage
  microphone_usage="$(plutil -extract NSMicrophoneUsageDescription raw -o - "$app_path/Info.plist")"
  [[ "$microphone_usage" == *transcribe* ]] || {
    printf 'The iOS microphone usage description does not explain dictation.\n' >&2
    exit 1
  }
  profile_name="$(plutil -extract Name raw -o - "$profile_plist")"
  get_task_allow="$(plutil -extract Entitlements.get-task-allow raw -o - "$profile_plist")"
  beta_reports="$(plutil -extract Entitlements.beta-reports-active raw -o - "$profile_plist")"
  aps_environment="$(plutil -extract Entitlements.aps-environment raw -o - "$profile_plist")"
  local apple_sign_in profile_apple_sign_in signed_entitlements
  signed_entitlements="$inspect_dir/signed-entitlements.plist"
  codesign -d --entitlements :- "$app_path" > "$signed_entitlements" 2>/dev/null
  apple_sign_in="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.applesignin:0' "$signed_entitlements" 2>/dev/null || true)"
  profile_apple_sign_in="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.developer.applesignin:0' "$profile_plist" 2>/dev/null || true)"
  [[ "$get_task_allow" == "false" ]] || { printf 'Distribution profile has get-task-allow=%s\n' "$get_task_allow" >&2; exit 1; }
  [[ "$beta_reports" == "true" ]] || { printf 'Distribution profile has beta-reports-active=%s\n' "$beta_reports" >&2; exit 1; }
  [[ "$aps_environment" == "production" ]] || { printf 'Distribution profile has aps-environment=%s\n' "$aps_environment" >&2; exit 1; }
  [[ "$apple_sign_in" == "Default" && "$profile_apple_sign_in" == "Default" ]] || {
    printf 'Apple ID capability is missing from the signed app or distribution profile.\n' >&2
    exit 1
  }

  printf 'PASS: Negroni %s (%s), %s\n' "$actual_version" "$actual_build" "$actual_id"
  [[ -z "$expected_api_url" ]] || printf 'API: %s\n' "$expected_api_url"
  printf 'Profile: %s\nIPA: %s\n' "$profile_name" "$ipa_path"
}

upload_app() {
  require_command xcodebuild
  [[ -d "$ARCHIVE_PATH" ]] || {
    printf 'Archive not found: %s\n' "$ARCHIVE_PATH" >&2
    exit 1
  }
  write_export_options "$UPLOAD_OPTIONS_PLIST" upload
  local upload_args=(
    -exportArchive
    -archivePath "$ARCHIVE_PATH"
    -exportPath "$OUTPUT_DIR/upload"
    -exportOptionsPlist "$UPLOAD_OPTIONS_PLIST"
    -allowProvisioningUpdates
  )
  while IFS= read -r -d '' arg; do
    upload_args+=("$arg")
  done < <(xcodebuild_auth_args)
  xcodebuild "${upload_args[@]}"
}

case "${1:-}" in
  prepare) prepare ;;
  archive) archive_app ;;
  export) export_app ;;
  inspect) inspect_ipa ;;
  upload) upload_app ;;
  local)
    prepare
    archive_app
    export_app
    inspect_ipa
    ;;
  testflight)
    prepare
    archive_app
    export_app
    inspect_ipa
    upload_app
    ;;
  ''|-h|--help|help) usage ;;
  *)
    printf 'Unknown command: %s\n' "$1" >&2
    usage >&2
    exit 1
    ;;
esac
