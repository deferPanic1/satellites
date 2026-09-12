"""
Схемы ответов расчёта. Соответствуют docs/openapi.yaml и
frontend/src/types/api.ts — при правке менять все три места.

Сценарий на входе и на выходе возится как dict: его формат задан кейсом,
неизвестные поля обязаны пережить обратную выгрузку, а geometry.py всё
равно работает со словарём.
"""

from __future__ import annotations

import typing

import msgspec

OutageReason = typing.Literal['no_sat', 'isl_break', 'no_gw', 'gw_down']
RoutingMode = typing.Literal['min_hops', 'min_distance']


# ---------- валидация ----------


class FieldError(msgspec.Struct):
    path: str
    code: str
    message: str
    value: typing.Any = None


class ScenarioSummary(msgspec.Struct):
    n_satellites: int
    n_active_satellites: int
    n_planes: int
    n_clients: int
    n_gateways: int
    n_steps: int
    launch_stage: int


class ValidationReport(msgspec.Struct):
    valid: bool
    scenario: dict | None
    summary: ScenarioSummary | None
    errors: list[FieldError]
    warnings: list[FieldError] = []


# ---------- расчёт ----------


class SimulateOptions(msgspec.Struct):
    routing: RoutingMode = 'min_hops'
    include_edges: bool = True
    include_routes: bool = True


class SimulateRequest(msgspec.Struct):
    scenario: dict
    options: SimulateOptions = msgspec.field(
        default_factory=SimulateOptions,
    )


class ResultMeta(msgspec.Struct):
    scenario_id: str
    n_steps: int
    step_s: int
    horizon_s: int
    target_availability: float
    title: str | None = None
    routing: RoutingMode = 'min_hops'
    computed_ms: float = 0.0


class Constants(msgspec.Struct):
    """Чтобы фронт анимировал спутники теми же числами, что считал сервер."""

    earth_radius_km: float
    mu_km3_s2: float
    earth_rotation_period_s: float
    orbit_radius_km: float
    mean_motion_deg_s: float
    orbital_period_s: float
    earth_rotation_deg_s: float
    satellite_speed_km_s: float


class Nodes(msgspec.Struct):
    """Статический состав сети: по шагам не меняется."""

    planes: list[dict]
    satellites: list[dict]
    ground: list[dict]


class StepState(msgspec.Struct):
    t_s: int
    inactive: list[str]
    edges: list[tuple[str, str]]


class Gap(msgspec.Struct):
    start_s: int
    end_s: int
    duration_s: int
    reason: OutageReason | None = None
    at_boundary: bool = False


class HopStats(msgspec.Struct):
    """Переход = ребро маршрута, включая обе наземные линии."""

    min: int | None
    max: int | None
    avg: float
    histogram: dict[str, int]


class ClientMetrics(msgspec.Struct):
    visibility_pct: float
    availability_pct: float
    target_met: bool
    max_gap_s: int
    total_outage_s: int
    gaps: list[Gap]
    hops: HopStats
    avg_path_km: float | None = None


class ResultSummary(msgspec.Struct):
    all_targets_met: bool
    worst_client: str | None
    worst_availability_pct: float
    avg_isl_edges_per_step: float
    avg_ground_edges_per_step: float


class SimulateResponse(msgspec.Struct):
    meta: ResultMeta
    constants: Constants
    nodes: Nodes
    steps: list[StepState]
    routes: dict[str, list[list[str]]]
    reasons: dict[str, list[OutageReason | None]]
    metrics: dict[str, ClientMetrics]
    summary: ResultSummary
    valid: bool = True
