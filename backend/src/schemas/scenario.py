import msgspec

import schemas.environment
import schemas.plane
import schemas.satelite


@msgspec.dataclass
class Scenario(msgspec.Struct):
    schema_version: str | None
    meta: dict | None
    environment: schemas.environment.Environment
    design: schemas.plane.Design
    failures: schemas.satelite.Satelites
    gateway_outages: list