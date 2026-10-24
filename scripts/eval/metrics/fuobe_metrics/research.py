"""Record evaluation results back into the research JSON (pnpm eval:promote <run> --record).

Each record lands in the `eval` list of the entry it measured: a Soul look's `presets[]` entry (by id)
or the `motionsEffects[]` entry that lists the motion or effect. A newer record for the same engine and
case replaces the older one. Strengths change only when a record asks (`applyStrengths`, from
`--apply-strengths`, where half strength won): the entry's LoRAs take the strengths that run used, and
the record lists each change. Nothing else in a recipe changes, and a person reviews the diff, runs
gen:catalog and commits it.

Standard library only, so any Python 3 runs it. The file is written the way the research tools write
it (indent 1, UTF-8 kept, a final newline), so the diff shows only the records.

    python3 -I research.py <records.json> <research.json>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

CONVENTION = (
    "eval: results from the evaluation harness (scripts/eval, pnpm eval:promote <run> --record), one per "
    "engine and case: run id, date, candidate variant, verdict (promote / lower strengths / hold) and why, "
    "the look's main metric against each alternative, the LoRAs it ran and suggested lower strengths "
    "(appliedStrengths when --apply-strengths lowered them here). A person reviews and commits any change."
)


def _find(doc: dict, target: dict) -> dict | None:
    if target.get("look"):
        return next((p for p in doc.get("presets", []) if p.get("id") == target["look"]), None)
    if target.get("motion"):
        want = str(target["motion"]).lower()
        return next(
            (m for m in doc.get("motionsEffects", []) if any(str(p).lower() == want for p in m.get("presets", []))),
            None,
        )
    return None


def _lower(entry: dict, suggested: list[dict]) -> list[dict]:
    """Set the entry's LoRAs (by file) to the suggested strengths; returns the changes made."""
    changes = []
    want = {s.get("file"): s.get("strength") for s in suggested if s.get("file") and isinstance(s.get("strength"), (int, float))}
    for lora in entry.get("loras", []) or []:
        to = want.get(lora.get("file"))
        if to is None or lora.get("strength") == to:
            continue
        changes.append({"file": lora.get("file"), "from": lora.get("strength"), "to": to})
        lora["strength"] = to
    return changes


def apply_records(doc: dict, records: list[dict]) -> dict:
    """Put each record into its entry; returns {"recorded": n, "missing": [targets not found], "lowered": [changes]}."""
    recorded = 0
    missing = []
    lowered = []
    for rec in records:
        target = rec.get("target") or {}
        entry = _find(doc, target)
        if entry is None:
            missing.append(target)
            continue
        body = {k: v for k, v in rec.items() if k not in ("target", "applyStrengths")}
        if rec.get("applyStrengths") and rec.get("suggestedLoras"):
            changes = _lower(entry, rec["suggestedLoras"])
            if changes:
                body["appliedStrengths"] = changes
                name = target.get("look") or target.get("motion")
                lowered.extend({"entry": entry.get("name") or name, **c} for c in changes)
        if target.get("motion"):
            body = {"preset": target["motion"], **body}
        kept = [r for r in entry.get("eval", []) if not (r.get("engine") == body.get("engine") and r.get("case") == body.get("case"))]
        entry["eval"] = kept + [body]
        recorded += 1
    if recorded:
        doc.setdefault("conventions", {})["eval"] = CONVENTION
    return {"recorded": recorded, "missing": missing, "lowered": lowered}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1].strip(), file=sys.stderr)
        return 2
    records = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    path = Path(argv[1])
    doc = json.loads(path.read_text(encoding="utf-8"))
    result = apply_records(doc, records)
    if result["recorded"]:
        path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
