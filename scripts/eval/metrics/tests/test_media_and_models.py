"""Decoding (needs ffmpeg) and the model wrappers (need the metrics venv and cached weights)."""

import json
import os
import pathlib
import shutil
import subprocess

import numpy as np
import pytest
from conftest import FIXTURES

from fuobe_metrics import media

needs_ffmpeg = pytest.mark.skipif(not media.have_ffmpeg(), reason="ffmpeg isn't installed")


def _clip(tmp_path, name="clip.mp4", seconds=2, size="160x96", audio=True):
    out = tmp_path / name
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=12:duration={seconds}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-shortest"]
    cmd += ["-pix_fmt", "yuv420p", str(out)]
    subprocess.run(cmd, check=True)
    return out


def test_kind_of():
    assert media.kind_of("a/b.PNG") == "image"
    assert media.kind_of("x.svg") == "image"
    assert media.kind_of("x.mov") == "video"
    assert media.kind_of("x.wav") == "audio"
    assert media.kind_of("x.glb") is None


def test_load_image_png():
    img = media.load_image(FIXTURES / "palette.png")
    assert img.mode == "RGB" and img.size == (500, 100)


@needs_ffmpeg
def test_load_image_rasterises_svg(tmp_path):
    svg = tmp_path / "demo.svg"
    svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#ff0000"/></svg>')
    img = media.load_image(svg)
    assert img.size == (64, 32)
    r, g, b = img.getpixel((10, 10))
    assert r > 200 and g < 50 and b < 50


@needs_ffmpeg
def test_video_frames_audio_and_probe(tmp_path):
    clip = _clip(tmp_path)
    info = media.probe(clip)
    assert info["width"] == 160 and info["audio"] is True and abs(info["duration"] - 2) < 0.2
    frames, rate = media.video_frames(clip, fps=4, max_frames=32, width=64)
    assert frames.shape[1:] == (38, 64, 3) or frames.shape[1:] == (40, 64, 3)
    assert 7 <= len(frames) <= 9 and rate == 4
    few, rate2 = media.video_frames(clip, fps=24, max_frames=6, width=64)
    assert len(few) <= 6 and rate2 == pytest.approx(3.0, rel=0.1)
    sound = media.audio_track(clip)
    assert sound is not None and abs(len(sound) / 16000 - 2) < 0.1 and np.abs(sound).max() > 0.1
    assert media.audio_track(_clip(tmp_path, "silent.mp4", audio=False)) is None
    assert len(media.images_of(clip, frames=3)) == 3


@needs_ffmpeg
def test_score_cli_on_a_run_without_models(tmp_path):
    """The scorer reads a run folder and writes metrics.json; with no metric asked for it still writes a valid file."""
    run = tmp_path / "run"
    (run / "outputs" / "j1").mkdir(parents=True)
    shutil.copy(FIXTURES / "palette.png", run / "outputs" / "j1" / "1.png")
    (run / "run.json").write_text(json.dumps({"runId": "r", "suite": "s"}))
    (run / "jobs.jsonl").write_text(json.dumps({"id": "j1", "status": "succeeded", "metrics": [], "outputs": [{"file": "outputs/j1/1.png"}]}) + "\n")
    from fuobe_metrics.score import main

    assert main([str(run)]) == 0
    doc = json.loads((run / "metrics.json").read_text())
    assert doc["version"] == 1 and "j1" in doc["jobs"] and doc["groups"] == {}
    assert main([str(run), "--metrics", "smell"]) == 2


def _weights_cached(key):
    """Model tests run only when the weights are already in the cache (pnpm eval:setup --download), or FUOBE_EVAL_MODEL_TESTS=1."""
    from fuobe_metrics.models import CACHE

    return os.environ.get("FUOBE_EVAL_MODEL_TESTS") == "1" or any((CACHE / "hf").glob(f"models--{key.replace('/', '--')}"))


@needs_ffmpeg
def test_clip_prefers_the_matching_caption():
    pytest.importorskip("torch")
    pytest.importorskip("open_clip")
    if not _weights_cached("laion/CLIP-ViT-B-32-laion2B-s34B-b79K"):
        pytest.skip("CLIP weights aren't cached (pnpm eval:setup --download)")
    from fuobe_metrics import maths
    from fuobe_metrics.models import Clip

    clip = Clip("clip-b32")
    img = clip.images([media.load_image(FIXTURES / "palette.png")])[0]
    texts = clip.texts(["five coloured stripes side by side", "a dog running on a beach"])
    assert maths.clip_score(img, texts[0]) > maths.clip_score(img, texts[1])


@needs_ffmpeg
def test_aesthetic_scores_are_on_the_predictor_scale():
    pytest.importorskip("torch")
    pytest.importorskip("open_clip")
    if not _weights_cached("timm/vit_large_patch14_clip_224.openai"):
        pytest.skip("CLIP ViT-L/14 weights aren't cached (pnpm eval:setup --download)")
    from fuobe_metrics.models import Aesthetic, Clip

    a = Aesthetic(Clip("clip-l14"))
    s = a.scores([media.load_image(FIXTURES / "start-frame.png")])
    assert s.shape == (1,) and 0.0 < float(s[0]) < 10.0


def test_faces_on_drawn_faces_do_not_crash():
    pytest.importorskip("insightface")
    if not _weights_cached("fal/AuraFace-v1"):
        pytest.skip("AuraFace weights aren't cached (pnpm eval:setup --identity --download)")
    from fuobe_metrics.models import Faces

    f = Faces("auraface")
    got = f.largest(media.load_image(FIXTURES / "character" / "drawn-face-1.png"))
    assert got is None or (got["embedding"].shape == (512,) and abs(np.linalg.norm(got["embedding"]) - 1) < 1e-3)


def test_fixtures_are_where_the_tests_expect():
    assert (FIXTURES / "palette.png").exists()
    assert pathlib.Path(media.__file__).name == "media.py"
