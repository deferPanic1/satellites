import msgspec

import src.schemas.satelite


class Plane(msgspec.Struct):
    id: str
    raan_deg: float
    phase_deg: float


class Design(msgspec.Struct):
    launch_stage: int
    planes: list[Plane]
    satellites: list[src.schemas.satelite.Satelite]
