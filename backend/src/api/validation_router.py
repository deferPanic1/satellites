import fastapi
import msgspec

import src.schemas.scenario
import src.services.validator

router = fastapi.APIRouter()

@router.post('/validate')
async def validation_endpoint(request: fastapi.Request) -> fastapi.Response:
    scenario: src.schemas.scenario = await request.json()
    result = src.services.validator.validate_scenario(scenario)
    
    return fastapi.Response(
        content=msgspec.json.encode(result), 
        media_type="application/json", )