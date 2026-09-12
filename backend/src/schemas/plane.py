import msgspec

import schemas.satelite


class Plane(msgspec.Struct):
    id: str
    raan_deg: float
    phase_deg: float


@msgspec.dataclass
class Planes:
    planes: list[Plane]


class Design:
    launch_stage: int
    planes: Planes
    satelites: schemas.satelite.Satelite
