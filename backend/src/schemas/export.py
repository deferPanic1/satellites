import typing

import msgspec

import src.schemas.scenario


class ExportRequest(msgspec.Struct):
    scenario: src.schemas.scenario.Scenario
    include_metrics: bool = True
    notes: str


class RouteRecord(msgspec.Struct):
    t_s: int
    client_id: str
    path: list[str]


type OutageReason = typing.Literal['no_sat', 'isl_break', 'no_gw', 'gw_down']


class Gap(msgspec.Struct):
    start_s: int
    end_s: int
    duration_s: int
    reason: OutageReason | None = None
    at_boundary: bool | None = None


class HopStats(msgspec.Struct):
    min: int
    max: int
    avg: float
    histogram: dict[str, int]


class ClientMetrics(msgspec.Struct):
    visibility_pct: float
    availability_pct: float
    target_met: bool
    max_gap_s: int
    total_outage_s: int | None = None
    gaps: list[Gap] | None = None
    hops: HopStats | None = None
    avg_path_km: float | None = None


class ExportResult(msgspec.Struct):
    schema_version: str
    effective_scenario: src.schemas.scenario.Scenario
    routes: list[RouteRecord]
    metrics: ClientMetrics
    notes: str
