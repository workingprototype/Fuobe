"""promote --record: results go into the research entry they measured, replacing the same engine and case."""

import json

from fuobe_metrics import research


def doc():
    return {
        "conventions": {"lora": "…"},
        "presets": [{"id": "look-1", "name": "General", "loras": [{"file": "a.safetensors", "strength": 1.0}]}],
        "motionsEffects": [{"kind": "motion", "presets": ["Overhead", "Crane Up"], "loras": []}],
    }


def record(engine="open", case="soul/v1-general", verdict="hold", **target):
    return {"target": target or {"look": "look-1"}, "engine": engine, "case": case, "runId": "r1", "verdict": verdict}


def test_records_land_in_their_entry_and_replace_the_same_engine_and_case():
    d = doc()
    out = research.apply_records(d, [record(), record(engine="cloud"), record(motion="crane up", case="dop/motion-crane-up")])
    assert out == {"recorded": 3, "missing": [], "lowered": []}
    assert [r["engine"] for r in d["presets"][0]["eval"]] == ["open", "cloud"]
    assert "target" not in d["presets"][0]["eval"][0]
    assert d["motionsEffects"][0]["eval"][0]["preset"] == "crane up"
    assert "eval" in d["conventions"]
    # A newer open run of the same case replaces the older record; the recipe itself is untouched.
    research.apply_records(d, [record(verdict="promote")])
    assert [(r["engine"], r["verdict"]) for r in d["presets"][0]["eval"]] == [("cloud", "hold"), ("open", "promote")]
    assert d["presets"][0]["loras"][0]["strength"] == 1.0


def test_unknown_targets_are_reported_not_invented():
    d = doc()
    out = research.apply_records(d, [record(look="nope"), record(motion="Dolly Zoom")])
    assert out["recorded"] == 0 and len(out["missing"]) == 2
    assert "eval" not in d["conventions"]


def test_the_file_keeps_its_format(tmp_path):
    d = doc()
    d["presets"][0]["name"] = "Café → film"
    f = tmp_path / "research.json"
    f.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    recs = tmp_path / "records.json"
    recs.write_text(json.dumps([record()]), encoding="utf-8")
    assert research.main([str(recs), str(f)]) == 0
    text = f.read_text(encoding="utf-8")
    assert "Café → film" in text and "\\u" not in text
    assert text.endswith("}\n") and text.startswith('{\n "conventions"')
    assert json.loads(text)["presets"][0]["loras"][0]["strength"] == 1.0


def test_apply_strengths_lowers_only_the_entry_it_measured_and_says_so():
    d = doc()
    suggested = [{"file": "a.safetensors", "strength": 0.5}, {"file": "not-in-entry.safetensors", "strength": 0.2}]
    lower = {**record(verdict="lower strengths"), "suggestedLoras": suggested}
    # Without applyStrengths the suggestion is only recorded.
    research.apply_records(d, [lower])
    assert d["presets"][0]["loras"][0]["strength"] == 1.0
    out = research.apply_records(d, [{**lower, "applyStrengths": True}])
    assert d["presets"][0]["loras"][0]["strength"] == 0.5
    assert out["lowered"] == [{"entry": "General", "file": "a.safetensors", "from": 1.0, "to": 0.5}]
    rec = d["presets"][0]["eval"][-1]
    assert rec["appliedStrengths"] == [{"file": "a.safetensors", "from": 1.0, "to": 0.5}]
    assert "applyStrengths" not in rec
