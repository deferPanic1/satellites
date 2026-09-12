import fastapi
import pathlib
import msgspec.json

import src.schemas.scenario
import src.services.validator


DATA_DIR = (
    pathlib.Path(__file__).parent.parent.parent.parent
    / 'doc'
    / 'Данные'
)

router = fastapi.APIRouter(prefix='/scenarios')


@router.get('/', response_model=None)
def get_all_base_scenarios() -> list[src.schemas.scenario.ScenarioListItem]:
    all_scenarios = [
        msgspec.json.decode(
            path_to_scenario.read_text(encoding='utf-8'),
            type=src.schemas.scenario.Scenario,
        )
        for path_to_scenario in DATA_DIR.iterdir()
    ]
    all_scenario_item = [
        src.schemas.scenario.ScenarioListItem(
            id=scenario.meta['id'],
            title=scenario.meta['title'],
        )
        for scenario in all_scenarios
    ]
    return fastapi.Response(
        content=msgspec.json.encode(all_scenario_item), 
        media_type='application/json',
    )


@router.get('/{id}', response_model=None)
def get_base_scenario(id: str) -> src.schemas.scenario.ScenarioListItem:
    path_to_base_scenario = DATA_DIR / f'{id}.json'
    if path_to_base_scenario.exists():
        scenario = msgspec.json.decode(
            path_to_base_scenario.read_text(encoding='utf-8'),
            type=src.schemas.scenario.Scenario,
        )
        return fastapi.Response(
            content=msgspec.json.encode(scenario),
            media_type='application/json',
        )

    return fastapi.HTTPException(
        status_code=404,
        detail='Сценарий с таким id не найден',
    )


@router.post('/upload', response_model=None)
async def validation_endpoint(
    request: fastapi.Request,
) -> src.services.validator.ValidationResponse:
    scenario: src.schemas.scenario = await request.json()
    result = src.services.validator.validate_scenario(scenario)

    return fastapi.Response(
        content=msgspec.json.encode(result),
        media_type='application/json',
    )
