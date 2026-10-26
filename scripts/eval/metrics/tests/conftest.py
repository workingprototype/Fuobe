import pathlib
import sys

# The package sits next to the tests (scripts/eval/metrics/fuobe_metrics).
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
FIXTURES = pathlib.Path(__file__).resolve().parents[2] / "fixtures"
