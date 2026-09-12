/**
 * Типы по OpenAPI-спецификации сервиса (docs/openapi.yaml).
 * Держать в синхроне со спекой; при изменении бэка обновлять здесь.
 */

export type Role = 'client' | 'gateway'
export type OutageReason = 'no_sat' | 'isl_break' | 'no_gw' | 'gw_down'
export type RoutingMode = 'min_hops' | 'min_distance'

// ---------- входной сценарий cosmo-A-1.0 ----------

export interface Environment {
  altitude_km: number
  inclination_deg: number
  earth_angle0_deg: number
  horizon_s: number
  step_s: number
  min_elevation_deg: number
  isl_range_km: number
  target_availability: number
}

export interface Plane {
  id: string
  raan_deg: number
  phase_deg: number
}

export interface Satellite {
  id: string
  plane_id: string
  slot_deg: number
  launch_batch: number
}

export interface GroundSite {
  id: string
  name: string
  role: Role
  lat_deg: number
  lon_deg: number
}

export interface SatelliteOutage {
  satellite_id: string
  start_s: number
  end_s: number
}

export interface GatewayOutage {
  gateway_id: string
  start_s: number
  end_s: number
}

export interface Scenario {
  schema_version: 'cosmo-A-1.0'
  meta: { id: string; title: string }
  environment: Environment
  design: {
    launch_stage: number
    planes: Plane[]
    satellites: Satellite[]
  }
  ground_sites: GroundSite[]
  failures: SatelliteOutage[]
  gateway_outages: GatewayOutage[]
}

// ---------- валидация ----------

export interface FieldError {
  path: string
  code: string
  message: string
  value?: unknown
}

export interface ScenarioSummary {
  n_satellites: number
  n_active_satellites?: number
  n_planes: number
  n_clients: number
  n_gateways: number
  n_steps: number
  launch_stage: number
}

export interface ValidationReport {
  valid: boolean
  scenario: Scenario | null
  summary: ScenarioSummary | null
  errors: FieldError[]
  warnings: FieldError[]
}

// ---------- результат расчёта ----------

export interface ResultMeta {
  scenario_id: string
  title?: string
  n_steps: number
  step_s: number
  horizon_s: number
  target_availability: number
  routing?: RoutingMode
  computed_ms?: number
}

export interface Constants {
  earth_radius_km: number
  mu_km3_s2: number
  earth_rotation_period_s: number
  orbit_radius_km: number
  mean_motion_deg_s: number
  orbital_period_s: number
  earth_rotation_deg_s: number
  satellite_speed_km_s: number
}

export interface Nodes {
  planes: Plane[]
  satellites: (Satellite & { ever_active?: boolean })[]
  ground: GroundSite[]
}

/** Пара ID. Все правила доступности связи уже применены бэкендом. */
export type Edge = [string, string]

export interface StepState {
  t_s: number
  inactive: string[]
  edges: Edge[]
}

export interface Gap {
  start_s: number
  end_s: number
  duration_s: number
  reason?: OutageReason
  at_boundary?: boolean
}

export interface HopStats {
  min: number | null
  max: number | null
  avg: number
  histogram: Record<string, number>
}

export interface ClientMetrics {
  visibility_pct: number
  availability_pct: number
  target_met: boolean
  max_gap_s: number
  total_outage_s: number
  gaps: Gap[]
  hops: HopStats
  avg_path_km: number | null
}

export interface ResultSummary {
  all_targets_met: boolean
  worst_client: string
  worst_availability_pct: number
  avg_isl_edges_per_step: number
  avg_ground_edges_per_step: number
}

export interface SimulateResponse {
  valid: true
  meta: ResultMeta
  constants: Constants
  nodes: Nodes
  steps: StepState[]
  /** client_id -> массив длины n_steps; пустой массив = маршрута нет */
  routes: Record<string, string[][]>
  /** client_id -> массив длины n_steps; null там, где маршрут есть */
  reasons: Record<string, (OutageReason | null)[]>
  metrics: Record<string, ClientMetrics>
  summary: ResultSummary
}

export type SimulateResult = SimulateResponse | ValidationReport

export function isSimulateResponse(r: SimulateResult): r is SimulateResponse {
  return r.valid === true && 'meta' in r
}

// ---------- прочее ----------

export interface ScenarioListItem {
  id: string
  title: string
  n_satellites?: number
  n_planes?: number
  n_clients?: number
  n_gateways?: number
  launch_stage?: number
  isl_range_km?: number
  n_failures?: number
}

export interface RouteLeg {
  from: string
  to: string
  type: 'uplink' | 'isl' | 'downlink'
  distance_km: number
  elevation_deg?: number
  inter_plane?: boolean
}

/** Сохранённый вариант проекта. Живёт только на фронте — сервер без состояния. */
export interface Variant {
  id: string
  label: string
  /**
   * Порядковый номер сохранения, монотонный и не переиспользуемый.
   * Цвет варианта в графиках закреплён за seq, а не за позицией в списке:
   * удаление соседа не должно перекрашивать остальные серии.
   */
  seq: number
  scenario: Scenario
  result: SimulateResponse
  createdAt: number
  /** заметка инженера: чем этот вариант интересен */
  note?: string
}
