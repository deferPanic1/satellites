import msgspec


class Environment(msgspec.Struct):
    altitude_km: float
    inclination_deg: float
    earth_angle_deg: float
    horizon_s: int
    step_s: int
    min_elevation_deg: float
    isl_range_km: float
    target_availability: float
    