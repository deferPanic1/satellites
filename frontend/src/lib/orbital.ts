/**
 * Расчёт положения спутников — порт формул из «Описание данных» кейса
 * и функции positions() из geometry.py.
 *
 * ВАЖНО. Этот модуль существует ТОЛЬКО ради плавной анимации: бэк отдаёт
 * состояние сети на сетке 120 с, а рисовать надо на 60 fps. Все ЧИСЛА,
 * которые пользователь видит в таблицах и которые уходят в выгрузку,
 * приходят с бэкенда. Здесь — только координаты для картинки.
 *
 * Константы берутся из ответа /simulate (блок constants), чтобы фронт
 * и бэк считали одинаково и не разъезжались.
 */

import type { Constants, Scenario } from '../types/api'

export const R_EARTH_KM = 6371.0
export const MU_KM3_S2 = 398600.435507
export const EARTH_ROT_PERIOD_S = 86164.09054

const DEG = Math.PI / 180

export interface SatKinematics {
  id: string
  planeId: string
  /** slot_deg + phase_deg в радианах */
  u0: number
  /** raan_deg в радианах */
  raan: number
}

export interface OrbitalModel {
  /** радиус орбиты, км */
  r: number
  /** среднее движение, рад/с */
  n: number
  /** наклонение, рад */
  inc: number
  /** начальный угол поворота Земли, рад */
  theta0: number
  /** угловая скорость Земли, рад/с */
  omega: number
  sats: SatKinematics[]
  index: Map<string, number>
}

/**
 * Собирает кинематическую модель из сценария.
 * constants необязателен — если передан, используются его значения
 * (гарантия совпадения с бэком).
 */
export function buildModel(scenario: Scenario, constants?: Constants): OrbitalModel {
  const env = scenario.environment
  const planes = new Map(scenario.design.planes.map((p) => [p.id, p]))

  const rEarth = constants?.earth_radius_km ?? R_EARTH_KM
  const mu = constants?.mu_km3_s2 ?? MU_KM3_S2
  const rotPeriod = constants?.earth_rotation_period_s ?? EARTH_ROT_PERIOD_S

  const r = constants?.orbit_radius_km ?? rEarth + env.altitude_km
  const n = constants
    ? constants.mean_motion_deg_s * DEG
    : Math.sqrt(mu / (r * r * r))

  const sats: SatKinematics[] = scenario.design.satellites.map((s) => {
    const plane = planes.get(s.plane_id)
    if (!plane) throw new Error(`Плоскость ${s.plane_id} не найдена для ${s.id}`)
    return {
      id: s.id,
      planeId: s.plane_id,
      u0: (s.slot_deg + plane.phase_deg) * DEG,
      raan: plane.raan_deg * DEG,
    }
  })

  return {
    r,
    n,
    inc: env.inclination_deg * DEG,
    theta0: env.earth_angle0_deg * DEG,
    omega: (2 * Math.PI) / rotPeriod,
    sats,
    index: new Map(sats.map((s, i) => [s.id, i])),
  }
}

/**
 * Позиции всех спутников в момент t (секунды от начала расчёта),
 * в системе координат, СВЯЗАННОЙ С ЗЕМЛЁЙ, в километрах.
 *
 * Записывает в out как [x0,y0,z0, x1,y1,z1, ...]; out должен быть
 * длиной sats.length * 3. Без аллокаций — вызывается каждый кадр.
 */
export function positionsAt(model: OrbitalModel, t: number, out: Float64Array): void {
  const { r, n, inc, theta0, omega, sats } = model
  const cosInc = Math.cos(inc)
  const sinInc = Math.sin(inc)

  const theta = theta0 + omega * t
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)

  for (let k = 0; k < sats.length; k++) {
    const s = sats[k]
    const u = s.u0 + n * t
    const cu = Math.cos(u)
    const su = Math.sin(u)
    const co = Math.cos(s.raan)
    const so = Math.sin(s.raan)

    // инерциальные координаты
    const xi = r * (co * cu - so * su * cosInc)
    const yi = r * (so * cu + co * su * cosInc)
    const zi = r * su * sinInc

    // поворот в систему, связанную с Землёй
    const o = k * 3
    out[o] = xi * cosT + yi * sinT
    out[o + 1] = -xi * sinT + yi * cosT
    out[o + 2] = zi
  }
}

/** Позиция одного спутника по индексу. Для точечных запросов. */
export function positionOf(
  model: OrbitalModel,
  satIndex: number,
  t: number,
): { x: number; y: number; z: number } {
  const s = model.sats[satIndex]
  const u = s.u0 + model.n * t
  const cu = Math.cos(u)
  const su = Math.sin(u)
  const co = Math.cos(s.raan)
  const so = Math.sin(s.raan)
  const cosInc = Math.cos(model.inc)

  const xi = model.r * (co * cu - so * su * cosInc)
  const yi = model.r * (so * cu + co * su * cosInc)
  const zi = model.r * su * Math.sin(model.inc)

  const theta = model.theta0 + model.omega * t
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)

  return { x: xi * cosT + yi * sinT, y: -xi * sinT + yi * cosT, z: zi }
}

/**
 * Координаты наземного пункта на сфере радиуса R, км.
 * Соответствует ground_position() из geometry.py.
 */
export function groundPosition(latDeg: number, lonDeg: number, rEarth = R_EARTH_KM) {
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  return {
    x: rEarth * Math.cos(lat) * Math.cos(lon),
    y: rEarth * Math.cos(lat) * Math.sin(lon),
    z: rEarth * Math.sin(lat),
  }
}

/**
 * Угол возвышения спутника над наземным пунктом, градусы.
 * elevation = arcsin( ((s-g)·g) / (|s-g|·R) )
 * clamp обязателен: без него округление даёт NaN у самого зенита.
 */
export function elevationDeg(
  sat: { x: number; y: number; z: number },
  ground: { x: number; y: number; z: number },
  rEarth = R_EARTH_KM,
): number {
  const dx = sat.x - ground.x
  const dy = sat.y - ground.y
  const dz = sat.z - ground.z
  const dist = Math.hypot(dx, dy, dz)
  if (dist === 0) return 90
  const dot = (dx * ground.x + dy * ground.y + dz * ground.z) / (dist * rEarth)
  return (Math.asin(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
}

/** Полезные производные величины — для панели «о группировке». */
export function derivedFacts(model: OrbitalModel) {
  const period = (2 * Math.PI) / model.n
  return {
    orbitRadiusKm: model.r,
    altitudeKm: model.r - R_EARTH_KM,
    speedKmS: Math.sqrt(MU_KM3_S2 / model.r),
    periodS: period,
    periodMin: period / 60,
    revsPerDay: 86400 / period,
    meanMotionDegS: (model.n * 180) / Math.PI,
  }
}
