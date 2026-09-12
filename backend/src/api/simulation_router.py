import fastapi
import msgspec

import src.schemas.scenario
import src.services.validator
import src.services.geometry
import src.services.processing_graph

router = fastapi.APIRouter()

@router.post('/simulate')
async def simulate(request: fastapi.Request):
    scenario: src.schemas.scenario.Scenario = await request.json()
    result = src.services.validator.validate_scenario(scenario)
    if not result.is_valid:
        return fastapi.Response(
            content=msgspec.json.encode(result), 
            media_type="application/json", )
    
    edges = src.services.geometry.snapshot(scenario)
    adj_list = src.services.processing_graph.edges2adj_list(edges)
    
    result = src.services.validator.validate_scenario(scenario)
    
    match scenario.optimization_criteria:
        case src.schemas.scenario.OptimizationCriteriaEnum.MIN_HOPS:
            result = src.services.processing_graph.get_min_hopes_stat(adj_list)
        case src.schemas.scenario.OptimizationCriteriaEnum.MIN_DISTANCE:
            result = src.services.processing_graph.get_min_distance_stat(adj_list)
        
        case _:
            raise fastapi.HTTPException(
                status_code=fastapi.status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Выберите один из вариантов: (min_hops, min_distance)"
            )
    
    return fastapi.Response(
            content=msgspec.json.encode(result), 
            media_type="application/json", )