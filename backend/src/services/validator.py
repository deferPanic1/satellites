"""
Валидация сценария. Проверки живут в geometry.py от организаторов —
здесь только приведение их результата к формату ответа из openapi.yaml.
"""

from __future__ import annotations

import src.schemas.result as result_schemas
from src.services import geometry, simulation


def validate_scenario(scenario: object) -> result_schemas.ValidationReport:
    """
    Некорректный сценарий — нормальный результат, а не ошибка протокола:
    отдаётся с HTTP 200 и valid=false. Возвращаются ВСЕ найденные ошибки.
    """
    errors = [
        result_schemas.FieldError(
            path=error['path'],
            code=error['code'],
            message=error['message'],
            value=error.get('value'),
        )
        for error in geometry.validate(scenario)
    ]

    if errors or not isinstance(scenario, dict):
        return result_schemas.ValidationReport(
            valid=False,
            scenario=None,
            summary=None,
            errors=errors,
            warnings=[],
        )

    return result_schemas.ValidationReport(
        valid=True,
        scenario=scenario,
        summary=simulation.scenario_summary(scenario),
        errors=[],
        warnings=[],
    )
