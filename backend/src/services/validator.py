import msgspec

import src.services.geometry
import src.schemas.scenario



class ValidationResponse(msgspec.Struct):
    is_valid: bool
    scenario: src.schemas.scenario.Scenario | None
    errors: list


def validate_scenario(
    scenario: src.schemas.scenario.Scenario,
) -> ValidationResponse:
    errors: list[src.services.geometry.ValidationError] = (
        src.services.geometry.validate(scenario)
        )
    return ValidationResponse(
        is_valid=not bool(errors),
        scenario=scenario,
        errors=errors,
    )