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
import { variantLabelOf } from '../lib/resultExport'
import {
  isSimulateResponse,
  type ClientMetrics,
  type Environment,
  type GroundSite,
  type OutageReason,
  type RoutingMode,
  type Scenario,
  type ScenarioListItem,
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
  /**
   * 'value'  — поле поменяло значение (RAAN, порог, очередь);
   * 'add'    — в список добавлен период недоступности;
   * 'remove' — период удалён.
   *
   * Различие нужно, чтобы правки схлопывались: добавить отказ и тут же снять
   * его — это не две правки, а ни одной. Раньше каждое действие получало
   * уникальный ключ и оставалось в списке навсегда.
   */
  kind: 'value' | 'add' | 'remove'
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
  busy: boolean
  errors: FieldError[]
  warnings: FieldError[]
  notice: string | null
  usingMock: boolean

  routing: RoutingMode
  selectedClient: string | null
  selectedSat: string | null

  /** Набор кейса, как его отдаёт сервер. Пустой, пока список не загружен. */
  builtins: ScenarioListItem[]

  // ---- чтение ----
  stepAt(i: number): StepState | null
  routeAt(i: number, clientId?: string | null): string[] | null
  reasonAt(i: number, clientId?: string | null): OutageReason | null
  metricsOf(clientId: string): ClientMetrics | null

  // ---- действия ----
  loadBuiltins(): Promise<void>
  loadBuiltin(id: string): Promise<void>
  /** asVariant: загруженный файл сразу становится сохранённым вариантом */
  loadFile(file: File, options?: { asVariant?: boolean }): Promise<void>
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

/**
 * Идентификатор варианта.
 *
 * crypto.randomUUID() существует только в защищённом контексте — HTTPS или
 * localhost. На демо-стенде по обычному http его нет, и сохранение варианта
 * падало с «crypto.randomUUID is not a function». Уникальность нужна только
 * внутри одной вкладки, так что запасной вариант из времени и случайного
 * хвоста полностью достаточен.
 */
function variantId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Следующий незанятый номер: номера не переиспользуются после удаления. */
function nextSeq(variants: Variant[]): number {
  return variants.reduce((m, v) => Math.max(m, v.seq ?? 0), 0) + 1
}

export const useProject = create<ProjectState>((set, get) => ({
  scenario: null,
  builtins: [],
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

  /**
   * Список набора кейса приходит с сервера: он знает, какие файлы лежат
   * в case/Данные, и отдаёт по каждому метаданные. Новый файл появляется
   * в выборе сам, без правки кода.
   */
  async loadBuiltins() {
    try {
      set({ builtins: await api.listScenarios() })
    } catch {
      /* список необязателен: сценарий можно загрузить своим файлом */
    }
  },

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
        ...derive(scenario, get().result),
      })
      await get().run()
    } catch (e) {
      set({ errors: [{ path: '$', code: 'request_failed', message: String(e) }] })
    } finally {
      set({ busy: false })
    }
  },

  async loadFile(file, options) {
    set({ busy: true, errors: [], warnings: [], notice: null })
    try {
      const report = await api.uploadScenario(file)
      set({ errors: report.errors, warnings: report.warnings })
      if (report.valid && report.scenario) {
        const scenario = report.scenario
        const routing = report.routing ?? get().routing
        set({
          scenario,
          routing,
          envBaseline: { ...scenario.environment },
          // подпись ставим после расчёта: saveVariant сбрасывает notice
          notice: null,
          pending: {},
          stale: false,
          ...derive(scenario, get().result),
        })
        await get().run()

        const label = uniqueLabel(variantLabelOf(scenario) ?? scenario.meta.title, get().variants)
        const saved = Boolean(options?.asVariant) && Boolean(get().result) && !get().stale
        if (saved) get().saveVariant(label)

        set({
          notice: describeLoad(scenario, {
            fromResult: Boolean(report.fromResult),
            routing,
            label,
            saved,
          }),
        })
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
    addOutage(set, get, {
      id: satelliteId,
      startS,
      endS,
      what: `Отказ ${satelliteId}`,
      whatRemoved: `Снят отказ ${satelliteId}`,
      prefix: 'fail',
    })
  },

  removeFailure(index) {
    removeOutage(set, get, index)
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
      id: variantId(),
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
      // Счётчик на вкладке «Варианты» уже подтверждает сохранение; отдельный
      // глобальный баннер занимал место и дублировал эту обратную связь.
      notice: null,
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

/** Один и тот же файл могут загрузить дважды; одинаковые метки путают сравнение. */
function uniqueLabel(label: string, variants: Variant[]): string {
  const taken = new Set(variants.map((v) => v.label))
  if (!taken.has(label)) return label
  for (let n = 2; ; n++) {
    const candidate = `${label} (${n})`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Подпись о загрузке.
 *
 * Раньше здесь был только meta.title, а он приходит из файла кейса и не
 * меняется от правок параметров: любая выгрузка возвращалась под именем
 * «Полная группировка», и понять, свой ли вариант загрузился, было нельзя.
 * Поэтому называем сам файл (сценарий или результат эксперимента) и
 * перечисляем то, что отличает вариант: этап, стратегию, отказы.
 */
function describeLoad(
  scenario: Scenario,
  info: { fromResult: boolean; routing: RoutingMode; label: string; saved: boolean },
): string {
  const parts = [`этап ${scenario.design.launch_stage}`]
  if (info.fromResult) parts.push(`стратегия «${ROUTING_LABEL[info.routing]}»`)
  if (scenario.failures.length) parts.push(`отказов: ${scenario.failures.length}`)
  if (info.saved) parts.push('сохранён как вариант')

  const kind = info.fromResult ? 'результат эксперимента' : 'сценарий'
  return `Загружен ${kind} «${info.label}» · ${parts.join(' · ')}`
}

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
  else pending[key] = { key, what, from: origin, to, kind: 'value' }
  set({ pending, stale: Object.keys(pending).length > 0 })
}

// ---------- периоды недоступности ----------

/**
 * Ключ периода — это сам период, а не счётчик вызовов.
 *
 * Так добавление и снятие одного и того же интервала схлопываются в ноль
 * правок. С уникальным ключом на каждое действие список правок только
 * рос: «Отказ S19 0–24 ч», «Отказ S19 12–24 ч», «Снят отказ S19 0–24 ч» —
 * три записи там, где по факту остался один интервал.
 */
const outageKey = (prefix: string, id: string, startS: number, endS: number) =>
  `${prefix}:${id}:${startS}:${endS}`

/**
 * Отметить добавление или снятие периода. Противоположные действия по одному
 * ключу гасят друг друга: снять только что добавленный отказ — это не правка.
 */
function noteOutage(
  pending: Record<string, PendingChange>,
  key: string,
  what: string,
  detail: string,
  kind: 'add' | 'remove',
) {
  const existing = pending[key]
  if (existing && existing.kind !== kind && existing.kind !== 'value') delete pending[key]
  else pending[key] = { key, what, to: detail, kind }
}

interface OutageSpec {
  id: string
  startS: number
  endS: number
  what: string
  whatRemoved: string
  prefix: string
}

/**
 * Добавить период недоступности, объединяя его с уже заданными.
 *
 * «Пересекающиеся интервалы объединяются по смыслу недоступности» — прямая
 * цитата из описания данных кейса. Поэтому два периода одного аппарата,
 * которые перекрываются или соприкасаются, здесь сливаются в один, а не
 * копятся списком: аппарат не может быть «дважды недоступен».
 */
function addOutage(set: Setter, get: Getter, spec: OutageSpec) {
  const scenario = get().scenario
  if (!scenario) return

  const horizon = scenario.environment.horizon_s
  const from = Math.max(0, Math.min(spec.startS, spec.endS))
  const to = Math.min(horizon, Math.max(spec.startS, spec.endS))
  if (to <= from) {
    set({ notice: 'Период недоступности должен начинаться раньше, чем заканчивается' })
    return
  }

  // соприкасающиеся тоже сливаем: 0–6 ч и 6–24 ч — это один период 0–24 ч
  const touching = scenario.failures.filter(
    (o) => o.satellite_id === spec.id && o.start_s <= to && o.end_s >= from,
  )

  const mergedStart = Math.min(from, ...touching.map((o) => o.start_s))
  const mergedEnd = Math.max(to, ...touching.map((o) => o.end_s))

  if (touching.length === 1 && touching[0].start_s === mergedStart && touching[0].end_s === mergedEnd) {
    set({
      notice: `${spec.id}: период ${hours(from, to)} уже входит в заданный ${hours(mergedStart, mergedEnd)}`,
    })
    return
  }

  patch(set, get, (d) => {
    d.failures = d.failures.filter(
      (o) => !(o.satellite_id === spec.id && o.start_s <= to && o.end_s >= from),
    )
    d.failures.push({ satellite_id: spec.id, start_s: mergedStart, end_s: mergedEnd })
  })

  const pending = { ...get().pending }
  // поглощённые интервалы исчезают из списка правок, если их добавили здесь же
  for (const o of touching) {
    noteOutage(
      pending,
      outageKey(spec.prefix, spec.id, o.start_s, o.end_s),
      spec.whatRemoved,
      hours(o.start_s, o.end_s),
      'remove',
    )
  }
  noteOutage(
    pending,
    outageKey(spec.prefix, spec.id, mergedStart, mergedEnd),
    spec.what,
    hours(mergedStart, mergedEnd),
    'add',
  )
  set({
    pending,
    stale: Object.keys(pending).length > 0,
    notice: touching.length
      ? `${spec.id}: периоды объединены в ${hours(mergedStart, mergedEnd)}`
      : null,
  })
}

function removeOutage(set: Setter, get: Getter, index: number) {
  const item = get().scenario?.failures[index]
  if (!item) return

  patch(set, get, (d) => {
    d.failures.splice(index, 1)
  })

  const pending = { ...get().pending }
  noteOutage(
    pending,
    outageKey('fail', item.satellite_id, item.start_s, item.end_s),
    `Снят отказ ${item.satellite_id}`,
    hours(item.start_s, item.end_s),
    'remove',
  )
  set({ pending, stale: Object.keys(pending).length > 0, notice: null })
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
