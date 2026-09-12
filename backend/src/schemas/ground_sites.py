import msgspec


class GroundSite(msgspec.Struct):
    id: str
    name: str
    role: str
    lat_deg: float
    lon_deg: float


class GroundSites:
    ground_sites: list[GroundSite]