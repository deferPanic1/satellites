import msgspec

import backend.src.schemas.plane


class Satelite(msgspec.Struct):
    id: str
    plain_id: type[backend.src.schemas.plane.Plane.id]
    slot_deg: float
    launch_batch: int


class Satelites:
    satelites: list[Satelite]