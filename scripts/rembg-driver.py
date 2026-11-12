import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
model = root / "models" / "u2netp" / "u2netp.onnx"
if not model.is_file():
    raise RuntimeError("Missing bundled u2netp.onnx")
os.environ["REMBG_HOME"] = str(root)
os.environ["OMP_NUM_THREADS"] = "2"
sys.path.insert(0, str(root / "packages"))

from PIL import Image
from rembg import new_session, remove

mode, source, output = sys.argv[1:]
source, output = Path(source), Path(output)
session = new_session("u2netp", providers=["CPUExecutionProvider"])


def segment(path, destination):
    with Image.open(path) as image:
        remove(image, session=session).save(destination, format="PNG")


if mode == "i":
    segment(source, output)
elif mode == "p":
    for frame in sorted(source.glob("[0-9][0-9][0-9][0-9][0-9].png")):
        segment(frame, output / frame.name)
elif mode == "test":
    image = Image.new("RGB", (128, 128), "white")
    image.paste("navy", (25, 22, 98, 104))
    result = remove(image, session=session)
    assert result.mode == "RGBA" and result.getchannel("A").getextrema()[0] < 255
else:
    raise ValueError("Unknown rembg mode")
