"""
Сверка ответа /api/simulate с эталонными фикстурами фронта.

frontend/public/mock/simulate-*.json — четыре полных суточных расчёта по
720 отсчётов, собранные независимой реализацией (localSimulator.ts).
Сверяются рёбра сети, маршруты, причины перерывов, перерывы, метрики,
константы и сводка — то есть весь ответ, а не только итоговые проценты.

Запуск (сервер должен быть поднят):

    uv run uvicorn src.main:app --port 8000     # из папки backend
    uv run python backend/tests/check_against_fixtures.py

Код возврата 1, если хоть что-то разошлось.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).parent.parent.parent
DATA_DIR = ROOT / 'case' / 'Данные'
FIXTURE_DIR = ROOT / 'frontend' / 'public' / 'mock'

SCENARIOS = (
    '01_full_constellation',
    '02_first_launch',
    '03_satellite_outages',
    '04_link_range',
)

#: Допуски. Проценты фронт и бэк округляют до сотых одинаково, но порядок
#: суммирования float отличается, поэтому сравниваем с запасом в один разряд.
TOLERANCE_PCT = 0.011
TOLERANCE_KM = 0.6
TOLERANCE_EDGES = 0.11


def post(base_url: str, path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        base_url + path,
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def close(left, right, tolerance: float) -> bool:
    if left is None or right is None:
        return left == right

    return abs(left - right) <= tolerance


def compare(got: dict, ref: dict) -> list[str]:
    problems: list[str] = []

    for key in ('scenario_id', 'n_steps', 'step_s', 'horizon_s'):
        if got['meta'][key] != ref['meta'][key]:
            problems.append(
                f'meta.{key}: {got["meta"][key]} != {ref["meta"][key]}'
            )

    for key, value in ref['constants'].items():
        if not close(got['constants'][key], value, 1e-6):
            problems.append(
                f'constants.{key}: {got["constants"][key]} != {value}'
            )

    if len(got['steps']) != len(ref['steps']):
        problems.append(
            f'шагов {len(got["steps"])} вместо {len(ref["steps"])}'
        )
    else:
        bad_edges = sum(
            1
            for a, b in zip(got['steps'], ref['steps'])
            if {tuple(e) for e in a['edges']} != {tuple(e) for e in b['edges']}
        )
        bad_inactive = sum(
            1
            for a, b in zip(got['steps'], ref['steps'])
            if set(a['inactive']) != set(b['inactive'])
        )
        if bad_edges:
            problems.append(f'рёбра расходятся на {bad_edges} шагах')
        if bad_inactive:
            problems.append(f'inactive расходится на {bad_inactive} шагах')

    for client, ref_routes in ref['routes'].items():
        if client not in got['routes']:
            problems.append(f'клиента {client} нет в routes')
            continue

        got_routes = got['routes'][client]
        if len(got_routes) != len(ref_routes):
            problems.append(
                f'{client}: маршрутов {len(got_routes)} '
                f'вместо {len(ref_routes)}'
            )
            continue

        # Маршрут той же длины может идти через другие аппараты — это
        # законно при равных весах, поэтому сверяем длину, а не состав.
        diff = sum(
            1 for a, b in zip(got_routes, ref_routes) if len(a) != len(b)
        )
        if diff:
            problems.append(
                f'{client}: длина маршрута отличается на {diff} отсчётах'
            )

        diff = sum(
            1
            for a, b in zip(got['reasons'][client], ref['reasons'][client])
            if a != b
        )
        if diff:
            problems.append(
                f'{client}: причина перерыва отличается на {diff} отсчётах'
            )

    for client, ref_metrics in ref['metrics'].items():
        got_metrics = got['metrics'].get(client)
        if got_metrics is None:
            problems.append(f'нет метрик по {client}')
            continue

        for key in (
            'visibility_pct',
            'availability_pct',
            'max_gap_s',
            'total_outage_s',
        ):
            if not close(got_metrics[key], ref_metrics[key], TOLERANCE_PCT):
                problems.append(
                    f'{client}.{key}: {got_metrics[key]} '
                    f'!= {ref_metrics[key]}'
                )

        if got_metrics['target_met'] != ref_metrics['target_met']:
            problems.append(f'{client}.target_met расходится')

        if not close(
            got_metrics['avg_path_km'],
            ref_metrics['avg_path_km'],
            TOLERANCE_KM,
        ):
            problems.append(
                f'{client}.avg_path_km: {got_metrics["avg_path_km"]} '
                f'!= {ref_metrics["avg_path_km"]}'
            )

        if got_metrics['hops']['histogram'] != ref_metrics['hops']['histogram']:
            problems.append(f'{client}.hops.histogram расходится')

        if len(got_metrics['gaps']) != len(ref_metrics['gaps']):
            problems.append(
                f'{client}: перерывов {len(got_metrics["gaps"])} '
                f'вместо {len(ref_metrics["gaps"])}'
            )
        else:
            bad = sum(
                1
                for a, b in zip(got_metrics['gaps'], ref_metrics['gaps'])
                if (a['start_s'], a['end_s'], a['reason'])
                != (b['start_s'], b['end_s'], b.get('reason'))
            )
            if bad:
                problems.append(f'{client}: {bad} перерывов отличаются')

    for key in ('all_targets_met', 'worst_client'):
        if got['summary'][key] != ref['summary'][key]:
            problems.append(
                f'summary.{key}: {got["summary"][key]} '
                f'!= {ref["summary"][key]}'
            )

    for key in (
        'worst_availability_pct',
        'avg_isl_edges_per_step',
        'avg_ground_edges_per_step',
    ):
        if not close(got['summary'][key], ref['summary'][key], TOLERANCE_EDGES):
            problems.append(
                f'summary.{key}: {got["summary"][key]} '
                f'!= {ref["summary"][key]}'
            )

    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:8000/api')
    args = parser.parse_args()

    failed = 0
    for name in SCENARIOS:
        scenario = json.loads(
            (DATA_DIR / f'{name}.json').read_text(encoding='utf-8'),
        )
        ref = json.loads(
            (FIXTURE_DIR / f'simulate-{name}.json').read_text(encoding='utf-8'),
        )
        got = post(
            args.base_url,
            '/simulate',
            {'scenario': scenario, 'options': {'routing': 'min_hops'}},
        )

        if got.get('valid') is not True:
            print(f'✗ {name}: расчёт не выполнен — {str(got)[:200]}')
            failed += 1
            continue

        problems = compare(got, ref)
        if problems:
            failed += 1
            print(f'✗ {name}')
            for problem in problems[:12]:
                print(f'    {problem}')
        else:
            print(
                f'✓ {name}: {got["meta"]["n_steps"]} шагов, '
                f'{got["meta"]["computed_ms"]} мс — совпало полностью'
            )

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
