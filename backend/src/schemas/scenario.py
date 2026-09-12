import msgspec


class ScenarioListItem(msgspec.Struct):
    """Карточка сценария в списке набора кейса: метаданные без содержимого."""

    id: str
    title: str
    n_satellites: int | None = None
    n_planes: int | None = None
    n_clients: int | None = None
    n_gateways: int | None = None
    launch_stage: int | None = None
    isl_range_km: float | None = None
    n_failures: int | None = None
