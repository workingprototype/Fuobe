"""Record evaluation results back into the research JSON (pnpm eval:promote <run> --record).

Each record lands in the `eval` list of the entry it measured: a Soul look's `presets[]` entry (by id)
or the `motionsEffects[]` entry that lists the motion or effect. A newer record for the same engine and
case replaces the older one. Strengths and defaults are never changed here: the record says what the
run found (and the lower strengths it suggests); a person changes the recipe in a reviewed commit.

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
    "the look's main metric against each alternative, the LoRAs it ran and suggested lower strengths. "
    "A record never changes a recipe or a default; a person does, in a reviewed commit."
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


def apply_records(doc: dict, records: list[dict]) -> dict:
    """Put each record into its entry; returns {"recorded": n, "missing": [targets not found]}."""
    recorded = 0
    missing = []
    for rec in records:
        target = rec.get("target") or {}
        entry = _find(doc, target)
        if entry is None:
            missing.append(target)
            continue
        body = {k: v for k, v in rec.items() if k != "target"}
        if target.get("motion"):
            body = {"preset": target["motion"], **body}
        kept = [r for r in entry.get("eval", []) if not (r.get("engine") == body.get("engine") and r.get("case") == body.get("case"))]
        entry["eval"] = kept + [body]
        recorded += 1
    if recorded:
        doc.setdefault("conventions", {})["eval"] = CONVENTION
    return {"recorded": recorded, "missing": missing}


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
