from __future__ import annotations
import json, math, sys
from pathlib import Path
import numpy as np
R = 6371.0
MU = 398600.435507
OMEGA = 2 * math.pi / 86164.09054

def load(path: str | Path) -> dict:
    scenario = json.loads(Path(path).read_text(encoding='utf-8'))
    validate(scenario)
    return scenario

def finite(x):
    return isinstance(x, (int, float)) and (not isinstance(x, bool)) and math.isfinite(x)

def validate(s: dict) -> None:
    if s.get('schema_version') != 'cosmo-A-1.0':
        raise ValueError('Unsupported scenario schema')
    e, d = (s['environment'], s['design'])
    for key in ('altitude_km', 'inclination_deg', 'earth_angle0_deg', 'horizon_s', 'step_s', 'min_elevation_deg', 'isl_range_km', 'target_availability'):
        if not finite(e[key]):
            raise ValueError('Non-finite environment value: ' + key)
    if not (200 <= e['altitude_km'] <= 1200 and 0 < e['inclination_deg'] <= 180):
        raise ValueError('Invalid orbit')
    if not isinstance(e['step_s'], int) or not isinstance(e['horizon_s'], int):
        raise ValueError('Time grid must use integer seconds')
    if not (0 < e['step_s'] <= e['horizon_s'] <= 172800 and e['horizon_s'] % e['step_s'] == 0):
        raise ValueError('Invalid time grid')
    if not (0 <= e['min_elevation_deg'] < 90 and 0 < e['isl_range_km'] <= 10000 and (0 <= e['target_availability'] <= 1)):
        raise ValueError('Invalid link/target values')
    planes = {p['id']: p for p in d['planes']}
    if len(planes) != len(d['planes']) or not planes:
        raise ValueError('Duplicate/empty planes')
    for p in planes.values():
        if not all((finite(p[k]) and 0 <= p[k] < 360 for k in ('raan_deg', 'phase_deg'))):
            raise ValueError('Invalid plane angle')
    ids = [sat['id'] for sat in d['satellites']]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('Duplicate/empty satellite IDs')
    if not isinstance(d['launch_stage'], int) or d['launch_stage'] not in (1, 2, 3):
        raise ValueError('launch_stage must be 1, 2 or 3')
    for sat in d['satellites']:
        if sat['plane_id'] not in planes or sat['launch_batch'] not in (1, 2, 3) or (not finite(sat['slot_deg'])):
            raise ValueError('Invalid satellite')
    ground = s['ground_sites']
    gids = [g['id'] for g in ground]
    if len(gids) != len(set(gids)) or set(gids) & set(ids):
        raise ValueError('Non-unique node IDs')
    if not any((g['role'] == 'client' for g in ground)) or not any((g['role'] == 'gateway' for g in ground)):
        raise ValueError('Client and gateway required')
    for g in ground:
        if g['role'] not in ('client', 'gateway') or not finite(g['lat_deg']) or (not finite(g['lon_deg'])) or (not (-90 <= g['lat_deg'] <= 90 and -180 <= g['lon_deg'] <= 180)):
            raise ValueError('Invalid ground site')
    for field, key, valid in [('failures', 'satellite_id', set(ids)), ('gateway_outages', 'gateway_id', {g['id'] for g in ground if g['role'] == 'gateway'})]:
        for f in s[field]:
            if f[key] not in valid or not all((finite(f[k]) for k in ('start_s', 'end_s'))) or (not 0 <= f['start_s'] < f['end_s'] <= e['horizon_s']):
                raise ValueError('Invalid outage')

def positions(s: dict, t_s: float) -> tuple[list[str], np.ndarray, np.ndarray]:
    """Return satellite IDs, model inertial positions [km], Earth-fixed positions [km]."""
    e, d = (s['environment'], s['design'])
    pmap = {p['id']: p for p in d['planes']}
    r = R + e['altitude_km']
    n = math.sqrt(MU / r ** 3)
    inc = math.radians(e['inclination_deg'])
    u = np.array([math.radians(x['slot_deg'] + pmap[x['plane_id']]['phase_deg']) + n * t_s for x in d['satellites']])
    om = np.array([math.radians(pmap[x['plane_id']]['raan_deg']) for x in d['satellites']])
    cu, su, co, so = (np.cos(u), np.sin(u), np.cos(om), np.sin(om))
    xyz = r * np.stack((co * cu - so * su * math.cos(inc), so * cu + co * su * math.cos(inc), su * math.sin(inc)), axis=1)
    th = math.radians(e['earth_angle0_deg']) + OMEGA * t_s
    c, ss = (math.cos(th), math.sin(th))
    fixed = xyz @ np.array([[c, -ss, 0], [ss, c, 0], [0, 0, 1]])
    return ([x['id'] for x in d['satellites']], xyz, fixed)

def ground_position(g: dict) -> np.ndarray:
    lat, lon = (math.radians(g['lat_deg']), math.radians(g['lon_deg']))
    return R * np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])

def snapshot(s: dict, t_s: float) -> dict:
    """Edges are potential bidirectional contacts; ground nodes cannot relay traffic."""
    e, d = (s['environment'], s['design'])
    ids, inertial, xyz = positions(s, t_s)
    failed = {f['satellite_id'] for f in s['failures'] if f['start_s'] <= t_s < f['end_s']}
    active = np.array([sat['launch_batch'] <= d['launch_stage'] and sat['id'] not in failed for sat in d['satellites']])
    i, j = np.triu_indices(len(ids), 1)
    delta = xyz[j] - xyz[i]
    dist = np.linalg.norm(delta, axis=1)
    denom = np.sum(delta * delta, axis=1)
    lam = np.clip(-np.sum(xyz[i] * delta, axis=1) / np.maximum(denom, 1e-12), 0, 1)
    closest = np.linalg.norm(xyz[i] + lam[:, None] * delta, axis=1)
    ok = (dist < e['isl_range_km']) & (closest > R) & active[i] & active[j]
    edges = [[ids[a], ids[b], float(dd)] for a, b, dd in zip(i[ok], j[ok], dist[ok])]
    elevations = {}
    for g in s['ground_sites']:
        gp = ground_position(g)
        dif = xyz - gp
        dl = np.linalg.norm(dif, axis=1)
        el = np.degrees(np.arcsin(np.clip(dif @ (gp / R) / dl, -1, 1)))
        elevations[g['id']] = {sid: float(el[k]) for k, sid in enumerate(ids) if active[k]}
        offline = any((f['gateway_id'] == g['id'] and f['start_s'] <= t_s < f['end_s'] for f in s['gateway_outages']))
        vis = (el >= e['min_elevation_deg']) & active & (not offline)
        edges.extend([[g['id'], ids[k], float(dl[k])] for k in np.where(vis)[0]])
    return {'t_s': t_s, 'satellites': [{'id': sid, 'x_km': float(xyz[k, 0]), 'y_km': float(xyz[k, 1]), 'z_km': float(xyz[k, 2]), 'active': bool(active[k])} for k, sid in enumerate(ids)], 'edges': edges, 'elevation_deg': elevations}

def sunlight(s: dict, t_s: float, sun_eci: list[float]) -> dict[str, bool]:
    """Fixed Sun direction and cylindrical Earth shadow, intended for <=24-hour fixtures."""
    ids, xyz, _ = positions(s, t_s)
    sun = np.array(sun_eci, dtype=float)
    sun /= np.linalg.norm(sun)
    projection = xyz @ sun
    perp = np.linalg.norm(xyz - projection[:, None] * sun, axis=1)
    eclipse = (projection < 0) & (perp < R)
    return {sid: not bool(eclipse[k]) for k, sid in enumerate(ids)}
if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python geometry.py scenario.json [t_s]')
    s = load(sys.argv[1])
    t = float(sys.argv[2]) if len(sys.argv) > 2 else 0
    print(json.dumps(snapshot(s, t), ensure_ascii=False, indent=2, allow_nan=False))
