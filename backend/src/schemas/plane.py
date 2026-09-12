import msgspec

import src.schemas.satelite


class Plane(msgspec.Struct):
    id: str
    raan_deg: float
    phase_deg: float


class Planes(msgspec.Struct):
    planes: list[Plane]


class Design:
    launch_stage: int
    planes: Planes
    satelites: src.schemas.satelite.Satelite
