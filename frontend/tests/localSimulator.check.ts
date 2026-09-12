import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { simulateLocally } from '../src/lib/localSimulator'
import type { Scenario, SimulateResponse } from '../src/types/api'

const ids = [
  '01_full_constellation',
  '02_first_launch',
  '03_satellite_outages',
  '04_link_range',
]
const comparedFields = ['constants', 'nodes', 'steps', 'routes', 'reasons', 'metrics', 'summary'] as const

for (const id of ids) {
  const scenario = readJson<Scenario>(resolve('../case/Данные', `${id}.json`))
  const expected = readJson<SimulateResponse>(resolve('public/mock', `simulate-${id}.json`))
  const actual = simulateLocally(scenario)

  for (const field of comparedFields) {
    if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
      throw new Error(
        `${id}: локальный расчёт расходится с фикстурой в поле ${field}\n` +
          `actual: ${JSON.stringify(actual[field])}\nexpected: ${JSON.stringify(expected[field])}`,
      )
    }
  }
  console.log(`${id}: ${actual.summary.worst_availability_pct}% — совпадает`)
}

const changed = readJson<Scenario>(resolve('../case/Данные/01_full_constellation.json'))
changed.environment.isl_range_km = 2500
const changedResult = simulateLocally(changed)
if (changedResult.summary.worst_availability_pct !== 79.44) {
  throw new Error(
    `Правка ISL не пересчиталась: ожидалось 79.44, получено ${changedResult.summary.worst_availability_pct}`,
  )
}
console.log('Изменённый ISL 2500 км: 79.44% — пересчёт работает')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
