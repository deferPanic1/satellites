/**
 * Единое состояние проекта.
 *
 * Сервер без состояния, поэтому варианты живут здесь и в localStorage.
 * Это осознанное решение: вариант весит ~150 КБ, БД ради него заводить
 * незачем, а требование кейса «сохранить вариант и вернуться к нему»
 * закрывается полностью.
 *
 * Производные значения (clients, gateways, nSteps…) держим прямо в состоянии,
 * а не в селекторах: селектор, возвращающий новый массив на каждый вызов,
 * ломает useSyncExternalStore React 19 («getSnapshot should be cached»).
 */

import { create } from 'zustand'
import * as api from '../api/client'
import {
  isSimulateResponse,
  type ClientMetrics,
  type Environment,
  type GroundSite,
  type OutageReason,
  type RoutingMode,
  type Scenario,
  type SimulateResponse,
  type StepState,
  type Variant,
  type FieldError,
} from '../types/api'

const VARIANTS_KEY = 'cosmo.variants.v1'

/**
 * Одна правка конфигурации, ещё не попавшая в расчёт.
 * Показывается в полосе пересчёта, чтобы пользователь видел,
 * что именно он изменил с прошлого расчёта.
 */
export interface PendingChange {
  key: string
  what: string
  from?: string
  to?: string
}

interface Derived {
  clients: GroundSite[]
  gateways: GroundSite[]
  nSteps: number
  stepS: number
  horizonS: number
}

export interface ProjectState extends Derived {
  scenario: Scenario | null
  result: SimulateResponse | null
  variants: Variant[]

  /**
   * Что участвует в сравнении и что взято за базу.
   *
   * Раньше базой молча становился первый сохранённый вариант. Это неверно:
   * база — это «как было», и выбирает её инженер. Набор участников тоже
   * его выбор: сохранённых вариантов за сессию набирается десяток,
   * а сравнивают одновременно два-три.
   */
  compareIds: string[]
  baseVariantId: string | null
  compareOpen: boolean

  /**
   * Параметры расчёта такими, какими они пришли из файла сценария.
   * Нужны, чтобы честно показать в панели «изменено с 3000 км»:
   * кейс задаёт environment как условия набора, и отклонение от них
   * должно быть видно, а не спрятано.
   */
  envBaseline: Environment | null

  /**
   * Черновик и посчитанное — разные вещи.
   *
   * `scenario` — то, что крутит пользователь: из него считается геометрия
   * (позиции, орбиты, состав активных аппаратов) — она чистая функция конфига
   * и потому верна всегда. `committed` — конфиг, которому соответствует
   * `result`: метрики, рёбра сети и маршруты. Пока они расходятся, сеть на
   * глобусе и цифры в панелях устарели, и об этом честно сообщается.
   *
   * «Изменение настроек в интерфейсе создаёт новый вариант проекта»
   * (Описание данных кейса) — поэтому правка не пересчитывает молча.
   */
  committed: Scenario | null
  committedRouting: RoutingMode | null
  pending: Record<string, PendingChange>
  stale: boolean
  /** результат предыдущего расчёта — для дельт «стало / было» */
  previousResult: SimulateResponse | null

  busy: boolean
  errors: FieldError[]
  warnings: FieldError[]
  notice: string | null
  usingMock: boolean

  routing: RoutingMode
  selectedClient: string | null
  selectedSat: string | null

  // ---- чтение ----
  stepAt(i: number): StepState | null
  routeAt(i: number, clientId?: string | null): string[] | null
  reasonAt(i: number, clientId?: string | null): OutageReason | null
  metricsOf(clientId: string): ClientMetrics | null

  // ---- действия ----
  loadBuiltin(id: string): Promise<void>
  loadFile(file: File): Promise<void>
  run(): Promise<void>
  setRouting(mode: RoutingMode): void
  setSelectedClient(id: string | null): void
  setSelectedSat(id: string | null): void
  setPlane(planeId: string, field: 'raan_deg' | 'phase_deg', value: number): void
  setEnv(field: 'isl_range_km' | 'min_elevation_deg', value: number): void
  /** откатить черновик к последнему посчитанному состоянию */
  revert(): void
  setLaunchStage(stage: number): void
  addFailure(satelliteId: string, startS: number, endS: number): void
  removeFailure(index: number): void
  addGatewayOutage(gatewayId: string, startS: number, endS: number): void
  removeGatewayOutage(index: number): void
  saveVariant(label?: string): void
  restoreVariant(id: string): void
  removeVariant(id: string): void
  renameVariant(id: string, label: string): void
  setVariantNote(id: string, note: string): void
  toggleCompare(id: string): void
  setCompareIds(ids: string[]): void
  setBaseVariant(id: string): void
  openCompare(ids?: string[]): void
  closeCompare(): void
}

/** Пересчёт производных полей. Вызывается всюду, где меняется scenario или result. */
function derive(scenario: Scenario | null, result: SimulateResponse | null): Derived {
  const sites = scenario?.ground_sites ?? []
  return {
    clients: sites.filter((g) => g.role === 'client'),
    gateways: sites.filter((g) => g.role === 'gateway'),
    nSteps: result?.meta.n_steps ?? 0,
    stepS: result?.meta.step_s ?? scenario?.environment.step_s ?? 120,
    horizonS: result?.meta.horizon_s ?? scenario?.environment.horizon_s ?? 86400,
  }
}

function loadVariants(): Variant[] {
  try {
    const raw = localStorage.getItem(VARIANTS_KEY)
    const list = raw ? (JSON.parse(raw) as Variant[]) : []
    // варианты, сохранённые до появления seq, донумеровываем по порядку:
    // цвет серии должен быть у каждого
    return list.map((v, i) => (v.seq ? v : { ...v, seq: i + 1 }))
  } catch {
    return []
  }
}

/** Следующий незанятый номер: номера не переиспользуются после удаления. */
function nextSeq(variants: Variant[]): number {
  return variants.reduce((m, v) => Math.max(m, v.seq ?? 0), 0) + 1
}

export const useProject = create<ProjectState>((set, get) => ({
  scenario: null,
  result: null,
  variants: loadVariants(),
  compareIds: [],
  baseVariantId: null,
  compareOpen: false,
  envBaseline: null,

  committed: null,
  committedRouting: null,
  pending: {},
  stale: false,
  previousResult: null,

  busy: false,
  errors: [],
  warnings: [],
  notice: null,
  usingMock: false,

  routing: 'min_hops',
  selectedClient: null,
  selectedSat: null,

  ...derive(null, null),

  // ---- чтение ----

  stepAt(i) {
    const steps = get().result?.steps
    if (!steps || i < 0 || i >= steps.length) return null
    return steps[i]
  },

  routeAt(i, clientId) {
    const s = get()
    const client = clientId === undefined ? s.selectedClient : clientId
    if (!client || !s.result) return null
    const arr = s.result.routes[client]
    if (!arr || i < 0 || i >= arr.length) return null
    const p = arr[i]
    return p && p.length ? p : null
  },

  reasonAt(i, clientId) {
    const s = get()
    const client = clientId === undefined ? s.selectedClient : clientId
    if (!client || !s.result) return null
    return s.result.reasons?.[client]?.[i] ?? null
  },

  metricsOf(clientId) {
    return get().result?.metrics[clientId] ?? null
  },

  // ---- действия ----

  async loadBuiltin(id) {
    set({ busy: true })
    try {
      const scenario = await api.getScenario(id)
      set({
        scenario,
        envBaseline: { ...scenario.environment },
        errors: [],
        warnings: [],
        notice: null,
        pending: {},
        stale: false,
        previousResult: null,
        ...derive(scenario, get().result),
      })
      await get().run()
    } catch (e) {
      set({ errors: [{ path: '$', code: 'request_failed', message: String(e) }] })
    } finally {
      set({ busy: false })
    }
  },

  async loadFile(file) {
    set({ busy: true, errors: [], warnings: [], notice: null })
    try {
      const report = await api.uploadScenario(file)
      set({ errors: report.errors, warnings: report.warnings })
      if (report.valid && report.scenario) {
        const scenario = report.scenario
        set({
          scenario,
          envBaseline: { ...scenario.environment },
          notice: `Загружен сценарий «${scenario.meta.title}»`,
          pending: {},
          stale: false,
          previousResult: null,
          ...derive(scenario, get().result),
        })
        await get().run()
      }
    } catch (e) {
      set({ errors: [{ path: '$', code: 'request_failed', message: String(e) }] })
    } finally {
      set({ busy: false })
    }
  },

  /** Запустить расчёт по текущему сценарию. */
  async run() {
    const { scenario, routing } = get()
    if (!scenario) return
    set({ busy: true })
    try {
      const r = await api.simulate(scenario, routing)
      if (isSimulateResponse(r)) {
        const d = derive(scenario, r)
        const selected = get().selectedClient
        set({
          result: r,
          previousResult: get().result,
          committed: structuredClone(scenario) as Scenario,
          committedRouting: routing,
          pending: {},
          stale: false,
          errors: [],
          usingMock: api.apiState.usingMock,
          selectedClient:
            selected && r.metrics[selected] ? selected : (d.clients[0]?.id ?? null),
          notice: get().notice,
          ...d,
        })
      } else {
        set({
          result: null,
          errors: r.errors,
          warnings: r.warnings,
          usingMock: api.apiState.usingMock,
          ...derive(scenario, null),
        })
      }
    } catch (e) {
      set({ errors: [{ path: '$', code: 'request_failed', message: String(e) }] })
    } finally {
      set({ busy: false })
    }
  },

  setRouting(mode) {
    const from = get().committedRouting ?? get().routing
    set({ routing: mode })
    note(set, get, 'routing', 'Стратегия', ROUTING_LABEL[from], ROUTING_LABEL[mode])
  },

  setSelectedClient(id) {
    set({ selectedClient: id })
  },

  setSelectedSat(id) {
    set({ selectedSat: id })
  },

  setPlane(planeId, field, value) {
    const before = get().scenario?.design.planes.find((x) => x.id === planeId)?.[field]
    patch(set, get, (d) => {
      const p = d.design.planes.find((x) => x.id === planeId)
      if (p) p[field] = ((value % 360) + 360) % 360
    })
    const after = get().scenario?.design.planes.find((x) => x.id === planeId)?.[field]
    note(
      set,
      get,
      `plane:${planeId}:${field}`,
      `${field === 'raan_deg' ? 'RAAN' : 'Фаза'} ${planeId}`,
      `${before?.toFixed(1)}°`,
      `${after?.toFixed(1)}°`,
    )
  },

  setEnv(field, value) {
    const unit = field === 'isl_range_km' ? ' км' : '°'
    const before = get().scenario?.environment[field]
    patch(set, get, (d) => {
      d.environment[field] = value
    })
    note(
      set,
      get,
      `env:${field}`,
      field === 'isl_range_km' ? 'Дальность ISL' : 'Порог возвышения',
      `${before}${unit}`,
      `${value}${unit}`,
    )
  },

  setLaunchStage(stage) {
    const before = get().scenario?.design.launch_stage
    patch(set, get, (d) => {
      d.design.launch_stage = stage
    })
    note(set, get, 'launch_stage', 'Очередь запуска', String(before), String(stage))
  },

  addFailure(satelliteId, startS, endS) {
    patch(set, get, (d) => {
      d.failures.push({ satellite_id: satelliteId, start_s: startS, end_s: endS })
    })
    note(set, get, uniqueKey('fail'), `Отказ ${satelliteId}`, undefined, hours(startS, endS))
  },

  removeFailure(index) {
    const f = get().scenario?.failures[index]
    patch(set, get, (d) => {
      d.failures.splice(index, 1)
    })
    if (f) note(set, get, uniqueKey('fail'), `Снят отказ ${f.satellite_id}`, undefined, hours(f.start_s, f.end_s))
  },

  addGatewayOutage(gatewayId, startS, endS) {
    patch(set, get, (d) => {
      d.gateway_outages.push({ gateway_id: gatewayId, start_s: startS, end_s: endS })
    })
    note(set, get, uniqueKey('gw'), `Отказ шлюза ${gatewayId}`, undefined, hours(startS, endS))
  },

  removeGatewayOutage(index) {
    const g = get().scenario?.gateway_outages[index]
    patch(set, get, (d) => {
      d.gateway_outages.splice(index, 1)
    })
    if (g) note(set, get, uniqueKey('gw'), `Снят отказ шлюза ${g.gateway_id}`, undefined, hours(g.start_s, g.end_s))
  },

  revert() {
    const { committed, committedRouting } = get()
    if (!committed) return
    const scenario = structuredClone(committed) as Scenario
    set({
      scenario,
      routing: committedRouting ?? get().routing,
      pending: {},
      stale: false,
      notice: null,
      ...derive(scenario, get().result),
    })
  },

  // ---- варианты ----

  saveVariant(label) {
    const { scenario, result, variants, stale, compareIds, baseVariantId } = get()
    if (!scenario || !result || stale) return
    const seq = nextSeq(variants)
    const v: Variant = {
      id: crypto.randomUUID(),
      label: label?.trim() || `Вариант ${seq}`,
      seq,
      scenario: structuredClone(scenario) as Scenario,
      result,
      createdAt: Date.now(),
    }
    const next = [...variants, v]
    set({
      variants: next,
      // новый вариант сразу попадает в сравнение: его затем и сохраняли
      compareIds: [...compareIds, v.id],
      baseVariantId: baseVariantId ?? v.id,
      notice: `«${v.label}» сохранён${next.length > 1 ? ' — можно сравнивать' : ''}`,
    })
    persist(next, set)
  },

  restoreVariant(id) {
    const v = get().variants.find((x) => x.id === id)
    if (!v) return
    const scenario = structuredClone(v.scenario) as Scenario
    set({
      scenario,
      routing: v.result.meta.routing ?? get().routing,
      committed: structuredClone(v.scenario) as Scenario,
      committedRouting: v.result.meta.routing ?? get().committedRouting,
      pending: {},
      stale: false,
      previousResult: null,
      result: v.result,
      notice: `Восстановлен вариант «${v.label}»`,
      ...derive(scenario, v.result),
    })
  },

  removeVariant(id) {
    const next = get().variants.filter((v) => v.id !== id)
    const compareIds = get().compareIds.filter((x) => x !== id)
    const base = get().baseVariantId
    set({
      variants: next,
      compareIds,
      baseVariantId: base === id ? (compareIds[0] ?? next[0]?.id ?? null) : base,
      compareOpen: compareIds.length >= 2 ? get().compareOpen : false,
    })
    persist(next, set)
  },

  renameVariant(id, label) {
    const clean = label.trim()
    if (!clean) return
    const next = get().variants.map((v) => (v.id === id ? { ...v, label: clean } : v))
    set({ variants: next })
    persist(next, set)
  },

  setVariantNote(id, note) {
    const next = get().variants.map((v) => (v.id === id ? { ...v, note: note.trim() } : v))
    set({ variants: next })
    persist(next, set)
  },

  toggleCompare(id) {
    const { compareIds, baseVariantId } = get()
    const on = compareIds.includes(id)
    const ids = on ? compareIds.filter((x) => x !== id) : [...compareIds, id]
    set({
      compareIds: ids,
      baseVariantId:
        baseVariantId && ids.includes(baseVariantId) ? baseVariantId : (ids[0] ?? null),
    })
  },

  setCompareIds(ids) {
    const { baseVariantId } = get()
    set({
      compareIds: ids,
      baseVariantId:
        baseVariantId && ids.includes(baseVariantId) ? baseVariantId : (ids[0] ?? null),
    })
  },

  setBaseVariant(id) {
    set({ baseVariantId: id })
  },

  openCompare(ids) {
    const { variants, compareIds, baseVariantId } = get()
    // по умолчанию сравниваем два последних: чаще всего это «до» и «после»
    const fallback = variants.slice(-2).map((v) => v.id)
    const use = ids ?? (compareIds.length >= 2 ? compareIds : fallback)
    set({
      compareIds: use,
      baseVariantId: baseVariantId && use.includes(baseVariantId) ? baseVariantId : (use[0] ?? null),
      compareOpen: use.length >= 1,
    })
  },

  closeCompare() {
    set({ compareOpen: false })
  },
}))

type Setter = (partial: Partial<ProjectState>) => void
type Getter = () => ProjectState

export const ROUTING_LABEL: Record<RoutingMode, string> = {
  min_hops: 'мин. переходов',
  min_distance: 'мин. дистанция',
}

let keySeq = 0
const uniqueKey = (prefix: string) => `${prefix}:${++keySeq}`
const hours = (a: number, b: number) => `${(a / 3600).toFixed(1)}–${(b / 3600).toFixed(1)} ч`

/**
 * Записать правку в список ожидающих пересчёта.
 * Повторные правки одного и того же поля схлопываются: у ползунка важны
 * исходное и конечное значения, а не каждый промежуточный кадр. Если
 * значение вернули обратно, запись исчезает и «изменено» гаснет.
 */
function note(set: Setter, get: Getter, key: string, what: string, from?: string, to?: string) {
  const pending = { ...get().pending }
  const existing = pending[key]
  const origin = existing ? existing.from : from
  if (origin !== undefined && origin === to) delete pending[key]
  else pending[key] = { key, what, from: origin, to }
  set({ pending, stale: Object.keys(pending).length > 0 })
}

/** Правка конфигурации: заменяем сценарий целиком (иммутабельно). */
function patch(set: Setter, get: Getter, fn: (draft: Scenario) => void) {
  const current = get().scenario
  if (!current) return
  const draft = structuredClone(current) as Scenario
  fn(draft)
  set({ scenario: draft, ...derive(draft, get().result) })
}

function persist(variants: Variant[], set: Setter) {
  try {
    localStorage.setItem(VARIANTS_KEY, JSON.stringify(variants))
  } catch {
    // квота localStorage ~5 МБ; варианты крупные, молча продолжаем в памяти
    set({ notice: 'Варианты не сохранены на диск (превышена квота браузера)' })
  }
}

/**
 * Короткая сводка конфигурации для карточки варианта.
 *
 * Раньше здесь перечислялись RAAN и фаза всех плоскостей — строка вида
 * «P1:0/0.0 P2:120/11.2 P3:240/22.5» читалась как дамп памяти и в карточку
 * не влезала. Отличия от базы показывает дифф (lib/compare), а сводка
 * отвечает на другой вопрос: что это за конфигурация вообще.
 */
export function describeScenario(s: Scenario): string {
  const active = s.design.satellites.filter((x) => x.launch_batch <= s.design.launch_stage).length
  const parts = [
    `очередь ${s.design.launch_stage}`,
    `${active} апп.`,
    `ISL ${s.environment.isl_range_km} км`,
    `порог ${s.environment.min_elevation_deg}°`,
  ]
  if (s.failures.length) parts.push(`отказов ${s.failures.length}`)
  return parts.join(' · ')
}
