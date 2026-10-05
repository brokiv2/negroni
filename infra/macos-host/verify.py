#!/usr/bin/env python3
"""Offline lifecycle/identity check; never touches production services or TCC grants."""
import argparse
import json
import pathlib
import subprocess
import tempfile
from build import build


def verify(node, identity):
    with tempfile.TemporaryDirectory(prefix="negroni-host-check-") as folder:
        root = pathlib.Path(folder)
        services = root / "services"
        services.mkdir()
        # Exercise the actual native parent -> shell -> interpreter chain.
        (services / "negroni-stack.sh").write_text('''#!/bin/zsh
trap 'print stopped > "$0.stopped"; exit 0' TERM INT
"$NEGRONI_NODE_BIN" -e 'console.log(JSON.stringify({node:process.execPath, configured:process.env.NEGRONI_NODE_BIN, path:process.env.PATH}))'
while true; do sleep 0.1; done
''')
        (services / "mac-control").mkdir()
        (services / "mac-control/server.mjs").write_text("process.exit(23);\n")
        addon_source = root / "addon.c"
        addon_source.write_text("void *napi_register_module_v1(void *env, void *exports) { return exports; }\n")
        addon = root / "addon.node"
        subprocess.run(["xcrun", "clang", "-dynamiclib", "-undefined", "dynamic_lookup",
                        str(addon_source), "-o", str(addon)], check=True)
        requirements = []
        for name in ["first", "rebuilt"]:
            app = root / name / "Negroni Host.app"
            build(app, node, identity, services)
            host = app / "Contents/MacOS/NegroniHost"
            subprocess.run([str(app / "Contents/Helpers/node"), "-e", "require(process.argv[1])",
                            str(addon)], check=True)
            result = subprocess.run([str(host), "--service", "arbitrary-command"], capture_output=True)
            assert result.returncode == 64, "Unknown services must not execute"
            result = subprocess.run([str(host), "--service", "mac-control"], capture_output=True)
            assert result.returncode == 23, "Child exit status must reach launchd"
            proc = subprocess.Popen([str(host), "--service", "backend"], stdout=subprocess.PIPE, text=True)
            try:
                data = json.loads(proc.stdout.readline())
                expected = (app / "Contents/Helpers/node").resolve()
                assert pathlib.Path(data["node"]).resolve() == expected
                assert pathlib.Path(data["configured"]).resolve() == expected
                assert pathlib.Path(data["path"].split(":")[0]).resolve() == expected.parent
            finally:
                proc.terminate()
                proc.wait(timeout=5)
                proc.stdout.close()
            assert (services / "negroni-stack.sh.stopped").read_text().strip() == "stopped"
            (services / "negroni-stack.sh.stopped").unlink()
            signed = subprocess.run(["codesign", "-d", "-r-", str(app)], capture_output=True, text=True, check=True)
            requirement = next(line for line in (signed.stdout + signed.stderr).splitlines()
                               if line.startswith("designated =>"))
            assert "cdhash" not in requirement, "Rebuilds must not replace identity with a code hash"
            requirements.append(requirement)
        assert requirements[0] == requirements[1], "Signing identity must survive rebuilds"
        print("PASS: bundled Node, native addons, inherited PATH, child exit status, shutdown forwarding, stable rebuild identity")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", type=pathlib.Path, required=True)
    parser.add_argument("--identity", required=True)
    args = parser.parse_args()
    verify(args.node.resolve(), args.identity)
