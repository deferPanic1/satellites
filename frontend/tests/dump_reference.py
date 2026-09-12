"""
Выгружает эталонные позиции из geometry.py для сверки с TS-портом.

Запуск из корня репозитория:
    python3 frontend/tests/dump_reference.py > /tmp/ref.json
    node frontend/tests/orbital.check.mjs /tmp/ref.json
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "doc" / "Расчетный модуль"))

import geometry as G  # noqa: E402

SCENARIO = ROOT / "doc" / "Данные" / "01_full_constellation.json"
SAMPLE_TIMES = [0, 120, 1800, 3600, 21600, 43200, 60000, 86280]

scenario = G.load(str(SCENARIO))
samples = []
for t in SAMPLE_TIMES:
    ids, _inertial, fixed = G.positions(scenario, t)
    samples.append(
        {
            "t_s": t,
            "positions": {sid: list(map(float, fixed[k])) for k, sid in enumerate(ids)},
        }
    )

json.dump(
    {"scenario": scenario, "samples": samples},
    sys.stdout,
    ensure_ascii=False,
)
