import msgspec

import services.geometry
import src.schemas.scenario



class ValidationResponse(msgspec.Struct):
    is_valid: bool
    scenario: src.schemas.scenario.Scenario | None
    errors: list


def validate_scenario(
    scenario: src.schemas.scenario.Scenario,
) -> list:
    errors: list[services.geometry.ValidationError] = (
        services.geometry.validate(scenario)
        )
    return ValidationResponse(
        is_valid=not bool(errors),
        scenario=scenario,
        errors=errors,
    )