"""
Полный расчёт на весь горизонт: один запрос отдаёт всё, что рисует интерфейс.

Геометрию считает модуль организаторов (geometry.py) — он здесь только
вызывается и не правится. Этот модуль собирает вокруг него то, чего в нём
нет: маршруты на каждом отсчёте, причины перерывов, метрики по клиентам и
сводку по сценарию.

Округление везде питоновское (половина к ближайшему чётному). Фронт в
localSimulator.ts специально повторяет это правило, поэтому расхождений
в сотых долях между сервером и запасным локальным расчётом не возникает.
"""

from __future__ import annotations

import math
import time
import typing

import src.schemas.result as result_schemas
from src.services import geometry, routing


def _round(value: float, digits: int = 2) -> float:
    return round(value, digits)


def _mean(values: typing.Sequence[float]) -> float:
    return sum(values) / len(values)


def _collect_gaps(
    reasons: list[routing.OutageReason | None],
    step_s: int,
    horizon_s: int,
) -> list[result_schemas.Gap]:
    """Склеивает соседние отсчёты без маршрута в перерывы."""
    gaps: list[result_schemas.Gap] = []
    start: int | None = None
    run: list[routing.OutageReason] = []

    for index in range(len(reasons) + 1):
        reason = reasons[index] if index < len(reasons) else None
        if reason is not None:
            if start is None:
                start = index
                run = [reason]
            else:
                run.append(reason)
        elif start is not None:
            start_s = start * step_s
            end_s = index * step_s
            gaps.append(result_schemas.Gap(
                start_s=start_s,
                end_s=end_s,
                duration_s=end_s - start_s,
                reason=run[0],
                at_boundary=start_s == 0 or end_s == horizon_s,
            ))
            start = None
            run = []

    return gaps


def _constants(environment: dict) -> result_schemas.Constants:
    orbit_radius_km = geometry.R + environment['altitude_km']
    mean_motion = math.sqrt(geometry.MU / orbit_radius_km**3)
    earth_rotation_period_s = 2 * math.pi / geometry.OMEGA

    return result_schemas.Constants(
        earth_radius_km=geometry.R,
        mu_km3_s2=geometry.MU,
        earth_rotation_period_s=earth_rotation_period_s,
        orbit_radius_km=orbit_radius_km,
        mean_motion_deg_s=_round(math.degrees(mean_motion), 7),
        orbital_period_s=_round(2 * math.pi / mean_motion, 2),
        earth_rotation_deg_s=_round(360 / earth_rotation_period_s, 7),
        satellite_speed_km_s=_round(
            math.sqrt(geometry.MU / orbit_radius_km), 3,
        ),
    )


def _nodes(scenario: dict) -> result_schemas.Nodes:
    design = scenario['design']
    launch_stage = design['launch_stage']

    return result_schemas.Nodes(
        planes=[dict(plane) for plane in design['planes']],
        satellites=[
            dict(satellite, ever_active=(
                satellite['launch_batch'] <= launch_stage
            ))
            for satellite in design['satellites']
        ],
        ground=[dict(site) for site in scenario['ground_sites']],
    )


def scenario_summary(scenario: dict) -> result_schemas.ScenarioSummary:
    """Сводка по входному сценарию: нужна и валидации, и списку сценариев."""
    environment = scenario['environment']
    design = scenario['design']
    roles = [site['role'] for site in scenario['ground_sites']]

    return result_schemas.ScenarioSummary(
        n_satellites=len(design['satellites']),
        n_active_satellites=sum(
            satellite['launch_batch'] <= design['launch_stage']
            for satellite in design['satellites']
        ),
        n_planes=len(design['planes']),
        n_clients=roles.count('client'),
        n_gateways=roles.count('gateway'),
        n_steps=environment['horizon_s'] // environment['step_s'],
        launch_stage=design['launch_stage'],
    )


def simulate(
    scenario: dict,
    routing_mode: str = routing.MIN_HOPS,
    include_edges: bool = True,
) -> result_schemas.SimulateResponse:
    started = time.perf_counter()

    environment = scenario['environment']
    step_s = environment['step_s']
    horizon_s = environment['horizon_s']
    n_steps = horizon_s // step_s

    ground_sites = scenario['ground_sites']
    ground_ids = frozenset(site['id'] for site in ground_sites)
    gateways = frozenset(
        site['id'] for site in ground_sites if site['role'] == 'gateway'
    )
    clients = [site['id'] for site in ground_sites if site['role'] == 'client']

    routes: dict[str, list[list[str]]] = {client: [] for client in clients}
    reasons: dict[str, list[routing.OutageReason | None]] = {
        client: [] for client in clients
    }
    visible_steps = dict.fromkeys(clients, 0)
    path_km: dict[str, list[float]] = {client: [] for client in clients}

    steps: list[result_schemas.StepState] = []
    isl_edges_total = 0
    ground_edges_total = 0

    for index in range(n_steps):
        t_s = index * step_s
        snapshot = geometry.snapshot(scenario, t_s)
        edges = snapshot['edges']
        graph = routing.Graph(edges)

        offline_gateways = frozenset(
            outage['gateway_id']
            for outage in scenario['gateway_outages']
            if outage['start_s'] <= t_s < outage['end_s']
        )

        for client in clients:
            if graph.degree(client):
                visible_steps[client] += 1

            path = routing.find_route(
                graph, client, gateways, ground_ids, routing_mode,
            )
            routes[client].append(path)
            if path:
                reasons[client].append(None)
                path_km[client].append(graph.path_km(path))
            else:
                reasons[client].append(routing.classify_outage(
                    graph, client, gateways, offline_gateways,
                ))

        for left, right, _ in edges:
            if left in ground_ids or right in ground_ids:
                ground_edges_total += 1
            else:
                isl_edges_total += 1

        if include_edges:
            steps.append(result_schemas.StepState(
                t_s=t_s,
                inactive=[
                    satellite['id']
                    for satellite in snapshot['satellites']
                    if not satellite['active']
                ],
                edges=[(left, right) for left, right, _ in edges],
            ))

    target_pct = environment['target_availability'] * 100
    metrics: dict[str, result_schemas.ClientMetrics] = {}

    for client in clients:
        available = sum(1 for path in routes[client] if path)
        gaps = _collect_gaps(reasons[client], step_s, horizon_s)
        hop_counts = [len(path) - 1 for path in routes[client] if path]
        histogram: dict[str, int] = {}
        for hops in hop_counts:
            histogram[str(hops)] = histogram.get(str(hops), 0) + 1

        availability_pct = _round(100 * available / n_steps)
        distances = path_km[client]

        metrics[client] = result_schemas.ClientMetrics(
            visibility_pct=_round(100 * visible_steps[client] / n_steps),
            availability_pct=availability_pct,
            target_met=availability_pct >= target_pct,
            max_gap_s=max([0, *(gap.duration_s for gap in gaps)]),
            total_outage_s=(n_steps - available) * step_s,
            gaps=gaps,
            hops=result_schemas.HopStats(
                min=min(hop_counts) if hop_counts else None,
                max=max(hop_counts) if hop_counts else None,
                avg=_round(_mean(hop_counts)) if hop_counts else 0,
                histogram=histogram,
            ),
            avg_path_km=_round(_mean(distances), 1) if distances else None,
        )

    worst_client = min(
        clients,
        key=lambda client: metrics[client].availability_pct,
        default=None,
    ) if clients else None

    return result_schemas.SimulateResponse(
        valid=True,
        meta=result_schemas.ResultMeta(
            scenario_id=scenario.get('meta', {}).get('id', ''),
            title=scenario.get('meta', {}).get('title'),
            n_steps=n_steps,
            step_s=step_s,
            horizon_s=horizon_s,
            target_availability=environment['target_availability'],
            routing=routing_mode,
            computed_ms=_round((time.perf_counter() - started) * 1000, 1),
        ),
        constants=_constants(environment),
        nodes=_nodes(scenario),
        steps=steps,
        routes=routes,
        reasons=reasons,
        metrics=metrics,
        summary=result_schemas.ResultSummary(
            all_targets_met=all(
                item.target_met for item in metrics.values()
            ),
            worst_client=worst_client,
            worst_availability_pct=(
                metrics[worst_client].availability_pct
                if worst_client else 0.0
            ),
            avg_isl_edges_per_step=_round(isl_edges_total / n_steps, 1),
            avg_ground_edges_per_step=_round(ground_edges_total / n_steps, 1),
        ),
    )
