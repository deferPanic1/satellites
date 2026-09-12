import type {
  ClientMetrics,
  RoutingMode,
  Scenario,
  SimulateResponse,
  Variant,
} from '../types/api'

export interface ResultRouteRecord {
  t_s: number
  client_id: string
  path: string[]
}

/** Формат результата, заданный документом кейса. */
export interface CaseResultExport {
  schema_version: 'cosmo-A-result-1.0'
  effective_scenario: Scenario
  routes: ResultRouteRecord[]
  metrics?: Record<string, ClientMetrics>
  notes?: string
}

export interface UnwrappedScenario {
  scenario: unknown
  routing?: RoutingMode
  fromResult: boolean
}

export interface ResultExportOptions {
  /** заметка инженера: попадает в notes рядом со стратегией */
  note?: string
  /** метка варианта: закрепляется в meta, иначе теряется при выгрузке */
  label?: string
  /** порядковый номер варианта: из него строится machine-friendly meta.id */
  seq?: number
}

const TITLE_SEP = ' — '

const ROUTING_NOTE = /^routing=(min_hops|min_distance)$/m
const VARIANT_ID_SEP = '__'

/**
 * Формирует выгрузку из УЖЕ посчитанного результата. Это важно: повторный
 * расчёт во время скачивания мог бы использовать другую стратегию маршрута.
 */
export function buildResultExport(
  scenario: Scenario,
  result: SimulateResponse,
  options: ResultExportOptions = {},
): CaseResultExport {
  const nSteps = scenario.environment.horizon_s / scenario.environment.step_s
  const clients = scenario.ground_sites.filter((site) => site.role === 'client')
  const routes: ResultRouteRecord[] = []

  for (const client of clients) {
    const clientRoutes = result.routes[client.id]
    if (!clientRoutes || clientRoutes.length !== nSteps) {
      throw new Error(
        `Маршруты ${client.id}: ${clientRoutes?.length ?? 0} отсчётов вместо ${nSteps}`,
      )
    }
    for (let index = 0; index < nSteps; index++) {
      routes.push({
        t_s: index * scenario.environment.step_s,
        client_id: client.id,
        path: clientRoutes[index],
      })
    }
  }

  const routing = result.meta.routing ?? 'min_hops'
  const cleanNote = options.note?.trim()
  const notes = [`routing=${routing}`, ...(cleanNote ? [cleanNote] : [])].join('\n')

  return {
    schema_version: 'cosmo-A-result-1.0',
    effective_scenario: stampVariantMeta(scenario, options.label, options.seq),
    routes,
    metrics: result.metrics,
    notes,
  }
}

/**
 * Закрепляет метку варианта в meta сценария.
 *
 * Без этого скачанный вариант при обратной загрузке называется так же, как
 * исходный файл кейса: meta.title приходит из набора и правками параметров не
 * меняется, а метка живёт только в localStorage. Кейс разрешает произвольные
 * названия и идентификаторы при сохранении структуры, поэтому подписываем файл
 * сами. Базовая часть отрезается по разделителю, чтобы метки не наслаивались
 * при повторных «загрузил → сохранил → выгрузил».
 */
export function stampVariantMeta(
  scenario: Scenario,
  label?: string,
  seq?: number,
): Scenario {
  const clean = label?.trim()
  if (!clean) return scenario

  const baseTitle = scenario.meta.title.split(TITLE_SEP)[0].trim() || scenario.meta.title
  const baseId = scenario.meta.id.split(VARIANT_ID_SEP)[0] || scenario.meta.id
  const title = `${baseTitle}${TITLE_SEP}${clean}`
  const id = seq === undefined ? baseId : `${baseId}${VARIANT_ID_SEP}v${seq}`
  if (scenario.meta.title === title && scenario.meta.id === id) return scenario

  return { ...scenario, meta: { ...scenario.meta, title, id } }
}

/** Метка варианта, зашитая в meta.title выгрузкой, — для подписи при загрузке. */
export function variantLabelOf(scenario: Scenario): string | null {
  const index = scenario.meta.title.indexOf(TITLE_SEP)
  if (index < 0) return null
  return scenario.meta.title.slice(index + TITLE_SEP.length).trim() || null
}

/** При повторной загрузке результат становится исходным сценарием эксперимента. */
export function unwrapScenarioPayload(data: unknown): UnwrappedScenario {
  if (!isRecord(data) || data.schema_version !== 'cosmo-A-result-1.0') {
    return { scenario: data, fromResult: false }
  }

  const match = typeof data.notes === 'string' ? ROUTING_NOTE.exec(data.notes) : null
  return {
    scenario: data.effective_scenario,
    routing: match?.[1] as RoutingMode | undefined,
    fromResult: true,
  }
}

export function downloadVariantResult(variant: Variant) {
  const payload = buildResultExport(variant.scenario, variant.result, {
    note: variant.note,
    label: variant.label,
    seq: variant.seq,
  })
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeFilePart(variant.label)}_result.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_') || 'experiment'
}
