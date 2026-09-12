import msgspec

# import src.schemas.plane


class Satelite(msgspec.Struct):
    id: str
    plane_id: str
    slot_deg: float
    launch_batch: int


class FailedSatelite(msgspec.Struct):
    satellite_id: str
    start_s: int
    end_s: int
