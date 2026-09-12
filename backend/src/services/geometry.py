from __future__ import annotations

import msgspec
from math import isfinite
from typing import Any
import json, sys, math
from pathlib import Path

import numpy as np

R = 6371.0
MU = 398600.435507
OMEGA = 2 * math.pi / 86164.09054


def load(path: str | Path) -> dict:
    scenario = json.loads(Path(path).read_text(encoding="utf-8"))
    validate(scenario)
    return scenario


def finite(x):
    return (
        isinstance(x, (int, float)) and (not isinstance(x, bool)) and math.isfinite(x)
    )


SUPPORTED_SCHEMA_VERSION = "cosmo-A-1.0"

ENVIRONMENT_FIELDS = (
    "altitude_km",
    "inclination_deg",
    "earth_angle0_deg",
    "horizon_s",
    "step_s",
    "min_elevation_deg",
    "isl_range_km",
    "target_availability",
)

SCENARIO_REQUIRED_FIELDS = (
    "schema_version",
    "meta",
    "environment",
    "design",
    "ground_sites",
    "failures",
    "gateway_outages",
)


class ValidationError(msgspec.Struct):
    path: str
    code: str
    message: str
    value: Any = None

    def as_dict(self) -> dict[str, Any]:
        result = {
            "path": self.path,
            "code": self.code,
            "message": self.message,
        }

        if self.value is not None:
            result["value"] = self.value

        return result


def _add_error(
    errors: list[ValidationError],
    *,
    path: str,
    code: str,
    message: str,
    value: Any = None,
) -> None:
    errors.append(
        ValidationError(
            path=path,
            code=code,
            message=message,
            value=value,
        )
    )


def _is_number(value: Any) -> bool:
    """
    bool является подклассом int, поэтому isinstance(True, int) == True.
    Для числовых полей сценария это обычно нежелательно.
    """
    return type(value) in (int, float)


def _is_finite_number(value: Any) -> bool:
    return _is_number(value) and isfinite(value)


def _is_int(value: Any) -> bool:
    """
    Не считает bool целым числом.
    """
    return type(value) is int


def validate_structure(
    scenario: object,
    errors: list[ValidationError],
) -> None:
    """
    Проверяет минимальную структуру документа, чтобы последующие
    проверки могли безопасно обращаться к полям.
    """

    if not isinstance(scenario, dict):
        _add_error(
            errors,
            path="$",
            code="wrong_type",
            message="Сценарий должен быть JSON-объектом",
        )
        return

    for field in SCENARIO_REQUIRED_FIELDS:
        if field not in scenario:
            _add_error(
                errors,
                path=field,
                code="missing_field",
                message=f"Отсутствует обязательное поле '{field}'",
            )

    meta = scenario.get("meta")
    if "meta" in scenario and not isinstance(meta, dict):
        _add_error(
            errors,
            path="meta",
            code="wrong_type",
            message="Поле 'meta' должно быть объектом",
            value=meta,
        )

    if isinstance(meta, dict):
        for field in ("id", "title"):
            if field not in meta:
                _add_error(
                    errors,
                    path=f"meta.{field}",
                    code="missing_field",
                    message=f"Отсутствует обязательное поле 'meta.{field}'",
                )

    environment = scenario.get("environment")
    if "environment" in scenario and not isinstance(environment, dict):
        _add_error(
            errors,
            path="environment",
            code="wrong_type",
            message="Поле 'environment' должно быть объектом",
            value=environment,
        )

    design = scenario.get("design")
    if "design" in scenario and not isinstance(design, dict):
        _add_error(
            errors,
            path="design",
            code="wrong_type",
            message="Поле 'design' должно быть объектом",
            value=design,
        )

    if isinstance(design, dict):
        for field in ("launch_stage", "planes", "satellites"):
            if field not in design:
                _add_error(
                    errors,
                    path=f"design.{field}",
                    code="missing_field",
                    message=f"Отсутствует обязательное поле 'design.{field}'",
                )

        for field in ("planes", "satellites"):
            value = design.get(field)

            if field in design and not isinstance(value, list):
                _add_error(
                    errors,
                    path=f"design.{field}",
                    code="wrong_type",
                    message=f"Поле 'design.{field}' должно быть массивом",
                    value=value,
                )

    ground_sites = scenario.get("ground_sites")
    if "ground_sites" in scenario and not isinstance(ground_sites, list):
        _add_error(
            errors,
            path="ground_sites",
            code="wrong_type",
            message="Поле 'ground_sites' должно быть массивом",
            value=ground_sites,
        )

    for field in ("failures", "gateway_outages"):
        value = scenario.get(field)

        if field in scenario and not isinstance(value, list):
            _add_error(
                errors,
                path=field,
                code="wrong_type",
                message=f"Поле '{field}' должно быть массивом",
                value=value,
            )


def validate_schema_version(
    scenario: dict[str, Any],
    errors: list[ValidationError],
) -> None:
    version = scenario.get("schema_version")

    if not isinstance(version, str):
        _add_error(
            errors,
            path="schema_version",
            code="wrong_type",
            message="schema_version должен быть строкой",
            value=version,
        )
        return

    if version != SUPPORTED_SCHEMA_VERSION:
        _add_error(
            errors,
            path="schema_version",
            code="unsupported_schema_version",
            message=(
                f"Поддерживается только схема "
                f"{SUPPORTED_SCHEMA_VERSION}"
            ),
            value=version,
        )


def validate_environment(
    scenario: dict[str, Any],
    errors: list[ValidationError],
) -> None:
    environment = scenario.get("environment")

    if not isinstance(environment, dict):
        return

    # Сначала проверяем наличие и типы.
    for key in ENVIRONMENT_FIELDS:
        if key not in environment:
            _add_error(
                errors,
                path=f"environment.{key}",
                code="missing_field",
                message=f"Отсутствует поле 'environment.{key}'",
            )
            continue

        value = environment[key]

        if not _is_finite_number(value):
            _add_error(
                errors,
                path=f"environment.{key}",
                code="non_finite_value",
                message=(
                    f"Поле 'environment.{key}' должно "
                    f"содержать конечное число"
                ),
                value=value,
            )

    altitude = environment.get("altitude_km")
    inclination = environment.get("inclination_deg")

    if _is_finite_number(altitude):
        if not 200 <= altitude <= 1200:
            _add_error(
                errors,
                path="environment.altitude_km",
                code="out_of_range",
                message="altitude_km должен находиться в диапазоне [200, 1200]",
                value=altitude,
            )

    if _is_finite_number(inclination):
        if not 0 < inclination <= 180:
            _add_error(
                errors,
                path="environment.inclination_deg",
                code="out_of_range",
                message="inclination_deg должен находиться в диапазоне (0, 180]",
                value=inclination,
            )

    earth_angle = environment.get("earth_angle0_deg")
    if _is_finite_number(earth_angle):
        if not 0 <= earth_angle < 360:
            _add_error(
                errors,
                path="environment.earth_angle0_deg",
                code="out_of_range",
                message=(
                    "earth_angle0_deg должен находиться "
                    "в диапазоне [0, 360)"
                ),
                value=earth_angle,
            )

    horizon = environment.get("horizon_s")
    step = environment.get("step_s")

    if horizon is not None and not _is_int(horizon):
        _add_error(
            errors,
            path="environment.horizon_s",
            code="wrong_type",
            message="horizon_s должен быть целым числом",
            value=horizon,
        )

    if step is not None and not _is_int(step):
        _add_error(
            errors,
            path="environment.step_s",
            code="wrong_type",
            message="step_s должен быть целым числом",
            value=step,
        )

    # Проверяем сетку только если оба значения имеют нужный тип.
    if _is_int(horizon) and _is_int(step):
        if not 0 < step <= horizon <= 172800:
            _add_error(
                errors,
                path="environment.step_s",
                code="invalid_time_grid",
                message=(
                    "Должно выполняться "
                    "0 < step_s <= horizon_s <= 172800"
                ),
                value=step,
            )
        elif horizon % step != 0:
            _add_error(
                errors,
                path="environment.step_s",
                code="invalid_time_grid",
                message=(
                    f"horizon_s ({horizon}) должен делиться "
                    f"на step_s ({step}) без остатка"
                ),
                value=step,
            )

    min_elevation = environment.get("min_elevation_deg")
    if _is_finite_number(min_elevation):
        if not 0 <= min_elevation < 90:
            _add_error(
                errors,
                path="environment.min_elevation_deg",
                code="out_of_range",
                message=(
                    "min_elevation_deg должен находиться "
                    "в диапазоне [0, 90)"
                ),
                value=min_elevation,
            )

    isl_range = environment.get("isl_range_km")
    if _is_finite_number(isl_range):
        if not 0 < isl_range <= 10000:
            _add_error(
                errors,
                path="environment.isl_range_km",
                code="out_of_range",
                message=(
                    "isl_range_km должен находиться "
                    "в диапазоне (0, 10000]"
                ),
                value=isl_range,
            )

    availability = environment.get("target_availability")
    if _is_finite_number(availability):
        if not 0 <= availability <= 1:
            _add_error(
                errors,
                path="environment.target_availability",
                code="out_of_range",
                message=(
                    "target_availability должен находиться "
                    "в диапазоне [0, 1]"
                ),
                value=availability,
            )


def validate_design(
    scenario: dict[str, Any],
    errors: list[ValidationError],
) -> None:
    design = scenario.get("design")

    if not isinstance(design, dict):
        return

    launch_stage = design.get("launch_stage")

    if not _is_int(launch_stage):
        _add_error(
            errors,
            path="design.launch_stage",
            code="wrong_type",
            message="launch_stage должен быть целым числом",
            value=launch_stage,
        )
    elif launch_stage not in (1, 2, 3):
        _add_error(
            errors,
            path="design.launch_stage",
            code="out_of_range",
            message="launch_stage должен быть 1, 2 или 3",
            value=launch_stage,
        )

    planes = design.get("planes")
    satellites = design.get("satellites")

    if not isinstance(planes, list):
        return

    if not planes:
        _add_error(
            errors,
            path="design.planes",
            code="missing_field",
            message="Должна быть задана хотя бы одна плоскость",
        )

    plane_ids: set[str] = set()

    for i, plane in enumerate(planes):
        path = f"design.planes[{i}]"

        if not isinstance(plane, dict):
            _add_error(
                errors,
                path=path,
                code="wrong_type",
                message="Элемент planes должен быть объектом",
                value=plane,
            )
            continue

        for field in ("id", "raan_deg", "phase_deg"):
            if field not in plane:
                _add_error(
                    errors,
                    path=f"{path}.{field}",
                    code="missing_field",
                    message=f"Отсутствует обязательное поле '{field}'",
                )

        plane_id = plane.get("id")

        if "id" in plane:
            if not isinstance(plane_id, str):
                _add_error(
                    errors,
                    path=f"{path}.id",
                    code="wrong_type",
                    message="id плоскости должен быть строкой",
                    value=plane_id,
                )
            elif plane_id in plane_ids:
                _add_error(
                    errors,
                    path=f"{path}.id",
                    code="duplicate_id",
                    message=f"Повторяющийся ID плоскости '{plane_id}'",
                    value=plane_id,
                )
            else:
                plane_ids.add(plane_id)

        for field in ("raan_deg", "phase_deg"):
            value = plane.get(field)

            if field not in plane:
                continue

            if not _is_finite_number(value):
                _add_error(
                    errors,
                    path=f"{path}.{field}",
                    code="non_finite_value",
                    message="Угол должен быть конечным числом",
                    value=value,
                )
            elif not 0 <= value < 360:
                _add_error(
                    errors,
                    path=f"{path}.{field}",
                    code="out_of_range",
                    message="Угол должен находиться в диапазоне [0, 360)",
                    value=value,
                )

    if not isinstance(satellites, list):
        return

    if not satellites:
        _add_error(
            errors,
            path="design.satellites",
            code="missing_field",
            message="Должен быть задан хотя бы один спутник",
        )

    sat_ids: set[str] = set()

    for i, sat in enumerate(satellites):
        path = f"design.satellites[{i}]"

        if not isinstance(sat, dict):
            _add_error(
                errors,
                path=path,
                code="wrong_type",
                message="Элемент satellites должен быть объектом",
                value=sat,
            )
            continue

        for field in ("id", "plane_id", "slot_deg", "launch_batch"):
            if field not in sat:
                _add_error(
                    errors,
                    path=f"{path}.{field}",
                    code="missing_field",
                    message=f"Отсутствует обязательное поле '{field}'",
                )

        sat_id = sat.get("id")

        if "id" in sat:
            if not isinstance(sat_id, str):
                _add_error(
                    errors,
                    path=f"{path}.id",
                    code="wrong_type",
                    message="id спутника должен быть строкой",
                    value=sat_id,
                )
            elif sat_id in sat_ids:
                _add_error(
                    errors,
                    path=f"{path}.id",
                    code="duplicate_id",
                    message=f"Повторяющийся ID спутника '{sat_id}'",
                    value=sat_id,
                )
            else:
                sat_ids.add(sat_id)

        slot_deg = sat.get("slot_deg")

        if "slot_deg" in sat:
            if not _is_finite_number(slot_deg):
                _add_error(
                    errors,
                    path=f"{path}.slot_deg",
                    code="non_finite_value",
                    message="slot_deg должен быть конечным числом",
                    value=slot_deg,
                )

        launch_batch = sat.get("launch_batch")

        if "launch_batch" in sat:
            if not _is_int(launch_batch):
                _add_error(
                    errors,
                    path=f"{path}.launch_batch",
                    code="wrong_type",
                    message="launch_batch должен быть целым числом",
                    value=launch_batch,
                )
            elif launch_batch not in (1, 2, 3):
                _add_error(
                    errors,
                    path=f"{path}.launch_batch",
                    code="out_of_range",
                    message="launch_batch должен быть 1, 2 или 3",
                    value=launch_batch,
                )


def validate_ground_sites(
    scenario: dict[str, Any],
    errors: list[ValidationError],
) -> None:
    ground = scenario.get("ground_sites")

    if not isinstance(ground, list):
        return

    if len(ground) < 2:
        _add_error(
            errors,
            path="ground_sites",
            code="client_or_gateway_missing",
            message="Должно быть хотя бы два наземных пункта",
            value=len(ground),
        )

    ground_ids: set[str] = set()

    for i, site in enumerate(ground):
        path = f"ground_sites[{i}]"

        if not isinstance(site, dict):
            _add_error(
                errors,
                path=path,
                code="wrong_type",
                message="Элемент ground_sites должен быть объектом",
                value=site,
            )
            continue

        for field in ("id", "name", "role", "lat_deg", "lon_deg"):
            if field not in site:
                _add_error(
                    errors,
                    path=f"{path}.{field}",
                    code="missing_field",
                    message=f"Отсутствует обязательное поле '{field}'",
                )

        site_id = site.get("id")

        if "id" in site:
            if not isinstance(site_id, str):
                _add_error(
                    errors,
                    path=f"{path}.id",
                    code="wrong_type",
                    message="id наземного пункта должен быть строкой",
                    value=site_id,
                )
            elif site_id in ground_ids:
                _add_error(
                    errors,
                    path=f"{path}.id",
                    code="duplicate_id",
                    message=f"Повторяющийся ID наземного пункта '{site_id}'",
                    value=site_id,
                )
            else:
                ground_ids.add(site_id)

        role = site.get("role")

        if "role" in site:
            if role not in ("client", "gateway"):
                _add_error(
                    errors,
                    path=f"{path}.role",
                    code="out_of_range",
                    message="role должен быть 'client' или 'gateway'",
                    value=role,
                )

        lat = site.get("lat_deg")
        if "lat_deg" in site:
            if not _is_finite_number(lat):
                _add_error(
                    errors,
                    path=f"{path}.lat_deg",
                    code="non_finite_value",
                    message="lat_deg должен быть конечным числом",
                    value=lat,
                )
            elif not -90 <= lat <= 90:
                _add_error(
                    errors,
                    path=f"{path}.lat_deg",
                    code="out_of_range",
                    message="lat_deg должен находиться в диапазоне [-90, 90]",
                    value=lat,
                )

        lon = site.get("lon_deg")
        if "lon_deg" in site:
            if not _is_finite_number(lon):
                _add_error(
                    errors,
                    path=f"{path}.lon_deg",
                    code="non_finite_value",
                    message="lon_deg должен быть конечным числом",
                    value=lon,
                )
            elif not -180 <= lon <= 180:
                _add_error(
                    errors,
                    path=f"{path}.lon_deg",
                    code="out_of_range",
                    message=(
                        "lon_deg должен находиться "
                        "в диапазоне [-180, 180]"
                    ),
                    value=lon,
                )

    clients = [
        site
        for site in ground
        if isinstance(site, dict) and site.get("role") == "client"
    ]

    gateways = [
        site
        for site in ground
        if isinstance(site, dict) and site.get("role") == "gateway"
    ]

    if not clients:
        _add_error(
            errors,
            path="ground_sites",
            code="client_or_gateway_missing",
            message="Не задан ни один client",
        )

    if not gateways:
        _add_error(
            errors,
            path="ground_sites",
            code="client_or_gateway_missing",
            message="Не задан ни один gateway",
        )


def validate_outages(
    scenario: dict[str, Any],
    errors: list[ValidationError],
) -> None:
    environment = scenario.get("environment")
    horizon = (
        environment.get("horizon_s")
        if isinstance(environment, dict)
        else None
    )

    if not _is_int(horizon):
        # Невозможно проверить границы интервала без horizon_s.
        return

    failures = scenario.get("failures")
    gateway_outages = scenario.get("gateway_outages")

    validate_outage_list(
        outages=failures,
        field="failures",
        id_field="satellite_id",
        horizon=horizon,
        errors=errors,
    )

    validate_outage_list(
        outages=gateway_outages,
        field="gateway_outages",
        id_field="gateway_id",
        horizon=horizon,
        errors=errors,
    )


def validate_outage_list(
    *,
    outages: Any,
    field: str,
    id_field: str,
    horizon: int,
    errors: list[ValidationError],
) -> None:
    if not isinstance(outages, list):
        return

    for i, outage in enumerate(outages):
        path = f"{field}[{i}]"

        if not isinstance(outage, dict):
            _add_error(
                errors,
                path=path,
                code="wrong_type",
                message="Элемент outage должен быть объектом",
                value=outage,
            )
            continue

        for required_field in (id_field, "start_s", "end_s"):
            if required_field not in outage:
                _add_error(
                    errors,
                    path=f"{path}.{required_field}",
                    code="missing_field",
                    message=(
                        f"Отсутствует обязательное поле "
                        f"'{required_field}'"
                    ),
                )

        if id_field not in outage:
            continue

        start = outage.get("start_s")
        end = outage.get("end_s")

        if not _is_finite_number(start):
            _add_error(
                errors,
                path=f"{path}.start_s",
                code="non_finite_value",
                message="start_s должен быть конечным числом",
                value=start,
            )

        if not _is_finite_number(end):
            _add_error(
                errors,
                path=f"{path}.end_s",
                code="non_finite_value",
                message="end_s должен быть конечным числом",
                value=end,
            )

        if _is_finite_number(start) and _is_finite_number(end):
            if not 0 <= start < end <= horizon:
                code = (
                    "outage_nonpositive_duration"
                    if start >= end
                    else "outage_outside_horizon"
                )

                message = (
                    "Должно выполняться 0 <= start_s < end_s <= horizon_s"
                )

                _add_error(
                    errors,
                    path=path,
                    code=code,
                    message=message,
                    value={
                        "start_s": start,
                        "end_s": end,
                    },
                )


def validate_references(
    scenario: dict[str, Any],
    errors: list[ValidationError],
) -> None:
    """
    Проверяет связи между сущностями:

    satellite.plane_id -> planes.id
    failures.satellite_id -> satellites.id
    gateway_outages.gateway_id -> gateway ids
    ground-site IDs <-> satellite IDs
    """

    design = scenario.get("design")
    ground = scenario.get("ground_sites")
    failures = scenario.get("failures")
    gateway_outages = scenario.get("gateway_outages")

    if not isinstance(design, dict):
        return

    planes = design.get("planes")
    satellites = design.get("satellites")

    if not isinstance(planes, list) or not isinstance(satellites, list):
        return

    plane_ids = {
        plane["id"]
        for plane in planes
        if isinstance(plane, dict)
        and isinstance(plane.get("id"), str)
    }

    satellite_ids = {
        sat["id"]
        for sat in satellites
        if isinstance(sat, dict)
        and isinstance(sat.get("id"), str)
    }

    gateway_ids: set[str] = set()
    ground_ids: set[str] = set()

    if isinstance(ground, list):
        for site in ground:
            if not isinstance(site, dict):
                continue

            site_id = site.get("id")
            if not isinstance(site_id, str):
                continue

            ground_ids.add(site_id)

            if site.get("role") == "gateway":
                gateway_ids.add(site_id)

    # satellite -> plane
    for i, sat in enumerate(satellites):
        if not isinstance(sat, dict):
            continue

        plane_id = sat.get("plane_id")

        if plane_id is None:
            continue

        if plane_id not in plane_ids:
            _add_error(
                errors,
                path=f"design.satellites[{i}].plane_id",
                code="unresolved_reference",
                message=(
                    f"Плоскость '{plane_id}' не найдена. "
                    f"Доступны: {', '.join(sorted(plane_ids))}"
                ),
                value=plane_id,
            )

    # satellite IDs vs ground IDs
    collisions = satellite_ids & ground_ids

    for node_id in sorted(collisions):
        _add_error(
            errors,
            path="design.satellites",
            code="node_id_collision",
            message=(
                f"ID '{node_id}' одновременно используется "
                f"для спутника и наземного пункта"
            ),
            value=node_id,
        )

    # failure.satellite_id -> satellite.id
    if isinstance(failures, list):
        for i, failure in enumerate(failures):
            if not isinstance(failure, dict):
                continue

            satellite_id = failure.get("satellite_id")

            if (
                satellite_id is not None
                and satellite_id not in satellite_ids
            ):
                _add_error(
                    errors,
                    path=f"failures[{i}].satellite_id",
                    code="unresolved_reference",
                    message=(
                        f"Спутник '{satellite_id}' не найден. "
                        f"Доступны спутники: "
                        f"{', '.join(sorted(satellite_ids))}"
                    ),
                    value=satellite_id,
                )

    # gateway_outage.gateway_id -> gateway.id
    if isinstance(gateway_outages, list):
        for i, outage in enumerate(gateway_outages):
            if not isinstance(outage, dict):
                continue

            gateway_id = outage.get("gateway_id")

            if gateway_id is not None and gateway_id not in gateway_ids:
                _add_error(
                    errors,
                    path=f"gateway_outages[{i}].gateway_id",
                    code="unresolved_reference",
                    message=(
                        f"Шлюз '{gateway_id}' не найден среди gateway. "
                        f"Доступны: {', '.join(sorted(gateway_ids))}"
                    ),
                    value=gateway_id,
                )


def validate(
    scenario: object,
) -> list[dict[str, Any]]:
    """
    Возвращает ВСЕ найденные ошибки валидации.

    Пустой список означает, что сценарий прошёл валидацию.
    """

    errors: list[ValidationError] = []

    validate_structure(scenario, errors)

    if not isinstance(scenario, dict):
        return [error.as_dict() for error in errors]

    validate_schema_version(scenario, errors)
    validate_environment(scenario, errors)
    validate_design(scenario, errors)
    validate_ground_sites(scenario, errors)
    validate_outages(scenario, errors)
    validate_references(scenario, errors)

    return [error.as_dict() for error in errors]


def positions(s: dict, t_s: float) -> tuple[list[str], np.ndarray, np.ndarray]:
    """Return satellite IDs, model inertial positions [km], Earth-fixed positions [km]."""
    e, d = (s["environment"], s["design"])
    pmap = {p["id"]: p for p in d["planes"]}
    r = R + e["altitude_km"]
    n = math.sqrt(MU / r**3)
    inc = math.radians(e["inclination_deg"])
    u = np.array(
        [
            math.radians(x["slot_deg"] + pmap[x["plane_id"]]["phase_deg"]) + n * t_s
            for x in d["satellites"]
        ]
    )
    om = np.array(
        [math.radians(pmap[x["plane_id"]]["raan_deg"]) for x in d["satellites"]]
    )
    cu, su, co, so = (np.cos(u), np.sin(u), np.cos(om), np.sin(om))
    xyz = r * np.stack(
        (
            co * cu - so * su * math.cos(inc),
            so * cu + co * su * math.cos(inc),
            su * math.sin(inc),
        ),
        axis=1,
    )
    th = math.radians(e["earth_angle0_deg"]) + OMEGA * t_s
    c, ss = (math.cos(th), math.sin(th))
    fixed = xyz @ np.array([[c, -ss, 0], [ss, c, 0], [0, 0, 1]])
    return ([x["id"] for x in d["satellites"]], xyz, fixed)


def ground_position(g: dict) -> np.ndarray:
    lat, lon = (math.radians(g["lat_deg"]), math.radians(g["lon_deg"]))
    return R * np.array(
        [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)]
    )


def snapshot(s: dict, t_s: float) -> dict:
    """Edges are potential bidirectional contacts; ground nodes cannot relay traffic."""
    e, d = (s["environment"], s["design"])
    ids, inertial, xyz = positions(s, t_s)
    failed = {
        f["satellite_id"] for f in s["failures"] if f["start_s"] <= t_s < f["end_s"]
    }
    active = np.array(
        [
            sat["launch_batch"] <= d["launch_stage"] and sat["id"] not in failed
            for sat in d["satellites"]
        ]
    )
    i, j = np.triu_indices(len(ids), 1)
    delta = xyz[j] - xyz[i]
    dist = np.linalg.norm(delta, axis=1)
    denom = np.sum(delta * delta, axis=1)
    lam = np.clip(-np.sum(xyz[i] * delta, axis=1) / np.maximum(denom, 1e-12), 0, 1)
    closest = np.linalg.norm(xyz[i] + lam[:, None] * delta, axis=1)
    ok = (dist < e["isl_range_km"]) & (closest > R) & active[i] & active[j]
    edges = [[ids[a], ids[b], float(dd)] for a, b, dd in zip(i[ok], j[ok], dist[ok])]
    elevations = {}
    for g in s["ground_sites"]:
        gp = ground_position(g)
        dif = xyz - gp
        dl = np.linalg.norm(dif, axis=1)
        el = np.degrees(np.arcsin(np.clip(dif @ (gp / R) / dl, -1, 1)))
        elevations[g["id"]] = {
            sid: float(el[k]) for k, sid in enumerate(ids) if active[k]
        }
        offline = any(
            (
                f["gateway_id"] == g["id"] and f["start_s"] <= t_s < f["end_s"]
                for f in s["gateway_outages"]
            )
        )
        vis = (el >= e["min_elevation_deg"]) & active & (not offline)
        edges.extend([[g["id"], ids[k], float(dl[k])] for k in np.where(vis)[0]])
    return {
        "t_s": t_s,
        "satellites": [
            {
                "id": sid,
                "x_km": float(xyz[k, 0]),
                "y_km": float(xyz[k, 1]),
                "z_km": float(xyz[k, 2]),
                "active": bool(active[k]),
            }
            for k, sid in enumerate(ids)
        ],
        "edges": edges,
        "elevation_deg": elevations,
    }


def sunlight(s: dict, t_s: float, sun_eci: list[float]) -> dict[str, bool]:
    """Fixed Sun direction and cylindrical Earth shadow, intended for <=24-hour fixtures."""
    ids, xyz, _ = positions(s, t_s)
    sun = np.array(sun_eci, dtype=float)
    sun /= np.linalg.norm(sun)
    projection = xyz @ sun
    perp = np.linalg.norm(xyz - projection[:, None] * sun, axis=1)
    eclipse = (projection < 0) & (perp < R)
    return {sid: not bool(eclipse[k]) for k, sid in enumerate(ids)}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python geometry.py scenario.json [t_s]")
    s = load(sys.argv[1])
    t = float(sys.argv[2]) if len(sys.argv) > 2 else 0
    print(json.dumps(snapshot(s, t), ensure_ascii=False, indent=2, allow_nan=False))
