/**
 * Полоса доступности: для каждого отсчёта — есть сквозной маршрут или нет.
 *
 * `availabilityRuns` сжимает 720 отсчётов в десятки непрерывных участков.
 * Дальше один и тот же результат используется двумя способами:
 *   - `availabilityGradient` — css-градиент для мест, где полоса декоративна
 *     (ползунок времени): один элемент вместо 720 узлов DOM;
 *   - компонент <AvailabilityStrip> рисует те же участки прямоугольниками
 *     SVG, потому что там нужны ховер, подсказка и клик по участку.
 */

import { LINK } from './viz'
import type { OutageReason } from '../types/api'

export interface Run {
  /** индекс первого отсчёта участка */
  from: number
  /** индекс за последним отсчётом участка */
  to: number
  ok: boolean
  /** причина перерыва, если участок — перерыв и причина известна */
  reason: OutageReason | null
}

export function availabilityRuns(
  routes: string[][] | undefined,
  reasons?: (OutageReason | null)[],
): Run[] {
  if (!routes || routes.length === 0) return []

  const runs: Run[] = []
  const okAt = (i: number) => routes[i].length > 0
  let from = 0

  for (let i = 1; i <= routes.length; i++) {
    const boundary = i === routes.length || okAt(i) !== okAt(from)
    if (!boundary) continue
    const ok = okAt(from)
    runs.push({
      from,
      to: i,
      ok,
      // причина одна на весь участок: внутри перерыва она не меняется
      reason: ok ? null : (reasons?.[from] ?? null),
    })
    from = i
  }
  return runs
}

export function availabilityGradient(routes: string[][] | undefined): string {
  const runs = availabilityRuns(routes)
  if (!runs.length) return 'transparent'
  const n = routes!.length
  const stops = runs.map((r) => {
    const a = ((r.from / n) * 100).toFixed(3)
    const b = ((r.to / n) * 100).toFixed(3)
    return `${r.ok ? LINK.ok : LINK.gap} ${a}% ${b}%`
  })
  return `linear-gradient(90deg, ${stops.join(',')})`
}
