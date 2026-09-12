"""Встроенные сценарии кейса и загрузка пользовательских файлов."""

from __future__ import annotations

import json
import os
import pathlib
import typing

import fastapi
import msgspec.json

import src.schemas.result
import src.schemas.scenario
import src.services.simulation
import src.services.validator

#: Папку можно переопределить переменной окружения — в контейнере данные
#: монтируются в /app/data, а при локальном запуске лежат в case/Данные.
DATA_DIR = pathlib.Path(
    os.environ.get('COSMO_DATA_DIR')
    or pathlib.Path(__file__).parent.parent.parent.parent / 'case' / 'Данные'
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024

router = fastapi.APIRouter(prefix='/scenarios', tags=['scenarios'])


def _json(payload: object) -> fastapi.Response:
    return fastapi.Response(
        content=msgspec.json.encode(payload),
        media_type='application/json',
    )


def _malformed(message: str) -> src.schemas.result.ValidationReport:
    return src.schemas.result.ValidationReport(
        valid=False,
        scenario=None,
        summary=None,
        errors=[src.schemas.result.FieldError(
            path='$',
            code='malformed_json',
            message=message,
        )],
        warnings=[],
    )


def _unwrap(payload: object) -> object:
    """Выгрузка результата снова загружается как сценарий."""
    if (
        isinstance(payload, dict)
        and payload.get('schema_version') == 'cosmo-A-result-1.0'
        and isinstance(payload.get('effective_scenario'), dict)
    ):
        return payload['effective_scenario']

    return payload


def _list_item(
    scenario: dict,
    fallback_id: str,
) -> src.schemas.scenario.ScenarioListItem:
    summary = src.services.simulation.scenario_summary(scenario)
    meta = scenario.get('meta') or {}

    return src.schemas.scenario.ScenarioListItem(
        id=meta.get('id', fallback_id),
        title=meta.get('title', fallback_id),
        n_satellites=summary.n_satellites,
        n_planes=summary.n_planes,
        n_clients=summary.n_clients,
        n_gateways=summary.n_gateways,
        launch_stage=summary.launch_stage,
        isl_range_km=scenario['environment']['isl_range_km'],
        n_failures=len(scenario.get('failures') or []),
    )


# Оба написания пути ведут в одну ручку: фронт зовёт /api/scenarios,
# а роутер с префиксом дал бы /api/scenarios/ и лишний редирект.
@router.get('', response_model=None)
@router.get('/', response_model=None)
def list_scenarios() -> fastapi.Response:
    if not DATA_DIR.is_dir():
        raise fastapi.HTTPException(
            status_code=fastapi.status.HTTP_404_NOT_FOUND,
            detail=f'Папка со сценариями не найдена: {DATA_DIR}',
        )

    items = []
    for path in sorted(DATA_DIR.glob('*.json')):
        try:
            scenario = json.loads(path.read_text(encoding='utf-8'))
            items.append(_list_item(scenario, path.stem))
        except (ValueError, KeyError, TypeError):
            # Битый файл в папке данных не должен ронять весь список
            continue

    return _json(items)


@router.get('/{scenario_id}', response_model=None)
def get_scenario(scenario_id: str) -> fastapi.Response:
    path = DATA_DIR / f'{scenario_id}.json'
    if not path.is_file() or path.parent != DATA_DIR:
        raise fastapi.HTTPException(
            status_code=fastapi.status.HTTP_404_NOT_FOUND,
            detail='Сценарий с таким id не найден',
        )

    return fastapi.Response(
        content=path.read_bytes(),
        media_type='application/json',
    )


@router.post('/upload', response_model=None)
async def upload_scenario(
    file: typing.Annotated[fastapi.UploadFile, fastapi.File()],
) -> fastapi.Response:
    """
    Разбор и валидация загруженного файла.

    Битый файл — не ошибка протокола: HTTP 200 и valid=false со списком
    проблем, чтобы пользователю было что показать.
    """
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise fastapi.HTTPException(
            status_code=fastapi.status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail='Файл больше 10 МБ',
        )

    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        return _json(_malformed('Файл не в кодировке UTF-8'))

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        return _json(_malformed(f'Файл не является корректным JSON: {error}'))

    report = src.services.validator.validate_scenario(_unwrap(payload))

    return _json(report)
