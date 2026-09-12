import msgspec

import src.schemas.plane


class Satelite(msgspec.Struct):
    id: str
    plain_id: str
    slot_deg: float
    launch_batch: int


class Satelites:
    satelites: list[Satelite]