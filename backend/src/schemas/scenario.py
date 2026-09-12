import typing

import msgspec

import src.schemas.environment
import src.schemas.plane
import src.schemas.satelite



class Scenario(msgspec.Struct):
    schema_version: str | None
    meta: dict | None
    environment: src.schemas.environment.Environment
    design: src.schemas.plane.Design
    failures: src.schemas.satelite.Satelites
    gateway_outages: list


class ScenarioListItem(msgspec.Struct):
    id: str
    title: str
    n_satellites: int | None = None
    n_planes: int | None = None
    n_clients: int | None = None
    n_gateways: int | None = None
    launch_stage: int | None = None
    isl_range_km: float | None = None
    n_failures: int | None = None


# class ScenarioSummary(msgspec.Struct):
#     n_active_satellites: int
#     n_satellites: int
#     n_planes: int
#     n_clients: int
#     n_gateways: int
#     n_steps: int
#     launch_stage: int


# class FieldError(msgspec.Struct):
#     path: str
#     code: typing.Literal[
#         'malformed_json',
#         'unsupported_schema_version',
#         'missing_field',
#         'wrong_type',
#         'non_finite_value',
#         'out_of_range',
#         'duplicate_id',
#         'unresolved_reference',
#         'invalid_time_grid',
#         'outage_outside_horizon',
#         'outage_nonpositive_duration',
#         'client_or_gateway_missing',
#         'node_id_collision',
#     ]
#     message: str
#     value: str | None


# class ValidationReport(msgspec.Struct):
#     valid: bool
#     scenario: Scenario | None
#     summary: list[ScenarioSummary] | None
#     errors: list[FieldError]
#     warnings: list[FieldError]
