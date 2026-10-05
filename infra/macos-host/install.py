#!/usr/bin/env python3
"""Switch existing local services to a prepared host, with private rollback backups."""
import argparse
import datetime
import os
import pathlib
import plistlib
import re
import shutil
import subprocess
import time
import urllib.request
import urllib.error


def launchctl(*args, check=True):
    return subprocess.run(["launchctl", *args], check=check, capture_output=True)


def install(app):
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    signature = subprocess.run(["codesign", "-d", "-r-", str(app)],
                               check=True, capture_output=True, text=True)
    requirement = signature.stdout + signature.stderr
    if "anchor apple generic" not in requirement or "cdhash" in requirement:
        raise ValueError("A stable Apple code signing identity is required")
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != "dev.negroni.host" or info.get("NegroniServiceDirectory"):
        raise ValueError("Install requires the production Negroni Host bundle")
    home = pathlib.Path.home()
    root = home / "Library/Application Support/Negroni"
    destination = home / "Applications/Negroni Host.app"
    executable = destination / "Contents/MacOS/NegroniHost"
    stack = root / "negroni-stack.sh"
    old_stack = stack.read_text()
    new_stack, count = re.subn(r'^NODE_BIN=.*$',
        'NODE_BIN="${NEGRONI_NODE_BIN:?Start this stack through Negroni Host}"', old_stack, flags=re.M)
    if count != 1:
        raise ValueError("Expected exactly one stack Node configuration")
    agents = []
    for service in ["backend", "mac-control"]:
        path = home / f"Library/LaunchAgents/dev.negroni.{service}.plist"
        data = plistlib.loads(path.read_bytes())
        if data.get("Label") != f"dev.negroni.{service}":
            raise ValueError("Unexpected service label")
        data.pop("Program", None)
        data["ProgramArguments"] = [str(executable), "--service", service]
        data["AssociatedBundleIdentifiers"] = ["dev.negroni.host"]
        agents.append((path, data))
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = root / f"deploy-backups/macos-host-{stamp}"
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(stack, backup / stack.name)
    for path, _ in agents:
        shutil.copy2(path, backup / path.name)
        os.chmod(backup / path.name, 0o600)
    had_app = destination.exists()
    if had_app:
        shutil.copytree(destination, backup / destination.name)
    domain = f"gui/{os.getuid()}"
    # Only these two services are stopped. The tunnel and other Node users stay intact.
    for path, _ in agents:
        launchctl("bootout", domain, str(path), check=False)
    try:
        if had_app:
            shutil.rmtree(destination)
        destination.parent.mkdir(exist_ok=True)
        shutil.copytree(app, destination)
        subprocess.run(["/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
                        "-f", str(destination)], check=True, capture_output=True)
        stack.write_text(new_stack)
        for path, data in agents:
            path.write_bytes(plistlib.dumps(data))
            launchctl("bootstrap", domain, str(path))
        for _ in range(30):
            try:
                for path, _ in agents:
                    service_state = launchctl("print", f"{domain}/{path.stem}").stdout.decode()
                    match = re.search(r'\n\s*pid = (\d+)', service_state)
                    if not match:
                        raise OSError("Host service is not running")
                    command = subprocess.check_output(["ps", "-p", match[1], "-o", "comm="]).decode().strip()
                    if command != str(executable):
                        raise OSError("Service is not running through the host")
                with urllib.request.urlopen("http://127.0.0.1:3100/health", timeout=1) as response:
                    if response.status != 200:
                        raise OSError("Backend is not ready")
                try:
                    urllib.request.urlopen("http://127.0.0.1:9400/mcp", timeout=1).close()
                except urllib.error.HTTPError as error:
                    if error.code != 401:
                        raise
                break
            except OSError:
                time.sleep(1)
        else:
            raise RuntimeError("Backend health check failed")
    except Exception:
        for path, _ in agents:
            launchctl("bootout", domain, str(path), check=False)
            shutil.copy2(backup / path.name, path)
        shutil.copy2(backup / stack.name, stack)
        if destination.exists():
            shutil.rmtree(destination)
        if had_app:
            shutil.copytree(backup / destination.name, destination)
        for path, _ in agents:
            launchctl("bootstrap", domain, str(path), check=False)
        raise
    print(f"Installed: {destination}")
    print(f"Rollback backup: {backup}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=pathlib.Path, required=True)
    args = parser.parse_args()
    install(args.app.resolve())
