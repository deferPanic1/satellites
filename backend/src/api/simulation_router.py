"""Полный расчёт на весь горизонт."""

import fastapi
import msgspec.json

import src.schemas.result
import src.services.routing
import src.services.simulation
import src.services.validator

router = fastapi.APIRouter(tags=['compute'])

ROUTING_MODES = (
    src.services.routing.MIN_HOPS,
    src.services.routing.MIN_DISTANCE,
)


async def _body(request: fastapi.Request) -> object:
    """Нечитаемое тело — ошибка протокола, а не результат валидации."""
    try:
        return await request.json()
    except ValueError as error:
        raise fastapi.HTTPException(
            status_code=fastapi.status.HTTP_400_BAD_REQUEST,
            detail=f'Тело запроса не является корректным JSON: {error}',
        ) from error


def _json(payload: object) -> fastapi.Response:
    return fastapi.Response(
        content=msgspec.json.encode(payload),
        media_type='application/json',
    )


@router.post('/simulate', response_model=None)
async def simulate(request: fastapi.Request) -> fastapi.Response:
    body = await _body(request)
    if not isinstance(body, dict):
        raise fastapi.HTTPException(
            status_code=fastapi.status.HTTP_400_BAD_REQUEST,
            detail='Тело запроса должно быть объектом {scenario, options}',
        )

    scenario = body.get('scenario', body)
    options = body.get('options') or {}
    routing_mode = options.get('routing', src.services.routing.MIN_HOPS)
    if routing_mode not in ROUTING_MODES:
        raise fastapi.HTTPException(
            status_code=fastapi.status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail='options.routing: выберите min_hops или min_distance',
        )

    # Сценарий с ошибками — не сбой протокола: HTTP 200 и valid=false.
    report = src.services.validator.validate_scenario(scenario)
    if not report.valid:
        return _json(report)

    return _json(src.services.simulation.simulate(
        scenario,
        routing_mode=routing_mode,
        include_edges=options.get('include_edges', True),
    ))
