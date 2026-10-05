# Negroni Host (macOS)

Local launchd services must run under one stable, signed native application,
rather than unrelated interpreter paths from other products' caches. Negroni
Host keeps the app process alive above its bundled Node and shell children so
macOS can attribute privacy requests to `dev.negroni.host` / **Negroni Host**.

Build into a fresh staging directory with `build.py --node /path/to/node
--identity <signing-identity> --output /path/to/Negroni\ Host.app`. Use Node
24.15 or later. Keep the bundle identifier, signing team, and installed path
stable across updates. Developer ID is appropriate for distribution; Apple
Development signing supports local development. Ad-hoc signing does not
preserve identity across rebuilds.

Run `install.py --app /path/to/Negroni\ Host.app` after checking that no agent
run is executing. It installs the bundle at `~/Applications/Negroni Host.app`,
backs up the existing local configuration privately, switches the two services,
checks their process identity and HTTP readiness, and rolls back on failure.
It preserves the existing service configuration and credentials.

Both existing launchd plists keep
their environment, log paths, and scheduling settings. Replace only their
`ProgramArguments` with the host executable plus `--service backend` or
`--service mac-control`, remove a stale `Program` key, and add
`AssociatedBundleIdentifiers = dev.negroni.host`. The local stack script must
take its Node from `NEGRONI_NODE_BIN`. Service files and secrets remain in
`~/Library/Application Support/Negroni`; Node lives inside the signed bundle.

The host prepends its bundled Node directory to PATH and supplies
`NEGRONI_NODE_BIN` to both services. It forwards shutdown signals and preserves
the child's exit status, so launchd's existing recovery still works.

Run `Contents/MacOS/NegroniHost --check` to inspect the bundle identity and
preflight Accessibility / Screen Recording without requesting permissions.
This checks the host itself; successful descendant attribution and a real
file operation must also be verified on the deployed services.

Run `verify.py --node /path/to/node --identity <signing-identity>` for offline
checks of bundled Node selection, child exit status, signal propagation, and
stable signing requirements across two rebuilds. It only uses temporary fixtures.

macOS still requires initial consent for protected folders, each cloud-file
provider, application automation, Accessibility, and Screen Recording. This
does not migrate, grant, reset, or edit privacy permissions. In particular,
Full Disk Access should not be granted just to suppress a prompt. Existing
Node entries may belong to other tools; do not remove them indiscriminately.

References: [Apple on responsible code and stable signing](https://developer.apple.com/forums/thread/678819),
[cloud-file provider consent](https://developer.apple.com/documentation/bundleresources/information-property-list/nsfileproviderdomainusagedescription).
