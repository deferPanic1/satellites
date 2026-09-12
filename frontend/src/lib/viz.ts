/**
 * Токены визуализации.
 *
 * Палитры не подобраны на глаз: категориальная шкала вариантов и бинарная
 * шкала «связь / перерыв» прогнаны через валидатор цветовых схем
 * (проверки полосы светлоты, минимума насыщенности, различимости при
 * дальтонизме и контраста к фону панели #0b1220).
 *
 *   VARIANT_COLORS  — 6 слотов, соседние пары: CVD ΔE 8.4, нормальное зрение 19.3
 *   LINK.ok / .gap  — ΔE 17.9 (протанопия), 29.0 (нормальное зрение)
 *
 * Прежняя пара #22c55e / #ef4444 давала ΔE 4.1 при дейтеранопии: самый
 * частый тип дальтонизма (~6% мужчин) не отличал связь от перерыва.
 * Поэтому «связь» теперь синяя, а не зелёная — красный остаётся тревожным
 * цветом, и различие держится на светлоте, а не на оттенке.
 */

/** Цвет варианта закреплён за его порядковым номером, а не за позицией
 *  в списке: удаление соседа не перекрашивает остальные. */
export const VARIANT_COLORS = [
  '#3987e5', // синий
  '#d95926', // оранжевый
  '#199e70', // бирюзовый
  '#c98500', // жёлтый
  '#d55181', // маджента
  '#9085e9', // фиолетовый
] as const

export function variantColor(seq: number): string {
  return VARIANT_COLORS[(seq - 1) % VARIANT_COLORS.length]
}

/** Состояние канала в отсчёте. Статусная шкала, не категориальная. */
export const LINK = {
  ok: '#2a6fb0',
  gap: '#d03b3b',
} as const

/** Хром графиков берём из палитры приложения, чтобы панели и графики
 *  читались как одна система. */
export const INK = {
  primary: '#e2e8f0',
  secondary: '#94a3b8',
  muted: '#64748b',
  grid: 'rgba(148, 163, 184, 0.16)',
  axis: 'rgba(148, 163, 184, 0.3)',
  accent: '#38bdf8',
} as const

// ---------- форматирование ----------

/** Длительность перерыва: минуты до часа, дальше часы. */
export function fmtDur(sec: number): string {
  if (sec <= 0) return '0'
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    return m ? `${h} ч ${m} мин` : `${h} ч`
  }
  return `${Math.round(sec / 60)} мин`
}

/** Компактная длительность для осей и плиток. */
export function fmtDurShort(sec: number): string {
  if (sec <= 0) return '—'
  return sec >= 3600 ? `${(sec / 3600).toFixed(1)} ч` : `${Math.round(sec / 60)} мин`
}

export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function fmtPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`
}

/** Русские склонения при числительном: 1 перерыв, 2 перерыва, 5 перерывов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = Math.abs(n) % 10
  const m100 = Math.abs(n) % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

// ---------- причины отсутствия маршрута ----------

/** Порядок фиксированный: от конкретной причины к общей, как в классификаторе. */
export const REASONS = ['no_sat', 'isl_break', 'no_gw', 'gw_down'] as const

export const REASON_LABEL: Record<string, string> = {
  no_sat: 'Нет видимого спутника',
  isl_break: 'Разрыв межспутниковой сети',
  no_gw: 'Шлюз не видит аппаратов',
  gw_down: 'Шлюз недоступен',
}

/** Короткая подпись для осей и чипов, где полная не влезает. */
export const REASON_SHORT: Record<string, string> = {
  no_sat: 'нет спутника',
  isl_break: 'разрыв ISL',
  no_gw: 'шлюз без связи',
  gw_down: 'шлюз выключен',
}
