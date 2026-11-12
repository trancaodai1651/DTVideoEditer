"""Bundle the Whisper GGML model used for automatic captions.

Run after package-rembg.py: the resource entry is merged into the same
Tauri bundle configuration so one `--config` adds both runtimes.
"""

import hashlib
import json
import shutil
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TAURI = ROOT / "apps" / "desktop" / "src-tauri"
OUTPUT = TAURI / "target" / "whisper-assets"
CONFIG = TAURI / "target" / "rembg.bundle.json"
# Multilingual "small" model, 5-bit quantized: good Vietnamese accuracy at ~190 MB.
MODEL = "ggml-small-q5_1.bin"
REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1"
DIGEST = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT / MODEL
    if not destination.is_file() or digest(destination) != DIGEST:
        partial = destination.with_suffix(".partial")
        url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/{REVISION}/{MODEL}"
        try:
            with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as out:
                shutil.copyfileobj(response, out)
            if digest(partial) != DIGEST:
                raise ValueError(f"Checksum mismatch for {MODEL}")
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)
    config = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.is_file() else {}
    resources = config.setdefault("bundle", {}).setdefault("resources", {})
    resources[destination.relative_to(TAURI).as_posix()] = f"whisper/{MODEL}"
    CONFIG.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"{MODEL}: {destination.stat().st_size:,} bytes", flush=True)


if __name__ == "__main__":
    main()
