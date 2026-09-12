/**
 * Локальный расчёт для фронтового mock-режима.
 *
 * Это TypeScript-порт эталонной геометрии из backend/geometry.py. Он нужен,
 * чтобы интерфейс можно было полноценно разрабатывать до готовности API:
 * пользовательские правки действительно пересчитываются, а не подменяются
 * предрассчитанной фикстурой исходного сценария.
 */

import type {
  ClientMetrics,
  Edge,
  Gap,
  OutageReason,
  RoutingMode,
  Scenario,
  SimulateResponse,
} from '../types/api'
import {
  EARTH_ROT_PERIOD_S,
  MU_KM3_S2,
  R_EARTH_KM,
  buildModel,
  elevationDeg,
  groundPosition,
  positionsAt,
} from './orbital'

interface WeightedEdge {
  left: string
  right: string
  distanceKm: number
}

interface Neighbour {
  id: string
  distanceKm: number
}

type Graph = Map<string, Neighbour[]>

interface Vec3 {
  x: number
  y: number
  z: number
}

export function simulateLocally(
  scenario: Scenario,
  routing: RoutingMode = 'min_hops',
): SimulateResponse {
  const started = performance.now()
  const { environment, design } = scenario
  const model = buildModel(scenario)
  const buffer = new Float64Array(model.sats.length * 3)
  const groundIds = new Set(scenario.ground_sites.map((site) => site.id))
  const clients = scenario.ground_sites.filter((site) => site.role === 'client')
  const gateways = new Set(
    scenario.ground_sites.filter((site) => site.role === 'gateway').map((site) => site.id),
  )
  const groundPositions = new Map(
    scenario.ground_sites.map((site) => [
      site.id,
      groundPosition(site.lat_deg, site.lon_deg),
    ]),
  )
  const nSteps = environment.horizon_s / environment.step_s

  const routes: Record<string, string[][]> = Object.fromEntries(
    clients.map((client) => [client.id, []]),
  )
  const reasons: Record<string, (OutageReason | null)[]> = Object.fromEntries(
    clients.map((client) => [client.id, []]),
  )
  const visibility: Record<string, boolean[]> = Object.fromEntries(
    clients.map((client) => [client.id, []]),
  )
  const pathDistances: Record<string, number[]> = Object.fromEntries(
    clients.map((client) => [client.id, []]),
  )
  const steps: SimulateResponse['steps'] = []
  let islEdgeTotal = 0
  let groundEdgeTotal = 0

  for (let stepIndex = 0; stepIndex < nSteps; stepIndex++) {
    const tS = stepIndex * environment.step_s
    positionsAt(model, tS, buffer)

    const active = design.satellites.map(
      (satellite) =>
        satellite.launch_batch <= design.launch_stage &&
        !scenario.failures.some(
          (failure) =>
            failure.satellite_id === satellite.id &&
            failure.start_s <= tS &&
            tS < failure.end_s,
        ),
    )
    const edges: WeightedEdge[] = []

    for (let leftIndex = 0; leftIndex < model.sats.length; leftIndex++) {
      if (!active[leftIndex]) continue
      const left = vectorAt(buffer, leftIndex)
      for (let rightIndex = leftIndex + 1; rightIndex < model.sats.length; rightIndex++) {
        if (!active[rightIndex]) continue
        const right = vectorAt(buffer, rightIndex)
        const dx = right.x - left.x
        const dy = right.y - left.y
        const dz = right.z - left.z
        const distanceKm = Math.hypot(dx, dy, dz)
        if (distanceKm >= environment.isl_range_km) continue

        const denominator = dx * dx + dy * dy + dz * dz
        const lambda = clamp(
          -(left.x * dx + left.y * dy + left.z * dz) / Math.max(denominator, 1e-12),
          0,
          1,
        )
        const closestKm = Math.hypot(
          left.x + lambda * dx,
          left.y + lambda * dy,
          left.z + lambda * dz,
        )
        if (closestKm <= R_EARTH_KM) continue

        edges.push({
          left: model.sats[leftIndex].id,
          right: model.sats[rightIndex].id,
          distanceKm,
        })
        islEdgeTotal++
      }
    }

    const offlineGateways = new Set(
      scenario.gateway_outages
        .filter((outage) => outage.start_s <= tS && tS < outage.end_s)
        .map((outage) => outage.gateway_id),
    )

    for (const site of scenario.ground_sites) {
      if (site.role === 'gateway' && offlineGateways.has(site.id)) continue
      const ground = groundPositions.get(site.id)!
      for (let satelliteIndex = 0; satelliteIndex < model.sats.length; satelliteIndex++) {
        if (!active[satelliteIndex]) continue
        const satellite = vectorAt(buffer, satelliteIndex)
        if (elevationDeg(satellite, ground) < environment.min_elevation_deg) continue
        edges.push({
          left: site.id,
          right: model.sats[satelliteIndex].id,
          distanceKm: Math.hypot(
            satellite.x - ground.x,
            satellite.y - ground.y,
            satellite.z - ground.z,
          ),
        })
        groundEdgeTotal++
      }
    }

    const graph = buildGraph(edges)
    for (const client of clients) {
      visibility[client.id].push((graph.get(client.id)?.length ?? 0) > 0)
      const path = findRoute(graph, client.id, gateways, groundIds, routing)
      routes[client.id].push(path)
      if (path.length) {
        reasons[client.id].push(null)
        pathDistances[client.id].push(pathDistance(path, graph))
      } else {
        reasons[client.id].push(
          classifyOutage(graph, client.id, gateways, offlineGateways),
        )
      }
    }

    steps.push({
      t_s: tS,
      inactive: design.satellites
        .filter((_, satelliteIndex) => !active[satelliteIndex])
        .map((satellite) => satellite.id),
      edges: edges.map(({ left, right }): Edge => [left, right]),
    })
  }

  const metrics: Record<string, ClientMetrics> = {}
  const targetPct = environment.target_availability * 100
  for (const client of clients) {
    const clientRoutes = routes[client.id]
    const availableCount = clientRoutes.filter((path) => path.length > 0).length
    const gaps = collectGaps(
      reasons[client.id],
      environment.step_s,
      environment.horizon_s,
    )
    const hopValues = clientRoutes.filter((path) => path.length).map((path) => path.length - 1)
    const histogram: Record<string, number> = {}
    for (const hops of hopValues) histogram[hops] = (histogram[hops] ?? 0) + 1
    const availabilityPct = round((100 * availableCount) / nSteps)
    const distances = pathDistances[client.id]

    metrics[client.id] = {
      visibility_pct: round(
        (100 * visibility[client.id].filter(Boolean).length) / nSteps,
      ),
      availability_pct: availabilityPct,
      target_met: availabilityPct >= targetPct,
      max_gap_s: Math.max(0, ...gaps.map((gap) => gap.duration_s)),
      total_outage_s: (nSteps - availableCount) * environment.step_s,
      gaps,
      hops: {
        min: hopValues.length ? Math.min(...hopValues) : null,
        max: hopValues.length ? Math.max(...hopValues) : null,
        avg: hopValues.length ? round(average(hopValues)) : 0,
        histogram,
      },
      avg_path_km: distances.length ? round(average(distances), 1) : null,
    }
  }

  const worstClient = clients.reduce((worst, client) =>
    metrics[client.id].availability_pct < metrics[worst.id].availability_pct
      ? client
      : worst,
  )
  const orbitalPeriodS = (2 * Math.PI) / model.n

  return {
    valid: true,
    meta: {
      scenario_id: scenario.meta.id,
      title: scenario.meta.title,
      n_steps: nSteps,
      step_s: environment.step_s,
      horizon_s: environment.horizon_s,
      target_availability: environment.target_availability,
      routing,
      computed_ms: round(performance.now() - started, 1),
    },
    constants: {
      earth_radius_km: R_EARTH_KM,
      mu_km3_s2: MU_KM3_S2,
      earth_rotation_period_s: EARTH_ROT_PERIOD_S,
      orbit_radius_km: model.r,
      mean_motion_deg_s: round((model.n * 180) / Math.PI, 7),
      orbital_period_s: round(orbitalPeriodS, 2),
      earth_rotation_deg_s: round(360 / EARTH_ROT_PERIOD_S, 7),
      satellite_speed_km_s: round(Math.sqrt(MU_KM3_S2 / model.r), 3),
    },
    nodes: {
      planes: structuredClone(design.planes),
      satellites: design.satellites.map((satellite) => ({
        ...structuredClone(satellite),
        ever_active: satellite.launch_batch <= design.launch_stage,
      })),
      ground: structuredClone(scenario.ground_sites),
    },
    steps,
    routes,
    reasons,
    metrics,
    summary: {
      all_targets_met: Object.values(metrics).every((item) => item.target_met),
      worst_client: worstClient.id,
      worst_availability_pct: metrics[worstClient.id].availability_pct,
      avg_isl_edges_per_step: round(islEdgeTotal / nSteps, 1),
      avg_ground_edges_per_step: round(groundEdgeTotal / nSteps, 1),
    },
  }
}

function vectorAt(buffer: Float64Array, index: number): Vec3 {
  const offset = index * 3
  return { x: buffer[offset], y: buffer[offset + 1], z: buffer[offset + 2] }
}

function buildGraph(edges: WeightedEdge[]): Graph {
  const graph: Graph = new Map()
  for (const edge of edges) {
    const left = graph.get(edge.left) ?? []
    left.push({ id: edge.right, distanceKm: edge.distanceKm })
    graph.set(edge.left, left)
    const right = graph.get(edge.right) ?? []
    right.push({ id: edge.left, distanceKm: edge.distanceKm })
    graph.set(edge.right, right)
  }
  return graph
}

function findRoute(
  graph: Graph,
  clientId: string,
  gateways: Set<string>,
  groundIds: Set<string>,
  mode: RoutingMode,
): string[] {
  const previous = new Map<string, string>()
  let target: string | null = null

  if (mode === 'min_distance') {
    const distances = new Map<string, number>([[clientId, 0]])
    const visited = new Set<string>()
    while (true) {
      let node: string | null = null
      let bestDistance = Number.POSITIVE_INFINITY
      for (const [candidate, distance] of distances) {
        if (!visited.has(candidate) && distance < bestDistance) {
          node = candidate
          bestDistance = distance
        }
      }
      if (node === null) break
      if (gateways.has(node)) {
        target = node
        break
      }
      visited.add(node)
      for (const neighbour of graph.get(node) ?? []) {
        if (groundIds.has(neighbour.id) && !gateways.has(neighbour.id)) continue
        const candidateDistance = bestDistance + neighbour.distanceKm
        if (candidateDistance < (distances.get(neighbour.id) ?? Number.POSITIVE_INFINITY)) {
          distances.set(neighbour.id, candidateDistance)
          previous.set(neighbour.id, node)
        }
      }
    }
  } else {
    const queue = [clientId]
    const visited = new Set([clientId])
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const node = queue[cursor]
      if (gateways.has(node)) {
        target = node
        break
      }
      for (const neighbour of graph.get(node) ?? []) {
        if (visited.has(neighbour.id)) continue
        if (groundIds.has(neighbour.id) && !gateways.has(neighbour.id)) continue
        visited.add(neighbour.id)
        previous.set(neighbour.id, node)
        queue.push(neighbour.id)
      }
    }
  }

  if (target === null) return []
  const path = [target]
  while (path[path.length - 1] !== clientId) {
    path.push(previous.get(path[path.length - 1])!)
  }
  return path.reverse()
}

function pathDistance(path: string[], graph: Graph): number {
  let total = 0
  for (let index = 0; index < path.length - 1; index++) {
    total += graph.get(path[index])!.find((edge) => edge.id === path[index + 1])!.distanceKm
  }
  return total
}

function classifyOutage(
  graph: Graph,
  clientId: string,
  gateways: Set<string>,
  offlineGateways: Set<string>,
): OutageReason {
  if (!(graph.get(clientId)?.length ?? 0)) return 'no_sat'
  if (gateways.size > 0 && [...gateways].every((gateway) => offlineGateways.has(gateway))) {
    return 'gw_down'
  }
  if (![...gateways].some((gateway) => (graph.get(gateway)?.length ?? 0) > 0)) {
    return 'no_gw'
  }
  return 'isl_break'
}

function collectGaps(
  reasons: (OutageReason | null)[],
  stepS: number,
  horizonS: number,
): Gap[] {
  const gaps: Gap[] = []
  let start: number | null = null
  let gapReasons: OutageReason[] = []

  for (let index = 0; index <= reasons.length; index++) {
    const reason = reasons[index] ?? null
    if (reason !== null && start === null) {
      start = index
      gapReasons = [reason]
    } else if (reason !== null) {
      gapReasons.push(reason)
    } else if (start !== null) {
      const startS = start * stepS
      const endS = index * stepS
      gaps.push({
        start_s: startS,
        end_s: endS,
        duration_s: endS - startS,
        reason: gapReasons[0],
        at_boundary: startS === 0 || endS === horizonS,
      })
      start = null
      gapReasons = []
    }
  }
  return gaps
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits
  const scaled = value * scale
  const lower = Math.floor(scaled)
  const fraction = scaled - lower
  // Python, которым собраны эталонные фикстуры, округляет точную половину
  // к ближайшему чётному. Повторяем это правило, чтобы результаты совпадали.
  if (Math.abs(fraction - 0.5) < 1e-10) {
    return (lower % 2 === 0 ? lower : lower + 1) / scale
  }
  return Math.round(scaled) / scale
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
