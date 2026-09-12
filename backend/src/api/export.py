import fastapi
import msgspec.json

import src.schemas.scenario
import src.services.validator
import src.schemas.export
import src.services.processing_graph
import src.services.geometry


router = fastapi.FastAPI(pref='export')


@router.post('/')
async def export(
    request: fastapi.Request,
) -> src.schemas.export.ExportResult:
    raw_json = await request.json()
    export_request = msgspec.json.decode(
        raw_json,
        type=src.schemas.export.ExportRequest,
    )
    routes: list[src.schemas.export.RouteRecord] = []
    for t_s in range(0, 24 * 60 * 60, 120):
        snapshot = src.services.geometry.snapshot(raw_json, t_s)
        client = src.services.processing_graph.get_min_hopes_stat(
            snapshot['edges'],
        )
        routes.extend([
            src.schemas.export.RouteRecord(
                t_s=t_s,
                client_id=now_client.id_client,
                path=now_client.optimal_path,
            )
            for now_client in client
        ])

    src.schemas.export.ClientMetrics(
        visibility_pct=...,
        availability_pct=...,
        target_met=...,
        max_gap_s=...,
    )
    export_result = src.schemas.export.ExportResult(
        schema_version=export_request.scenario.schema_version,
        effective_scenario=export_request.scenario,
        routes=routes,
        metrics=...,
        notes='Маршрутизация: BFS по минимуму кол-ва рёбер',
    )
    return fastapi.Response(
        content=msgspec.json.encode(export_result),
        media_type='application/json',
    )
