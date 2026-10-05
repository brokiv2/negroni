#!/usr/bin/env python3
"""Build a signed, stable identity for the local Negroni services."""
import argparse
import pathlib
import plistlib
import shutil
import subprocess
import tempfile


def build(output, node, identity, service_root=None, icon=None):
    if identity == "-":
        raise ValueError("Ad-hoc signing cannot preserve privacy grants across updates")
    if output.exists():
        raise ValueError("Build into a new staging directory; do not overwrite a running app")
    contents = output / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    (contents / "Helpers").mkdir()
    (contents / "Resources").mkdir()
    info = {
        "CFBundleIdentifier": "dev.negroni.host",
        "CFBundleName": "Negroni Host",
        "CFBundleDisplayName": "Negroni Host",
        "CFBundleExecutable": "NegroniHost",
        "CFBundlePackageType": "APPL",
        "CFBundleVersion": "1",
        "CFBundleShortVersionString": "1.0",
        "LSUIElement": True,
        "NSAppleEventsUsageDescription": "Negroni uses the applications you ask it to work with.",
        "NSDesktopFolderUsageDescription": "Negroni uses files on your Desktop when you ask it to.",
        "NSDocumentsFolderUsageDescription": "Negroni uses documents when you ask it to.",
        "NSDownloadsFolderUsageDescription": "Negroni uses downloaded files when you ask it to.",
        "NSFileProviderDomainUsageDescription": "Negroni uses files in your cloud drive when you ask it to.",
        "NSNetworkVolumesUsageDescription": "Negroni uses files on network volumes when you ask it to.",
        "NSRemovableVolumesUsageDescription": "Negroni uses files on removable volumes when you ask it to.",
    }
    if service_root:
        info["NegroniServiceDirectory"] = str(service_root.resolve())
    if icon and icon.is_file():
        shutil.copy2(icon, contents / "Resources/icon.icns")
        info["CFBundleIconFile"] = "icon.icns"
    (contents / "Info.plist").write_bytes(plistlib.dumps(info))
    source = pathlib.Path(__file__).with_name("main.m")
    subprocess.run(["xcrun", "clang", "-O2", "-Wall", "-Wextra", "-Werror", "-fobjc-arc",
                    "-framework", "Foundation", "-framework", "ApplicationServices",
                    str(source), "-o", str(contents / "MacOS/NegroniHost")], check=True)
    shutil.copy2(node, contents / "Helpers/node")
    # The interpreter has its own product identifier, and the same signing
    # identity as the launcher. JIT entitlements do not grant file/UI access.
    entitlements = contents / "Resources/node-entitlements.plist"
    entitlements.write_bytes(plistlib.dumps({
        "com.apple.security.cs.allow-jit": True,
        "com.apple.security.cs.allow-unsigned-executable-memory": True,
        # Like the upstream Node runtime, support npm's native addons. The
        # native launcher itself keeps hardened library validation enabled.
        "com.apple.security.cs.disable-library-validation": True,
    }))
    subprocess.run(["codesign", "--force", "--sign", identity, "--options", "runtime",
                    "--identifier", "dev.negroni.host.node", "--entitlements", str(entitlements),
                    str(contents / "Helpers/node")], check=True)
    entitlements.unlink()
    with tempfile.TemporaryDirectory(prefix="negroni-sign-") as signing_dir:
        entitlements = pathlib.Path(signing_dir) / "host-entitlements.plist"
        entitlements.write_bytes(plistlib.dumps({"com.apple.security.automation.apple-events": True}))
        subprocess.run(["codesign", "--force", "--sign", identity, "--options", "runtime",
                        "--entitlements", str(entitlements), str(output)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(output)], check=True)
    subprocess.run([str(contents / "Helpers/node"), "--version"], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", type=pathlib.Path, required=True)
    parser.add_argument("--identity", required=True, help="Stable Apple signing identity; ad-hoc is unsuitable")
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--service-root", type=pathlib.Path)
    parser.add_argument("--icon", type=pathlib.Path, help="Optional existing product .icns")
    args = parser.parse_args()
    if args.identity == "-":
        parser.error("An Apple signing identity is required to preserve privacy grants across updates")
    build(args.output.resolve(), args.node.resolve(), args.identity, args.service_root, args.icon)
