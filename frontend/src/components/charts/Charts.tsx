/**
 * Мелкие графики проекта. Инлайновая вёрстка вместо библиотеки: нужны
 * четыре формы, все они — полосы, а тянуть в сборку charting-пакет ради
 * них дороже, чем описать их здесь.
 *
 * Правила, которые здесь соблюдаются осознанно:
 *  - одна шкала на график, никаких двух осей;
 *  - цвет закреплён за сущностью (вариантом), а не за её местом в рейтинге;
 *  - при двух и более сериях легенда есть всегда, плюс подписи значений
 *    прямо у полос — различие никогда не держится на одном цвете;
 *  - ось доступности не обрезается: разница в 0.5 п.п. читается по числу и
 *    по графику дельт, а не за счёт растянутого масштаба.
 */

import { useState, type ReactNode } from 'react'
import { INK, fmtClock, fmtDur, REASON_SHORT } from '../../lib/viz'
import { availabilityRuns, type Run } from '../../lib/strip'
import type { OutageReason } from '../../types/api'
import s from './Charts.module.css'

// ---------- полоса доступности ----------

interface StripProps {
  routes: string[][] | undefined
  reasons?: (OutageReason | null)[]
  stepS: number
  height?: number
  /** текущий отсчёт воспроизведения — рисуется вертикальной риской */
  cursorStep?: number | null
  /** клик по участку переводит шкалу времени */
  onSeek?: (tS: number) => void
  /** подписи часов под полосой */
  axis?: boolean
}

export function AvailabilityStrip({
  routes,
  reasons,
  stepS,
  height = 16,
  cursorStep = null,
  onSeek,
  axis = false,
}: StripProps) {
  const [hover, setHover] = useState<Run | null>(null)
  const runs = availabilityRuns(routes, reasons)
  const n = routes?.length ?? 0

  if (!n) return <div className={s.stripEmpty} style={{ height }} />

  return (
    <div className={s.stripWrap}>
      <div
        className={s.strip}
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="полоса доступности связи за сутки"
      >
        {runs.map((r) => (
          <span
            key={r.from}
            className={r.ok ? s.segOk : s.segGap}
            style={{ flexGrow: r.to - r.from }}
            onMouseEnter={() => setHover(r)}
            onClick={onSeek ? () => onSeek(r.from * stepS) : undefined}
            data-clickable={onSeek ? '' : undefined}
          />
        ))}
        {cursorStep !== null && cursorStep >= 0 && (
          <span className={s.cursor} style={{ left: `${((cursorStep + 0.5) / n) * 100}%` }} />
        )}
      </div>

      {axis && (
        <div className={s.stripAxis}>
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      )}

      {hover && (
        <div className={s.stripTip}>
          <b>{hover.ok ? 'связь есть' : 'перерыв'}</b>
          <span className={s.mono}>
            {fmtClock(hover.from * stepS)}–{fmtClock(hover.to * stepS)}
          </span>
          <span>{fmtDur((hover.to - hover.from) * stepS)}</span>
          {!hover.ok && hover.reason && <em>{REASON_SHORT[hover.reason]}</em>}
        </div>
      )}
    </div>
  )
}

// ---------- полосчатая диаграмма ----------

export interface Bar {
  key: string
  label: string
  value: number
  color: string
  /** готовая подпись значения; по умолчанию — format(value) */
  text?: string
  /** лучший в группе — получает метку, а не другой цвет */
  best?: boolean
}

export interface BarGroup {
  key: string
  label: string
  note?: string
  bars: Bar[]
}

interface BarRowsProps {
  groups: BarGroup[]
  max: number
  format: (v: number) => string
  /** ориентир (порог доступности) — пунктир поперёк полос */
  target?: number | null
  targetLabel?: string
  /** подпись серии слева от полосы: нужна, когда групп несколько */
  showSeriesLabel?: boolean
}

export function BarRows({
  groups,
  max,
  format,
  target = null,
  targetLabel,
  showSeriesLabel = false,
}: BarRowsProps) {
  const safeMax = max > 0 ? max : 1
  return (
    <div className={s.chart}>
      {groups.map((g) => (
        <div key={g.key} className={s.group}>
          <div className={s.groupHead}>
            <span className={s.groupLabel}>{g.label}</span>
            {g.note && <span className={s.groupNote}>{g.note}</span>}
          </div>
          <div className={s.bars}>
            {g.bars.map((b) => (
              <div key={b.key} className={s.barRow}>
                {showSeriesLabel && (
                  <span className={s.seriesLabel} title={b.label}>
                    <i className={s.swatch} style={{ background: b.color }} />
                    {b.label}
                  </span>
                )}
                <span className={s.track}>
                  <span
                    className={s.fill}
                    style={{
                      width: `${Math.max(0, Math.min(100, (b.value / safeMax) * 100))}%`,
                      background: b.color,
                      // ноль рисуется пустотой, а не двухпиксельным огрызком
                      minWidth: b.value > 0 ? 2 : 0,
                    }}
                  />
                  {target !== null && target > 0 && target <= safeMax && (
                    <span
                      className={s.targetTick}
                      style={{ left: `${(target / safeMax) * 100}%` }}
                      title={targetLabel}
                    />
                  )}
                </span>
                <span className={s.value}>
                  {b.text ?? format(b.value)}
                  {b.best && <i className={s.bestMark} title="лучший в группе" />}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {target !== null && targetLabel && (
        <p className={s.axisNote}>
          <i className={s.targetSample} /> {targetLabel}
        </p>
      )}
    </div>
  )
}

// ---------- дельты относительно базы ----------

interface DeltaRowsProps {
  groups: BarGroup[]
  /** симметричный масштаб: max |значения| */
  max: number
  format: (v: number) => string
  /** меньше — лучше (перерывы): тогда положительная дельта плохая */
  lowerIsBetter?: boolean
}

export function DeltaRows({ groups, max, format, lowerIsBetter = false }: DeltaRowsProps) {
  const safeMax = max > 0 ? max : 1
  return (
    <div className={s.chart}>
      {groups.map((g) => (
        <div key={g.key} className={s.group}>
          <div className={s.groupHead}>
            <span className={s.groupLabel}>{g.label}</span>
            {g.note && <span className={s.groupNote}>{g.note}</span>}
          </div>
          <div className={s.bars}>
            {g.bars.map((b) => {
              const w = (Math.abs(b.value) / safeMax) * 50
              const good = lowerIsBetter ? b.value < 0 : b.value > 0
              return (
                <div key={b.key} className={s.barRow}>
                  <span className={s.seriesLabel} title={b.label}>
                    <i className={s.swatch} style={{ background: b.color }} />
                    {b.label}
                  </span>
                  <span className={s.trackDelta}>
                    <span className={s.zero} />
                    <span
                      className={s.fillDelta}
                      style={{
                        width: `${w}%`,
                        background: b.color,
                        left: b.value >= 0 ? '50%' : `${50 - w}%`,
                        minWidth: b.value === 0 ? 0 : 2,
                      }}
                    />
                  </span>
                  <span className={s.value} data-good={b.value === 0 ? undefined : good}>
                    {b.text ?? format(b.value)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- легенда ----------

export function Legend({
  items,
}: {
  items: { key: string; label: string; color: string; note?: string }[]
}) {
  return (
    <ul className={s.legend}>
      {items.map((i) => (
        <li key={i.key}>
          <i className={s.swatch} style={{ background: i.color }} />
          <span>{i.label}</span>
          {i.note && <small>{i.note}</small>}
        </li>
      ))}
    </ul>
  )
}

// ---------- плитка с показателем ----------

export function Tile({
  label,
  value,
  unit,
  note,
  alarm,
  meter,
  children,
}: {
  label: string
  value: ReactNode
  /** единица измерения набирается отдельно от числа */
  unit?: string
  note?: ReactNode
  alarm?: boolean
  /** заполнение 0..1 и отметка порога 0..1 */
  meter?: { fill: number; mark?: number | null }
  children?: ReactNode
}) {
  return (
    <div className={s.tile} data-alarm={alarm || undefined}>
      <span className={s.tileKey}>{label}</span>
      <span className={s.tileValue}>
        {value}
        {unit && <span className={s.unit}>{unit}</span>}
      </span>
      {meter && (
        <span className={s.meter}>
          <span
            className={s.meterFill}
            style={{
              width: `${Math.max(0, Math.min(100, meter.fill * 100))}%`,
              background: alarm ? INK.accent : undefined,
            }}
            data-alarm={alarm || undefined}
          />
          {meter.mark != null && (
            <span className={s.meterMark} style={{ left: `${meter.mark * 100}%` }} />
          )}
        </span>
      )}
      {note && <span className={s.tileNote}>{note}</span>}
      {children}
    </div>
  )
}
