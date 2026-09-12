/**
 * Клиент API. Соответствует docs/openapi.yaml.
 *
 * По умолчанию все числа приходят с сервера: сценарии, валидация и расчёт
 * идут по HTTP на /api. Локальный расчёт (localSimulator) остаётся запасным
 * путём — клиент откатывается на него сам, если бэкенд не отвечает, и
 * поднимает флаг apiState.usingMock, который интерфейс показывает
 * пользователю. Сборка с VITE_API_MODE=local отключает сеть совсем.
 */

import type {
  Scenario,
  ScenarioListItem,
  SimulateResult,
  ValidationReport,
  RoutingMode,
} from '../types/api'
import { simulateLocally } from '../lib/localSimulator'
import { unwrapScenarioPayload } from '../lib/resultExport'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'
const USE_REMOTE_API = import.meta.env.VITE_API_MODE !== 'local'

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
  const normalized = await normalizeUpload(file)
  const form = new FormData()
  form.append('file', normalized.file)
  try {
    const result = await call<ValidationReport>('/scenarios/upload', { method: 'POST', body: form })
    return {
      ...result,
      ...(normalized.routing ? { routing: normalized.routing } : {}),
      ...(normalized.fromResult ? { fromResult: true } : {}),
    }
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e
    apiState.usingMock = true
    const local = await parseLocally(normalized.file, normalized.routing)
    return normalized.fromResult ? { ...local, fromResult: true } : local
  }
}

/** Запасной разбор в браузере: только базовые проверки структуры. */
async function parseLocally(file: File, knownRouting?: RoutingMode): Promise<ValidationReport> {
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
  const unwrapped = unwrapScenarioPayload(data)
  const result = validateLocally(unwrapped.scenario)
  const routing = knownRouting ?? unwrapped.routing
  return {
    ...result,
    ...(routing ? { routing } : {}),
    ...(unwrapped.fromResult ? { fromResult: true } : {}),
  }
}

/** Remote API принимает сценарий, поэтому result-файл разворачиваем до отправки. */
async function normalizeUpload(
  file: File,
): Promise<{ file: File; routing?: RoutingMode; fromResult?: boolean }> {
  try {
    const data = JSON.parse(await file.text()) as unknown
    const unwrapped = unwrapScenarioPayload(data)
    if (!unwrapped.fromResult) return { file }
    return {
      file: new File(
        [JSON.stringify(unwrapped.scenario)],
        file.name.replace(/_result(?=\.json$)/i, '') || 'scenario.json',
        { type: 'application/json' },
      ),
      routing: unwrapped.routing,
      fromResult: true,
    }
  } catch {
    return { file }
  }
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
  try {
    return await call<ValidationReport>('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario }),
    })
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e
    apiState.usingMock = true
    return validateLocally(scenario)
  }
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
