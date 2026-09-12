/**
 * Сверка TS-порта расчёта позиций с эталонным geometry.py.
 *
 * Зачем: фронт считает координаты спутников сам, чтобы анимация была плавной.
 * Если этот расчёт разойдётся с бэкендом, картинка начнёт врать — спутник
 * будет нарисован не там, где, по мнению сервера, он находится.
 *
 * Запуск:
 *   python3 tests/dump_reference.py > /tmp/ref.json
 *   node tests/orbital.check.mjs /tmp/ref.json
 */

import { readFileSync } from 'node:fs'

const R_EARTH_KM = 6371.0
const MU_KM3_S2 = 398600.435507
const EARTH_ROT_PERIOD_S = 86164.09054
const DEG = Math.PI / 180

function buildModel(scenario) {
  const env = scenario.environment
  const planes = new Map(scenario.design.planes.map((p) => [p.id, p]))
  const r = R_EARTH_KM + env.altitude_km
  return {
    r,
    n: Math.sqrt(MU_KM3_S2 / (r * r * r)),
    inc: env.inclination_deg * DEG,
    theta0: env.earth_angle0_deg * DEG,
    omega: (2 * Math.PI) / EARTH_ROT_PERIOD_S,
    sats: scenario.design.satellites.map((s) => {
      const p = planes.get(s.plane_id)
      return { id: s.id, u0: (s.slot_deg + p.phase_deg) * DEG, raan: p.raan_deg * DEG }
    }),
  }
}

function positionsAt(model, t, out) {
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
    const xi = r * (co * cu - so * su * cosInc)
    const yi = r * (so * cu + co * su * cosInc)
    const zi = r * su * sinInc
    const o = k * 3
    out[o] = xi * cosT + yi * sinT
    out[o + 1] = -xi * sinT + yi * cosT
    out[o + 2] = zi
  }
}

// ---- сверка ----

const ref = JSON.parse(readFileSync(process.argv[2] ?? '/tmp/ref.json', 'utf8'))
const model = buildModel(ref.scenario)
const out = new Float64Array(model.sats.length * 3)

let worst = 0
let worstWhere = ''
let checked = 0

for (const sample of ref.samples) {
  positionsAt(model, sample.t_s, out)
  for (let k = 0; k < model.sats.length; k++) {
    const id = model.sats[k].id
    const expect = sample.positions[id]
    const dx = out[k * 3] - expect[0]
    const dy = out[k * 3 + 1] - expect[1]
    const dz = out[k * 3 + 2] - expect[2]
    const err = Math.hypot(dx, dy, dz)
    checked++
    if (err > worst) {
      worst = err
      worstWhere = `${id} @ t=${sample.t_s}`
    }
  }
}

const TOL_KM = 1e-6
console.log(`проверено точек: ${checked}`)
console.log(`максимальное расхождение: ${worst.toExponential(3)} км  (${worstWhere})`)
console.log(`допуск: ${TOL_KM} км`)

if (worst > TOL_KM) {
  console.error('\nПРОВАЛ: TS-порт расходится с geometry.py')
  process.exit(1)
}
console.log('\nOK: TS-порт совпадает с эталоном')
