import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { simulateLocally } from '../src/lib/localSimulator'
import type { Scenario } from '../src/types/api'

// Повторяет тело exportResult() из src/api/client.ts (локальная ветка).
function buildExport(scenario: Scenario, notes?: string) {
  const result = simulateLocally(scenario)
  const routes = Object.entries(result.routes).flatMap(([clientId, clientRoutes]) =>
    clientRoutes.map((path, index) => ({
      t_s: index * scenario.environment.step_s,
      client_id: clientId,
      path,
    })),
  )
  return {
    schema_version: 'cosmo-A-result-1.0',
    effective_scenario: scenario,
    routes,
    metrics: result.metrics,
    ...(notes === undefined ? {} : { notes }),
  }
}

const ids = ['01_full_constellation', '02_first_launch', '03_satellite_outages', '04_link_range']
const problems: string[] = []

for (const id of ids) {
  const scenario = readJson<Scenario>(resolve('../case/Данные', `${id}.json`))
  const out = buildExport(scenario)
  const env = scenario.environment
  const nSteps = env.horizon_s / env.step_s
  const clients = scenario.ground_sites.filter((s) => s.role === 'client')
  const gateways = new Set(
    scenario.ground_sites.filter((s) => s.role === 'gateway').map((s) => s.id),
  )
  const expected = nSteps * clients.length

  const check = (ok: boolean, msg: string) => {
    if (!ok) problems.push(`${id}: ${msg}`)
  }

  check(out.schema_version === 'cosmo-A-result-1.0', `schema_version = ${out.schema_version}`)
  check(!!out.effective_scenario, 'нет effective_scenario')
  check(
    JSON.stringify(out.effective_scenario) === JSON.stringify(scenario),
    'effective_scenario не совпадает с использованным сценарием',
  )
  check(
    out.routes.length === expected,
    `routes.length = ${out.routes.length}, ожидалось ${expected} (${nSteps} шагов × ${clients.length} клиентов)`,
  )

  // покрытие сетки: каждая пара (t_s, client_id) ровно один раз
  const seen = new Set<string>()
  let dup = 0
  let badT = 0
  let emptyPaths = 0
  let badEnds = 0
  let badIntermediate = 0
  let badClientId = 0
  const clientIds = new Set(clients.map((c) => c.id))

  for (const r of out.routes) {
    const key = `${r.t_s}|${r.client_id}`
    if (seen.has(key)) dup++
    seen.add(key)
    if (r.t_s % env.step_s !== 0 || r.t_s < 0 || r.t_s >= env.horizon_s) badT++
    if (!clientIds.has(r.client_id)) badClientId++
    if (!Array.isArray(r.path)) problems.push(`${id}: path не массив при t_s=${r.t_s}`)
    if (r.path.length === 0) {
      emptyPaths++
      continue
    }
    if (r.path[0] !== r.client_id || !gateways.has(r.path[r.path.length - 1])) badEnds++
    for (const node of r.path.slice(1, -1)) {
      if (!node.startsWith('S')) badIntermediate++
    }
  }

  check(dup === 0, `дубликатов пар (t_s, client_id): ${dup}`)
  check(seen.size === expected, `уникальных пар ${seen.size}, ожидалось ${expected}`)
  check(badT === 0, `записей с t_s вне сетки: ${badT}`)
  check(badClientId === 0, `записей с client_id не из client-пунктов: ${badClientId}`)
  check(badEnds === 0, `путей, не начинающихся клиентом / не кончающихся шлюзом: ${badEnds}`)
  check(badIntermediate === 0, `промежуточных узлов не-спутников: ${badIntermediate}`)

  const bytes = Buffer.byteLength(JSON.stringify(out))
  console.log(
    `${id}: routes=${out.routes.length}/${expected}, пустых path=${emptyPaths}, размер=${(bytes / 1024 / 1024).toFixed(2)} МБ`,
  )
}

// round-trip: effective_scenario должен грузиться обратно
const base = readJson<Scenario>(resolve('../case/Данные/01_full_constellation.json'))
const edited: Scenario = JSON.parse(JSON.stringify(base))
edited.design.launch_stage = 1
edited.design.planes[1].raan_deg = 95
edited.design.planes[1].phase_deg = 11.25
edited.failures = [{ satellite_id: 'S07', start_s: 21600, end_s: 43200 }] as never
const exported = buildExport(edited, 'проверка round-trip')
const reloaded = exported.effective_scenario
if (
  reloaded.design.launch_stage !== 1 ||
  reloaded.design.planes[1].raan_deg !== 95 ||
  reloaded.failures.length !== 1
) {
  problems.push('round-trip: правки пользователя не попали в effective_scenario')
}
const again = buildExport(reloaded)
if (JSON.stringify(again.routes) !== JSON.stringify(exported.routes)) {
  problems.push('round-trip: повторная загрузка выгрузки даёт другие маршруты')
}
console.log(
  `round-trip (stage=1, RAAN P2=95, отказ S07): routes=${exported.routes.length}, повторный расчёт совпадает`,
)

if (problems.length) {
  console.log('\n❌ ПРОБЛЕМЫ:')
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log('\n✅ Выгрузка соответствует cosmo-A-result-1.0')
