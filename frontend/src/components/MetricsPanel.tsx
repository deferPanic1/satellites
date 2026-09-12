/**
 * Панель показателей: только обзор.
 *
 * Раньше эта панель в 24rem держала четыре разные задачи — вердикт, разбор
 * по пунктам, список вариантов и таблицу сравнения. Таблица в такую ширину
 * не влезала физически (в CSS стояли nowrap и обрезка подписей), а открытая
 * раскрывашка пункта выталкивала сравнение за пределы экрана.
 *
 * Теперь здесь карточки: по одной на наземный пункт, с полосой доступности,
 * ховером и сворачиваемыми подробностями. Варианты живут на своей вкладке,
 * а тяжёлое сравнение — в модальном окне на всю ширину.
 */

import { useMemo, useState } from 'react'
import { Badge } from '@mantine/core'
import { IconChevronRight } from '@tabler/icons-react'
import { useProject } from '../stores/project'
import { selectStepIndex, usePlayback } from '../stores/playback'
import { AvailabilityStrip, Tile } from './charts/Charts'
import { fmtDurShort, fmtKm, fmtPct, REASON_SHORT, STATUS } from '../lib/viz'
import type { Gap, OutageReason } from '../types/api'
import s from './MetricsPanel.module.css'

interface Row {
  client: string
  visibility: number
  availability: number
  maxGap: number
  totalOutage: number
  gaps: Gap[]
  avgHops: number
  maxHops: number | null
  avgKm: number | null
  /** изменение доступности относительно предыдущего расчёта */
  delta: number | null
  /** ниже порога, заданного в сценарии; null — порог не задан */
  below: boolean | null
  routes: string[][]
  reasons: (OutageReason | null)[]
  /** сколько времени без связи дала каждая причина */
  byReason: { reason: string; sec: number }[]
}

export function MetricsPanel() {
  const result = useProject((x) => x.result)
  const previousResult = useProject((x) => x.previousResult)
  const stale = useProject((x) => x.stale)
  const selectedClient = useProject((x) => x.selectedClient)
  const setSelectedClient = useProject((x) => x.setSelectedClient)
  const stepS = useProject((x) => x.stepS)
  const seek = usePlayback((x) => x.seek)
  const stepIndex = usePlayback(selectStepIndex)

  const [openClient, setOpenClient] = useState<string | null>(null)

  /**
   * Порог доступности задаёт пользователь в сценарии. Если его нет,
   * интерфейс просто не делит пункты на «в пороге» и «ниже».
   */
  const targetPct = useMemo(() => {
    const t = result?.meta.target_availability
    return t && t > 0 ? t * 100 : null
  }, [result])

  const rows = useMemo<Row[]>(() => {
    if (!result) return []
    return Object.entries(result.metrics).map(([client, m]) => {
      const before = previousResult?.metrics[client]?.availability_pct
      const acc: Record<string, number> = {}
      for (const g of m.gaps ?? []) {
        const key = g.reason ?? 'isl_break'
        acc[key] = (acc[key] ?? 0) + g.duration_s
      }
      return {
        client,
        visibility: m.visibility_pct,
        availability: m.availability_pct,
        maxGap: m.max_gap_s,
        totalOutage: m.total_outage_s,
        gaps: m.gaps ?? [],
        avgHops: m.hops?.avg ?? 0,
        maxHops: m.hops?.max ?? null,
        avgKm: m.avg_path_km,
        delta: before === undefined ? null : m.availability_pct - before,
        below: targetPct === null ? null : m.availability_pct < targetPct,
        routes: result.routes[client] ?? [],
        reasons: result.reasons?.[client] ?? [],
        byReason: Object.entries(acc)
          .map(([reason, sec]) => ({ reason, sec }))
          .sort((a, b) => b.sec - a.sec),
      }
    })
  }, [result, previousResult, targetPct])

  /** Вердикт: худший пункт, сколько пунктов в пороге, самый долгий перерыв. */
  const verdict = useMemo(() => {
    if (!rows.length) return null
    const worst = rows.reduce((a, b) => (b.availability < a.availability ? b : a))
    const longest = rows.reduce((a, b) => (b.maxGap > a.maxGap ? b : a))
    const inTarget = targetPct === null ? null : rows.filter((r) => !r.below).length
    return { worst, longest, inTarget, total: rows.length }
  }, [rows, targetPct])

  if (!verdict) {
    return <p className={`${s.hint} ${s.pad}`}>Расчёт ещё не выполнен.</p>
  }

  function pickClient(client: string) {
    setSelectedClient(client)
    setOpenClient((prev) => (prev === client ? null : client))
  }

  return (
    <div className={s.panel} data-stale={stale || undefined}>
      {stale && (
        <div className={s.staleBanner}>
          Показатели относятся к прежней конфигурации — пересчитайте, чтобы обновить.
        </div>
      )}

      <section>
        <div className={s.tiles}>
          <Tile
            label="Худший пункт"
            value={verdict.worst.availability.toFixed(2)}
            unit="%"
            alarm={verdict.worst.below || undefined}
            meter={{
              fill: verdict.worst.availability / 100,
              mark: targetPct === null ? null : targetPct / 100,
            }}
            note={
              <>
                {verdict.worst.client}
                {verdict.worst.below ? ' · ниже порога' : targetPct !== null ? ' · в пороге' : ''}
              </>
            }
          />
          {verdict.inTarget !== null && (
            <Tile
              label="В пороге"
              value={`${verdict.inTarget}/${verdict.total}`}
              alarm={verdict.inTarget < verdict.total}
              note={`порог ${targetPct?.toFixed(0)} % времени`}
            />
          )}
          <Tile
            label="Макс. перерыв"
            value={fmtDurShort(verdict.longest.maxGap)}
            note={
              <>
                {verdict.longest.client} · {fmtDurShort(verdict.longest.totalOutage)} без связи
                всего
              </>
            }
          />
        </div>
      </section>

      <section>
        <div className={s.head}>
          <h3>Наземные пункты</h3>
          <span className={s.legend}>
            <i className={s.dotOk} /> связь
            <i className={s.dotBad} /> перерыв
          </span>
        </div>

        <div className={s.cards}>
          {rows.map((r) => {
            const open = r.client === openClient
            return (
              <article
                key={r.client}
                className={s.card}
                data-selected={r.client === selectedClient || undefined}
                data-open={open || undefined}
              >
                <button
                  type="button"
                  className={s.cardHead}
                  aria-expanded={open}
                  onClick={() => pickClient(r.client)}
                >
                  <span className={s.mono}>{r.client}</span>
                  {r.below === false && (
                    <Badge size="xs" variant="light" color="green">
                      порог
                    </Badge>
                  )}
                  {r.below === true && (
                    <Badge size="xs" variant="light" color="red">
                      ниже порога
                    </Badge>
                  )}
                  <span className={s.score}>
                    <b data-below={r.below || undefined}>{fmtPct(r.availability)}</b>
                    {r.delta !== null && Math.abs(r.delta) >= 0.005 && (
                      <span className={r.delta >= 0 ? s.deltaUp : s.deltaDown}>
                        {r.delta > 0 ? '+' : '−'}
                        {Math.abs(r.delta).toFixed(2)}
                      </span>
                    )}
                  </span>
                  <IconChevronRight size={13} className={s.chev} />
                </button>

                <div className={s.cardStrip}>
                  <AvailabilityStrip
                    routes={r.routes}
                    reasons={r.reasons}
                    stepS={stepS}
                    height={14}
                    axis
                    cursorStep={stepIndex}
                    onSeek={seek}
                  />
                </div>

                <p className={s.cardSummary}>
                  видимость {r.visibility.toFixed(1)} % · перерывов {r.gaps.length} · макс{' '}
                  {fmtDurShort(r.maxGap)} · {r.avgHops.toFixed(2)} перехода
                </p>

                {open && (
                  <div className={s.detail}>
                    <dl className={s.facts}>
                      <dt>видимость спутника</dt>
                      <dd>{r.visibility.toFixed(2)} %</dd>
                      <dt>сквозной маршрут</dt>
                      <dd>{r.availability.toFixed(2)} %</dd>
                      <dt>без связи всего</dt>
                      <dd>{fmtDurShort(r.totalOutage)}</dd>
                      <dt>переходов (сред./макс.)</dt>
                      <dd>
                        {r.avgHops.toFixed(2)} / {r.maxHops ?? '—'}
                      </dd>
                      <dt>длина маршрута</dt>
                      <dd>{fmtKm(r.avgKm)}</dd>
                    </dl>

                    {r.byReason.length > 0 && (
                      <>
                        <h4>Причины перерывов</h4>
                        <ul className={s.reasons}>
                          {r.byReason.map((x) => (
                            <li key={x.reason}>
                              <span>{REASON_SHORT[x.reason] ?? x.reason}</span>
                              <i
                                className={s.reasonBar}
                                style={{
                                  width: `${(x.sec / Math.max(1, r.totalOutage)) * 100}%`,
                                  background: STATUS.critical,
                                }}
                              />
                              <b>{fmtDurShort(x.sec)}</b>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {r.gaps.length > 0 && (
                      <>
                        <h4>Перерывы · клик переводит шкалу</h4>
                        <div className={s.gaps}>
                          {r.gaps.map((g, i) => (
                            <button
                              key={i}
                              type="button"
                              className={s.gap}
                              onClick={() => seek(g.start_s)}
                            >
                              <span className={s.mono}>{(g.start_s / 3600).toFixed(2)} ч</span>
                              <span className={s.dur}>{fmtDurShort(g.duration_s)}</span>
                              <span className={s.reason}>
                                {g.reason ? REASON_SHORT[g.reason] : ''}
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <p className={s.hint}>
        Видимость — доля отсчётов, где виден хотя бы один активный аппарат. Связь — доля отсчётов,
        где существует сквозной маршрут до шлюза. Разница между ними и есть суть задачи.
        {previousResult && !stale && ' Мелким шрифтом у процента — изменение к предыдущему расчёту.'}
      </p>
    </div>
  )
}
