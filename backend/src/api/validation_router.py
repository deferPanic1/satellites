"""Валидация сценария без расчёта."""

import fastapi
import msgspec.json

import src.schemas.result
import src.services.validator

router = fastapi.APIRouter(tags=['compute'])


async def _body(request: fastapi.Request) -> object:
    """Нечитаемое тело — ошибка протокола, а не результат валидации."""
    try:
        return await request.json()
    except ValueError as error:
        raise fastapi.HTTPException(
            status_code=fastapi.status.HTTP_400_BAD_REQUEST,
            detail=f'Тело запроса не является корректным JSON: {error}',
        ) from error


@router.post('/validate', response_model=None)
async def validate_scenario(request: fastapi.Request) -> fastapi.Response:
    body = await _body(request)
    # Спека и фронт присылают сценарий в конверте {"scenario": {...}}.
    # Голый сценарий принимаем тоже — так удобнее дёргать ручку руками.
    scenario = (
        body['scenario']
        if isinstance(body, dict) and 'scenario' in body
        else body
    )
    report = src.services.validator.validate_scenario(scenario)

    return fastapi.Response(
        content=msgspec.json.encode(report),
        media_type='application/json',
    )
