import msgspec

import src.schemas.environment
import src.schemas.plane
import src.schemas.satelite



class Scenario(msgspec.Struct):
    schema_version: str | None
    meta: dict | None
    environment: src.schemas.environment.Environment
    design: src.schemas.plane.Design
    failures: src.schemas.satelite.Satelites
    gateway_outages: list