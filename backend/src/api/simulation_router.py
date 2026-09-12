import fastapi
import msgspec

import src.schemas.scenario
import src.services.validator
import src.services.geometry
import src.services.processing_graph


def enc_hook(obj):
    if isinstance(obj, src.services.processing_graph.Vertex):
        return str.__str__(obj)

    raise TypeError(f"Unsupported type: {type(obj)!r}")

router = fastapi.APIRouter()

@router.post('/simulate')
async def simulate(request: fastapi.Request) -> fastapi.Response:
    output: list[src.schemas.scenario.Timestamp] = []
    scenario: src.schemas.scenario.Scenario = await request.json()
    result = src.services.validator.validate_scenario(scenario)
    if not result.is_valid:
        return fastapi.Response(
            content=msgspec.json.encode(result), 
            media_type="application/json", )
    
    result = src.services.validator.validate_scenario(scenario)
    
    match scenario['optimization_criteria']:
        case src.schemas.scenario.OptimizationCriteriaEnum.MIN_HOPS:
            criteria = src.schemas.scenario.OptimizationCriteriaEnum.MIN_HOPS
        case src.schemas.scenario.OptimizationCriteriaEnum.MIN_DISTANCE:
            criteria = src.schemas.scenario.OptimizationCriteriaEnum.MIN_DISTANCE
        
        case _:
            raise fastapi.HTTPException(
                status_code=fastapi.status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Выберите один из вариантов: (min_hops, min_distance)"
            )
    
    if criteria == src.schemas.scenario.OptimizationCriteriaEnum.MIN_HOPS:
        for t_s in range(0, 3600, 120):
            edges = src.services.geometry.snapshot(scenario, t_s)
            processed = src.services.processing_graph.get_min_hopes_stat(edges['edges'])
            timestamp = src.schemas.scenario.Timestamp(
                t_s=t_s,
                snapshot=processed
            )
            
            output.append(timestamp)
    
    else:
        for t_s in range(0, 3600, 120):
            edges = src.services.geometry.snapshot(scenario, t_s)
            adj_list = src.services.processing_graph.edges2adj_list(edges)
            processed = src.services.processing_graph.get_min_distance_stat(adj_list)
            timestamp = src.schemas.scenario.Timestamp(
                t_s=t_s,
                snapshot=processed
            )
            
            output.append(timestamp)
    
    return fastapi.Response(
        content=msgspec.json.encode(output, enc_hook=enc_hook), 
        media_type="application/json", )