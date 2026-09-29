#!/usr/bin/env bash
set -euo pipefail
umask 077
IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${NEGRONI_API_URL:?Set NEGRONI_API_URL to the backend origin}"
export NEGRONI_API_URL IOS_DIR
mkdir -p "$IOS_DIR/.build-config"
python3 - <<'PY'
import os, plistlib, urllib.parse
url=os.environ['NEGRONI_API_URL'].strip().rstrip('/')
p=urllib.parse.urlsplit(url)
assert p.scheme in ('https','http') and p.hostname and not p.username and not p.password and not p.query and not p.fragment and not p.path, 'Expected a plain HTTP(S) origin'
with open(os.path.join(os.environ['IOS_DIR'],'.build-config','ClientConfiguration.plist'),'wb') as f:
 plistlib.dump({'APIBaseURL':url,'TunnelKey':os.environ.get('NEGRONI_TUNNEL_KEY','')}, f)
PY
node "$IOS_DIR/Scripts/generate-theme.mjs"
xcodegen generate --spec "$IOS_DIR/project.yml"
