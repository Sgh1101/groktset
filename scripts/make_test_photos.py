#!/usr/bin/env python3
"""Generate small valid PNG test images (no external deps)."""
import struct
import zlib
import sys
import os


def png(path, w, h, rgb):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            r = (rgb[0] + x) % 256
            g = (rgb[1] + y) % 256
            b = rgb[2]
            raw += bytes((r, g, b))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(data)
    print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    outdir = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(outdir, exist_ok=True)
    palette = [
        ("beach.png", (240, 120, 60)),
        ("mountain.png", (60, 180, 200)),
        ("sunset.png", (250, 90, 140)),
        ("forest.png", (40, 200, 120)),
        ("city.png", (150, 120, 240)),
    ]
    for i, (name, color) in enumerate(palette):
        png(os.path.join(outdir, name), 240, 180, color)
