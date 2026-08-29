"""Test-only helpers shared by photo, dedupe and pipeline tests."""

import io
import random

from PIL import Image, ImageDraw


def make_jpeg(width: int, height: int, seed: int = 0) -> bytes:
    """A photo-like JPEG: a smooth gradient plus four large blocks placed by `seed`.

    The composition scales with the canvas, so one seed rendered at two sizes hashes
    alike, while different seeds give clearly different pictures.
    """
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)
    for x in range(width):
        v = int(255 * x / max(1, width - 1))
        draw.line(
            [(x, 0), (x, height)], fill=((v + seed * 37) % 256, 255 - v, (v // 2 + seed * 91) % 256)
        )
    rng = random.Random(seed)
    for _ in range(4):
        x0, y0 = rng.uniform(0.0, 0.6), rng.uniform(0.0, 0.6)
        color = (rng.randrange(256), rng.randrange(256), rng.randrange(256))
        box = [
            int(x0 * width),
            int(y0 * height),
            int((x0 + 0.35) * width),
            int((y0 + 0.35) * height),
        ]
        draw.rectangle(box, fill=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
