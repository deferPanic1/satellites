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

router = fastapi.APIRouter(prefix='scenarios')


@router.get('/')
def get_all_base_scenarios() -> list[src.schemas.scenario.ScenarioListItem]:
    all_scenarios = [
        msgspec.json.decode(
            path_to_scenario.read_text(encoding='utf-8'),
            type=src.schemas.scenario.Scenario,
        )
        for path_to_scenario in DATA_DIR.iterdir()
    ]
    return [
        src.schemas.scenario.ScenarioListItem(
            id=scenario.meta['id'],
            title=scenario.meta['title'],
        )
        for scenario in all_scenarios
    ]


@router.get('/{id}')
def get_base_scenario(id: str) -> src.schemas.scenario.ScenarioListItem:
    path_to_base_scenario = DATA_DIR / f'{id}.json'
    if path_to_base_scenario.exists():
        return msgspec.json.decode(
            path_to_base_scenario.read_text(encoding='utf-8'),
            type=src.schemas.scenario.Scenario,
        )

    return fastapi.HTTPException(
        status_code=404,
        detail='Сценарий с таким id не найден',
    )


@router.post('/upload')
def upload_scenario(
    scenario: src.schemas.scenario.Scenario,
) -> src.schemas.scenario.ValidationReport:
    return src.services.validator.validate_scenario(scenario)
