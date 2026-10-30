"""Writes the synthetic fixtures the demo runs use (no people, no third-party media).

python3 -I scripts/eval/fixtures/make-fixtures.py   (needs numpy and Pillow)
"""
import math
import pathlib
import shutil
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).resolve().parent


def gradient(w, h, a, b):
    t = np.linspace(0, 1, w)[None, :, None]
    img = (np.array(a)[None, None, :] * (1 - t) + np.array(b)[None, None, :] * t).repeat(h, axis=0)
    return Image.fromarray(img.astype(np.uint8), "RGB")


def scene(path, sky, ground, sun):
    img = gradient(512, 512, sky, ground)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 340, 512, 512], fill=tuple(int(c * 0.6) for c in ground))
    d.ellipse([sun[0] - 40, sun[1] - 40, sun[0] + 40, sun[1] + 40], fill=(255, 214, 120))
    d.rectangle([236, 220, 276, 360], fill=(170, 30, 40))  # a figure in a red coat, drawn as blocks
    d.ellipse([238, 184, 274, 220], fill=(225, 190, 160))
    img.save(path, optimize=True)


def face(path, hue):
    img = Image.new("RGB", (384, 384), (238, 232, 222))
    d = ImageDraw.Draw(img)
    skin = tuple(int(c) for c in hue)
    d.ellipse([92, 60, 292, 300], fill=skin)
    d.ellipse([140, 150, 170, 170], fill=(40, 40, 40))
    d.ellipse([214, 150, 244, 170], fill=(40, 40, 40))
    d.arc([150, 210, 234, 260], 10, 170, fill=(120, 40, 40), width=6)
    img.save(path, optimize=True)


def palette(path):
    colours = [(31, 42, 68), (201, 122, 64), (234, 214, 170), (94, 140, 120), (180, 60, 70)]
    img = Image.new("RGB", (500, 100))
    d = ImageDraw.Draw(img)
    for i, c in enumerate(colours):
        d.rectangle([i * 100, 0, i * 100 + 100, 100], fill=c)
    img.save(path, optimize=True)


def voice(path, seconds=2.0, rate=16000):
    """A tone that rises and falls like syllables (four a second), for lip-sync demo runs."""
    t = np.arange(int(seconds * rate)) / rate
    envelope = np.clip(np.sin(2 * math.pi * 2 * t), 0, None) ** 2
    signal = 0.4 * envelope * np.sin(2 * math.pi * 180 * t + 3 * np.sin(2 * math.pi * 3 * t))
    pcm = (signal * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def walk(path, seconds=6, fps=24, w=432, h=768):
    """A drawn figure (blocks, no person) walking across a two-tone scene with a hum: Character swap needs 5 s or more."""
    if not shutil.which("ffmpeg"):
        print("ffmpeg not found: skipping", path.name)
        return
    x = f"60+(t/{seconds})*({w}-180)"
    graph = (
        f"color=c=0x8fb4dc:s={w}x{h}:r={fps}:d={seconds},drawbox=x=0:y={h * 2 // 3}:w={w}:h={h // 3}:color=0xc89a6e:t=fill[bg];"
        f"color=c=0xaa1e28:s=60x200:r={fps}:d={seconds}[coat];"
        f"color=c=0xe1bea0:s=36x40:r={fps}:d={seconds}[head];"
        f"[bg][coat]overlay=x='{x}':y={h // 2 - 40}[a];"
        f"[a][head]overlay=x='{x}+12':y={h // 2 - 84},format=yuv420p[v]"
    )
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-filter_complex", graph, "-f", "lavfi", "-i", f"sine=frequency=180:duration={seconds}",
         "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-crf", "30", "-preset", "veryslow", "-c:a", "aac", "-b:a", "32k",
         "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact", str(path)],
        check=True,
    )


if __name__ == "__main__":
    scene(HERE / "start-frame.png", (120, 160, 220), (230, 170, 110), (380, 120))
    scene(HERE / "end-frame.png", (40, 50, 90), (90, 70, 120), (120, 110))
    (HERE / "character").mkdir(exist_ok=True)
    for i, hue in enumerate([(224, 186, 150), (214, 176, 140), (230, 196, 160)], start=1):
        face(HERE / "character" / f"drawn-face-{i}.png", hue)
    (HERE / "references").mkdir(exist_ok=True)
    scene(HERE / "references" / "warm-1.png", (250, 190, 120), (200, 120, 80), (256, 140))
    scene(HERE / "references" / "warm-2.png", (240, 170, 110), (190, 110, 70), (330, 150))
    palette(HERE / "palette.png")
    voice(HERE / "voice.wav")
    walk(HERE / "walk-6s.mp4")
    print("fixtures written to", HERE)
