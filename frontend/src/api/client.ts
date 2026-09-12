/**
 * Клиент API. Соответствует docs/openapi.yaml.
 *
 * По умолчанию фронтенд работает автономно: сценарии берёт из public/mock,
 * а модель считает локально. Когда API будет готов, сборка с
 * VITE_API_MODE=remote переключит те же функции на HTTP.
 */

import type {
  Scenario,
  ScenarioListItem,
  SimulateResult,
  ValidationReport,
  RoutingMode,
} from '../types/api'
import { simulateLocally } from '../lib/localSimulator'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'
const USE_REMOTE_API = import.meta.env.VITE_API_MODE === 'remote'

export const apiState = {
  usingMock: false,
}

class NetworkError extends Error {}

/**
 * Коды, которыми dev-прокси Vite отвечает, когда бэкенда просто нет.
 * Это НЕ ошибка приложения: proxy не может достучаться до :8000 и отдаёт 502.
 * Без этой проверки клиент считал бы бэкенд «ответившим с ошибкой»
 * и не переключался на фикстуры.
 */
const BACKEND_DOWN = new Set([502, 503, 504])

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch (e) {
    throw new NetworkError(String(e))
  }
  if (BACKEND_DOWN.has(res.status)) {
    throw new NetworkError(`Бэкенд не отвечает (HTTP ${res.status})`)
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* тело не JSON — оставляем код */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

async function loadMock<T>(file: string): Promise<T> {
  apiState.usingMock = true
  const res = await fetch(`${import.meta.env.BASE_URL}mock/${file}`)
  if (!res.ok) throw new Error(`Фикстура ${file} не найдена`)
  return res.json() as Promise<T>
}

// ---------- сценарии ----------

export async function listScenarios(): Promise<ScenarioListItem[]> {
  if (!USE_REMOTE_API) return loadMock<ScenarioListItem[]>('scenarios.json')
  try {
    return await call<ScenarioListItem[]>('/scenarios')
  } catch (e) {
    if (e instanceof NetworkError) return loadMock<ScenarioListItem[]>('scenarios.json')
    throw e
  }
}

export async function getScenario(id: string): Promise<Scenario> {
  if (!USE_REMOTE_API) return loadMock<Scenario>(`scenario-${id}.json`)
  try {
    return await call<Scenario>(`/scenarios/${encodeURIComponent(id)}`)
  } catch (e) {
    if (e instanceof NetworkError) return loadMock<Scenario>(`scenario-${id}.json`)
    throw e
  }
}

/**
 * Загрузка пользовательского файла.
 * В автономном режиме разбираем файл прямо в браузере. В remote-режиме
 * сервер выполняет полную валидацию, а локальная остаётся запасной.
 */
export async function uploadScenario(file: File): Promise<ValidationReport> {
  if (!USE_REMOTE_API) {
    apiState.usingMock = true
    return parseLocally(file)
  }
  const form = new FormData()
  form.append('file', file)
  try {
    return await call<ValidationReport>('/scenarios/upload', { method: 'POST', body: form })
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e
    apiState.usingMock = true
    return parseLocally(file)
  }
}

/** Запасной разбор в браузере: только базовые проверки структуры. */
async function parseLocally(file: File): Promise<ValidationReport> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return report([{ path: '$', code: 'malformed_json', message: 'Не удалось прочитать файл' }])
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return report([
      { path: '$', code: 'malformed_json', message: `Файл не является корректным JSON: ${err}` },
    ])
  }
  return validateLocally(data)
}

function validateLocally(data: unknown): ValidationReport {
  const s = data as Scenario
  const errors = []
  if (s?.schema_version !== 'cosmo-A-1.0') {
    errors.push({
      path: 'schema_version',
      code: 'unsupported_schema_version',
      message: `Ожидается "cosmo-A-1.0", получено "${s?.schema_version}"`,
      value: s?.schema_version,
    })
  }
  for (const key of ['environment', 'design', 'ground_sites'] as const) {
    if (!s?.[key]) {
      errors.push({ path: key, code: 'missing_field', message: `Отсутствует раздел "${key}"` })
    }
  }
  const env = s?.environment
  if (env && env.horizon_s % env.step_s !== 0) {
    errors.push({
      path: 'environment.step_s',
      code: 'invalid_time_grid',
      message: `horizon_s (${env.horizon_s}) должен делиться на step_s (${env.step_s}) без остатка`,
      value: env.step_s,
    })
  }
  const roles = s?.ground_sites?.map((g) => g.role) ?? []
  if (!roles.includes('client') || !roles.includes('gateway')) {
    errors.push({
      path: 'ground_sites',
      code: 'client_or_gateway_missing',
      message: 'Нужен хотя бы один пункт с role=client и хотя бы один с role=gateway',
    })
  }
  if (errors.length) return report(errors)

  return {
    valid: true,
    scenario: s,
    summary: {
      n_satellites: s.design.satellites.length,
      n_planes: s.design.planes.length,
      n_clients: s.ground_sites.filter((g) => g.role === 'client').length,
      n_gateways: s.ground_sites.filter((g) => g.role === 'gateway').length,
      n_steps: env.horizon_s / env.step_s,
      launch_stage: s.design.launch_stage,
    },
    errors: [],
    warnings: [],
  }
}

function report(errors: ValidationReport['errors']): ValidationReport {
  return { valid: false, scenario: null, summary: null, errors, warnings: [] }
}

// ---------- расчёт ----------

export async function validateScenario(scenario: Scenario): Promise<ValidationReport> {
  if (!USE_REMOTE_API) {
    apiState.usingMock = true
    return validateLocally(scenario)
  }
  return call<ValidationReport>('/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  })
}

export async function simulate(
  scenario: Scenario,
  routing: RoutingMode = 'min_hops',
): Promise<SimulateResult> {
  if (!USE_REMOTE_API) {
    apiState.usingMock = true
    // Даём React отрисовать loading-состояние перед синхронным расчётом.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    return simulateLocally(scenario, routing)
  }
  try {
    const r = await call<SimulateResult>('/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, options: { routing } }),
    })
    apiState.usingMock = false
    return r
  } catch (e) {
    if (e instanceof NetworkError) {
      apiState.usingMock = true
      return simulateLocally(scenario, routing)
    }
    throw e
  }
}

export async function exportResult(scenario: Scenario, notes?: string): Promise<Blob> {
  if (!USE_REMOTE_API) {
    const result = simulateLocally(scenario)
    const routes = Object.entries(result.routes).flatMap(([clientId, clientRoutes]) =>
      clientRoutes.map((path, index) => ({
        t_s: index * scenario.environment.step_s,
        client_id: clientId,
        path,
      })),
    )
    return new Blob(
      [
        JSON.stringify(
          {
            schema_version: 'cosmo-A-result-1.0',
            effective_scenario: scenario,
            routes,
            metrics: result.metrics,
            ...(notes === undefined ? {} : { notes }),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
  }
  const res = await fetch(`${BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, include_metrics: true, notes }),
  })
  if (!res.ok) throw new Error(`Не удалось выгрузить результат: HTTP ${res.status}`)
  return res.blob()
}
