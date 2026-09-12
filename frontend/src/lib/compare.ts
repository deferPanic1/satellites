/**
 * Модель сравнения вариантов.
 *
 * Чистые функции: на входе сохранённые варианты, на выходе структура,
 * которую остаётся отрисовать. Никакого React и никаких обращений к стору —
 * логику сравнения можно проверить отдельно от интерфейса.
 *
 * Кейс требует сопоставлять варианты «по доступности связи, продолжительности
 * перерывов и характеристикам маршрутов», а в сравнении показывать
 * «изменённые параметры, итоговые показатели и различия между результатами».
 * Три блока ниже — ровно про это: agg/byClient (показатели), params (дифф
 * конфигураций), verdict (словесный вывод, который команда защищает перед жюри).
 */

import type { OutageReason, Scenario, SimulateResponse, Variant } from '../types/api'
import { fmtDur, plural, REASON_LABEL, REASONS, variantColor } from './viz'

export interface ClientView {
  client: string
  availability: number
  visibility: number
  maxGapS: number
  totalOutageS: number
  gapCount: number
  avgHops: number
  maxHops: number | null
  avgKm: number | null
  outageByReason: Record<string, number>
  hopHistogram: Record<string, number>
  routes: string[][]
  reasons: (OutageReason | null)[]
}

export interface Agg {
  worstAvailability: number
  worstClient: string
  avgAvailability: number
  clientCount: number
  totalOutageS: number
  maxGapS: number
  gapCount: number
  avgHops: number
  avgKm: number | null
  outageByReason: Record<string, number>
  hopHistogram: Record<string, number>
  activeSats: number
  islPerStep: number
}

export interface VariantView {
  id: string
  label: string
  seq: number
  color: string
  createdAt: number
  note?: string
  scenario: Scenario
  result: SimulateResponse
  agg: Agg
  byClient: Record<string, ClientView>
}

export interface ParamRow {
  key: string
  group: string
  label: string
  values: string[]
  differs: boolean
}

export interface Comparison {
  variants: VariantView[]
  base: VariantView
  clients: string[]
  best: VariantView
  /** лучший вариант по каждому пункту отдельно */
  bestByClient: Record<string, string>
  params: ParamRow[]
  verdict: string[]
  stepS: number
  nSteps: number
}

// ---------- разбор одного варианта ----------

function activeSats(s: Scenario): number {
  return s.design.satellites.filter((x) => x.launch_batch <= s.design.launch_stage).length
}

function mergeHist(into: Record<string, number>, from: Record<string, number> | undefined) {
  for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + v
}

export function viewOf(v: Variant): VariantView {
  const clients = Object.keys(v.result.metrics)
  const byClient: Record<string, ClientView> = {}

  const outageByReason: Record<string, number> = {}
  const hopHistogram: Record<string, number> = {}
  let totalOutageS = 0
  let maxGapS = 0
  let gapCount = 0
  let hopsSum = 0
  let kmSum = 0
  let kmCount = 0
  let availSum = 0

  for (const c of clients) {
    const m = v.result.metrics[c]
    const perReason: Record<string, number> = {}
    for (const g of m.gaps ?? []) {
      const key = g.reason ?? 'isl_break'
      perReason[key] = (perReason[key] ?? 0) + g.duration_s
    }
    byClient[c] = {
      client: c,
      availability: m.availability_pct,
      visibility: m.visibility_pct,
      maxGapS: m.max_gap_s,
      totalOutageS: m.total_outage_s,
      gapCount: (m.gaps ?? []).length,
      avgHops: m.hops?.avg ?? 0,
      maxHops: m.hops?.max ?? null,
      avgKm: m.avg_path_km,
      outageByReason: perReason,
      hopHistogram: m.hops?.histogram ?? {},
      routes: v.result.routes[c] ?? [],
      reasons: v.result.reasons?.[c] ?? [],
    }

    mergeHist(outageByReason, perReason)
    mergeHist(hopHistogram, m.hops?.histogram)
    totalOutageS += m.total_outage_s
    maxGapS = Math.max(maxGapS, m.max_gap_s)
    gapCount += (m.gaps ?? []).length
    hopsSum += m.hops?.avg ?? 0
    availSum += m.availability_pct
    if (m.avg_path_km !== null) {
      kmSum += m.avg_path_km
      kmCount++
    }
  }

  return {
    id: v.id,
    label: v.label,
    seq: v.seq ?? 1,
    color: variantColor(v.seq ?? 1),
    createdAt: v.createdAt,
    note: v.note,
    scenario: v.scenario,
    result: v.result,
    byClient,
    agg: {
      worstAvailability: v.result.summary.worst_availability_pct,
      worstClient: v.result.summary.worst_client,
      avgAvailability: clients.length ? availSum / clients.length : 0,
      clientCount: clients.length,
      totalOutageS,
      maxGapS,
      gapCount,
      avgHops: clients.length ? hopsSum / clients.length : 0,
      avgKm: kmCount ? kmSum / kmCount : null,
      outageByReason,
      hopHistogram,
      activeSats: activeSats(v.scenario),
      islPerStep: v.result.summary.avg_isl_edges_per_step,
    },
  }
}

// ---------- дифф параметров ----------

const ROUTING_TEXT: Record<string, string> = {
  min_hops: 'мин. переходов',
  min_distance: 'мин. дистанция',
}

function paramRow(
  key: string,
  group: string,
  label: string,
  views: VariantView[],
  read: (v: VariantView) => string,
): ParamRow {
  const values = views.map(read)
  return { key, group, label, values, differs: new Set(values).size > 1 }
}

export function diffParams(views: VariantView[]): ParamRow[] {
  const rows: ParamRow[] = [
    paramRow('routing', 'Расчёт', 'Стратегия маршрутизации', views, (v) =>
      ROUTING_TEXT[v.result.meta.routing ?? 'min_hops'] ?? '—',
    ),
    paramRow('stage', 'Развёртывание', 'Очередь запуска', views, (v) =>
      String(v.scenario.design.launch_stage),
    ),
    paramRow('active', 'Развёртывание', 'Аппаратов в расчёте', views, (v) =>
      String(v.agg.activeSats),
    ),
    paramRow('isl', 'Связь', 'Дальность ISL', views, (v) =>
      `${v.scenario.environment.isl_range_km} км`,
    ),
    paramRow('elev', 'Связь', 'Порог возвышения', views, (v) =>
      `${v.scenario.environment.min_elevation_deg}°`,
    ),
  ]

  // Плоскости: объединение id по всем вариантам — состав может отличаться.
  const planeIds: string[] = []
  for (const v of views)
    for (const p of v.scenario.design.planes) if (!planeIds.includes(p.id)) planeIds.push(p.id)

  for (const id of planeIds) {
    rows.push(
      paramRow(`raan:${id}`, 'Плоскости', `RAAN ${id}`, views, (v) => {
        const p = v.scenario.design.planes.find((x) => x.id === id)
        return p ? `${p.raan_deg.toFixed(1)}°` : '—'
      }),
    )
    rows.push(
      paramRow(`phase:${id}`, 'Плоскости', `Фаза ${id}`, views, (v) => {
        const p = v.scenario.design.planes.find((x) => x.id === id)
        return p ? `${p.phase_deg.toFixed(1)}°` : '—'
      }),
    )
  }

  rows.push(
    paramRow('fails', 'Недоступность', 'Периодов отказа аппаратов', views, (v) =>
      String(v.scenario.failures.length),
    ),
    paramRow('gwfails', 'Недоступность', 'Периодов отказа шлюзов', views, (v) =>
      String(v.scenario.gateway_outages.length),
    ),
  )

  return rows
}

/** Чипы «чем отличается от базы» для компактной карточки варианта. */
export function diffChips(base: VariantView, v: VariantView, limit = 3): string[] {
  if (base.id === v.id) return []
  const rows = diffParams([base, v]).filter((r) => r.differs)
  const chips = rows.map((r) => `${r.label} ${r.values[0]} → ${r.values[1]}`)
  return chips.length > limit ? [...chips.slice(0, limit), `и ещё ${chips.length - limit}`] : chips
}

// ---------- вердикт ----------

function dominantReason(byReason: Record<string, number>): { key: string; share: number } | null {
  const total = Object.values(byReason).reduce((a, b) => a + b, 0)
  if (!total) return null
  const top = REASONS.map((k) => ({ key: k as string, s: byReason[k] ?? 0 })).reduce((a, b) =>
    b.s > a.s ? b : a,
  )
  return top.s ? { key: top.key, share: (top.s / total) * 100 } : null
}

/**
 * Лучший вариант максимизирует результат самого слабого пункта: высокая
 * доступность двух пунктов не должна прятать провал третьего. При равенстве
 * побеждает меньший суммарный перерыв.
 */
export function pickBest(views: VariantView[]): VariantView {
  return views.reduce((best, v) => {
    if (v.agg.worstAvailability > best.agg.worstAvailability) return v
    if (v.agg.worstAvailability < best.agg.worstAvailability) return best
    return v.agg.totalOutageS < best.agg.totalOutageS ? v : best
  })
}

function buildVerdict(
  views: VariantView[],
  base: VariantView,
  best: VariantView,
): string[] {
  const out: string[] = []
  const n = views.length

  const head = `«${best.label}» — лучший из ${n}: самый слабый пункт ${best.agg.worstClient} держит ${best.agg.worstAvailability.toFixed(2)}% времени.`
  out.push(head)

  if (best.id !== base.id) {
    const dAvail = best.agg.worstAvailability - base.agg.worstAvailability
    const dOut = best.agg.totalOutageS - base.agg.totalOutageS
    const dGap = best.agg.maxGapS - base.agg.maxGapS
    out.push(
      `Против «${base.label}»: слабый пункт ${dAvail >= 0 ? 'выше' : 'ниже'} на ${Math.abs(dAvail).toFixed(2)} п.п., ` +
        `суммарное время без связи ${dOut <= 0 ? 'меньше' : 'больше'} на ${fmtDur(Math.abs(dOut))}, ` +
        `самый долгий перерыв ${dGap === 0 ? 'такой же' : `${dGap < 0 ? 'короче' : 'длиннее'} на ${fmtDur(Math.abs(dGap))}`}.`,
    )
  } else if (n > 1) {
    const k = n - 1
    out.push(
      k === 1
        ? `База сравнения и есть лучший вариант: второй вариант не улучшает самый слабый пункт.`
        : `База сравнения и есть лучший вариант: остальные ${k} ${plural(k, 'вариант', 'варианта', 'вариантов')} не улучшают самый слабый пункт.`,
    )
  }

  const dom = dominantReason(best.agg.outageByReason)
  if (dom) {
    out.push(
      `Основная причина перерывов — ${REASON_LABEL[dom.key].toLowerCase()}: ${dom.share.toFixed(0)}% всего времени без связи в варианте «${best.label}».`,
    )
  }

  return out
}

// ---------- сборка ----------

export function buildComparison(
  variants: Variant[],
  baseId: string | null,
): Comparison | null {
  if (variants.length < 1) return null
  const views = variants.map(viewOf)
  const base = views.find((v) => v.id === baseId) ?? views[0]

  const clients: string[] = []
  for (const v of views) for (const c of Object.keys(v.byClient)) if (!clients.includes(c)) clients.push(c)
  clients.sort()

  const best = pickBest(views)

  const bestByClient: Record<string, string> = {}
  for (const c of clients) {
    bestByClient[c] = views.reduce((a, v) =>
      (v.byClient[c]?.availability ?? -1) > (a.byClient[c]?.availability ?? -1) ? v : a,
    ).id
  }

  return {
    variants: views,
    base,
    clients,
    best,
    bestByClient,
    params: diffParams(views),
    verdict: buildVerdict(views, base, best),
    stepS: base.result.meta.step_s,
    nSteps: base.result.meta.n_steps,
  }
}
