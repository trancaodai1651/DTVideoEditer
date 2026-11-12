"""Bundle the offline, CPU rembg runtime for the current installer platform."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TAURI = ROOT / "apps" / "desktop" / "src-tauri"
OUTPUT = TAURI / "target" / "rembg-assets"
PYTHON_RELEASE = "20261110"
PYTHON_VERSION = "3.12.16"
TARGETS = {
    "win32": [
        ("windows-x86_64", "x86_64-pc-windows-msvc", "e23fe5b16926de1d81661b1a97352e89fb167549c55a6825796ccd0f32ec7f1b"),
    ],
    "darwin": [
        ("macos-aarch64", "aarch64-apple-darwin", "e956e60bc9465d577ef8062059aa05cd3a2665b4b8678a2ed24e432368330b8f"),
        ("macos-x86_64", "x86_64-apple-darwin", "83f2922437e6d546d0fcdb8c11f150a8e52787e8d9ea8651b1974e20908eb1bc"),
    ],
}


def download(url, path, expected):
    with urllib.request.urlopen(url, timeout=90) as response, path.open("wb") as out:
        shutil.copyfileobj(response, out)
    with path.open("rb") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != expected:
            raise ValueError(f"Checksum mismatch for {path.name}")


def package(name, target, digest):
    destination = OUTPUT / f"{name}.tar.gz"
    with tempfile.TemporaryDirectory(prefix="dt-rembg-") as directory:
        work = Path(directory)
        base = work / "runtime"
        base.mkdir()
        python_archive = work / "python.tar.gz"
        download(
            f"https://github.com/astral-sh/python-build-standalone/releases/download/{PYTHON_RELEASE}/"
            f"cpython-{PYTHON_VERSION}%2B{PYTHON_RELEASE}-{target}-install_only.tar.gz",
            python_archive, digest,
        )
        with tarfile.open(python_archive) as archive:
            archive.extractall(base, filter="data")
        python = base / "python" / ("python.exe" if sys.platform == "win32" else "bin/python3.12")
        # Use the target interpreter so pip resolves wheels for its ABI and architecture.
        subprocess.run([python, "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:",
                        "--no-compile", "--target", base / "packages", "rembg[cpu]==2.0.87"], check=True)
        model = base / "models" / "u2netp" / "u2netp.onnx"
        model.parent.mkdir(parents=True)
        download("https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx", model,
                 "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8")
        driver = base / "driver.py"
        shutil.copyfile(ROOT / "scripts" / "rembg-driver.py", driver)
        env = {**os.environ, "NUMBA_CACHE_DIR": str(work / "numba")}
        subprocess.run([python, "-I", "-B", driver, "test", "-", "-"], check=True, env=env, timeout=240)
        staging = OUTPUT / f"{name}.partial"
        try:
            with tarfile.open(staging, "w:gz", compresslevel=5) as archive:
                for child in sorted(base.iterdir()):
                    archive.add(child, arcname=child.name)
            staging.replace(destination)
        finally:
            staging.unlink(missing_ok=True)
    print(f"{destination.name}: {destination.stat().st_size:,} bytes", flush=True)
    return destination


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    resources = {}
    for target in TARGETS[sys.platform]:
        archive = package(*target)
        resources[archive.relative_to(TAURI).as_posix()] = f"rembg/{archive.name}"
    config = TAURI / "target" / "rembg.bundle.json"
    config.write_text(json.dumps({"bundle": {"resources": resources}}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
