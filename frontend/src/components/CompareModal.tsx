/**
 * Окно сравнения вариантов.
 *
 * Кейс требует сопоставлять варианты «по доступности связи, продолжительности
 * перерывов и характеристикам маршрутов», а в самом сравнении показывать
 * «изменённые параметры, итоговые показатели и различия между результатами».
 * Пять вкладок отвечают ровно на эти вопросы, и каждая отвечает на один:
 *
 *   Обзор      — какой вариант брать и почему (вердикт + сводная таблица)
 *   По пунктам — где именно перерыв: полосы всех вариантов на одной сетке суток
 *   Перерывы   — из-за чего связь пропадает (разбор по причинам и длительностям)
 *   Маршруты   — чем платим за доступность (переходы, километры)
 *   Параметры  — чем варианты отличаются в конфигурации
 *
 * Окно на всю ширину — сознательно: в панели 24rem такое сравнение не
 * помещается, и попытка его туда втиснуть и была главной проблемой интерфейса.
 */

import { useMemo, useState } from 'react'
import { Badge, Button, Modal, SegmentedControl, Switch, Tabs, Tooltip } from '@mantine/core'
import { IconBulb, IconDownload, IconFileTypeCsv } from '@tabler/icons-react'
import { useProject } from '../stores/project'
import {
  buildComparison,
  comparisonCsv,
  comparisonJson,
  download,
  type Comparison,
  type VariantView,
} from '../lib/compare'
import { AvailabilityStrip, BarRows, DeltaRows, Legend, type BarGroup } from './charts/Charts'
import {
  bucketLabels,
  fmtDur,
  fmtDurShort,
  fmtKm,
  hopsWord,
  plural,
  REASONS,
  REASON_LABEL,
} from '../lib/viz'
import s from './CompareModal.module.css'

export function CompareModal() {
  const open = useProject((x) => x.compareOpen)
  const close = useProject((x) => x.closeCompare)
  const variants = useProject((x) => x.variants)
  const compareIds = useProject((x) => x.compareIds)
  const baseVariantId = useProject((x) => x.baseVariantId)
  const setBaseVariant = useProject((x) => x.setBaseVariant)
  const [tab, setTab] = useState<string | null>('overview')

  const cmp = useMemo(() => {
    const picked = variants.filter((v) => compareIds.includes(v.id))
    return buildComparison(picked, baseVariantId)
  }, [variants, compareIds, baseVariantId])

  return (
    <Modal
      opened={open}
      onClose={close}
      fullScreen
      withCloseButton
      title={
        <span className={s.modalTitle}>
          Сравнение вариантов
          {cmp && (
            <small>
              {cmp.variants.length}{' '}
              {plural(cmp.variants.length, 'конфигурация', 'конфигурации', 'конфигураций')} на
              одной сетке времени
            </small>
          )}
        </span>
      }
      classNames={{ body: s.modalBody, header: s.modalHeader }}
      transitionProps={{ duration: 120 }}
    >
      {!cmp ? (
        <p className={s.hint}>Нечего сравнивать: отметьте варианты на вкладке «Варианты».</p>
      ) : (
        <div className={s.wrap}>
          <header className={s.bar}>
            <div className={s.chips}>
              {cmp.variants.map((v) => (
                <Tooltip
                  key={v.id}
                  label={v.id === cmp.base.id ? 'это база сравнения' : 'сделать базой'}
                  withArrow
                  openDelay={400}
                >
                  <button
                    type="button"
                    className={s.chip}
                    data-base={v.id === cmp.base.id || undefined}
                    onClick={() => setBaseVariant(v.id)}
                  >
                    <i style={{ background: v.color }} />
                    {v.label}
                    {v.id === cmp.base.id && <small>база</small>}
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className={s.exports}>
              <Button
                variant="subtle"
                color="gray"
                leftSection={<IconFileTypeCsv size={14} />}
                onClick={() => download('comparison.csv', comparisonCsv(cmp), 'text/csv')}
              >
                CSV
              </Button>
              <Button
                variant="subtle"
                color="gray"
                leftSection={<IconDownload size={14} />}
                onClick={() =>
                  download('comparison.json', comparisonJson(cmp), 'application/json')
                }
              >
                JSON
              </Button>
            </div>
          </header>

          <Tabs value={tab} onChange={setTab} classNames={{ root: s.tabs, panel: s.panel }}>
            <Tabs.List>
              <Tabs.Tab value="overview">Обзор</Tabs.Tab>
              <Tabs.Tab value="sites">По пунктам</Tabs.Tab>
              <Tabs.Tab value="outages">Перерывы</Tabs.Tab>
              <Tabs.Tab value="routes">Маршруты</Tabs.Tab>
              <Tabs.Tab value="params">Параметры</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="overview">
              <Overview cmp={cmp} />
            </Tabs.Panel>
            <Tabs.Panel value="sites">
              <Sites cmp={cmp} />
            </Tabs.Panel>
            <Tabs.Panel value="outages">
              <Outages cmp={cmp} />
            </Tabs.Panel>
            <Tabs.Panel value="routes">
              <Routes cmp={cmp} />
            </Tabs.Panel>
            <Tabs.Panel value="params">
              <Params cmp={cmp} />
            </Tabs.Panel>
          </Tabs>
        </div>
      )}
    </Modal>
  )
}

// ---------- вспомогательное ----------

function legendItems(cmp: Comparison) {
  return cmp.variants.map((v) => ({
    key: v.id,
    label: v.label,
    color: v.color,
    note: v.id === cmp.base.id ? 'база' : undefined,
  }))
}

/** Полосы одной группы: по одной на вариант. */
function bars(
  cmp: Comparison,
  value: (v: VariantView) => number,
  text?: (v: VariantView) => string,
  bestId?: string,
) {
  return cmp.variants.map((v) => ({
    key: v.id,
    label: v.label,
    value: value(v),
    color: v.color,
    text: text?.(v),
    best: bestId === v.id,
  }))
}

// ---------- вкладка «Обзор» ----------

function Overview({ cmp }: { cmp: Comparison }) {
  const [mode, setMode] = useState('abs')

  const availGroups: BarGroup[] = cmp.clients.map((c) => ({
    key: c,
    label: c,
    note: cmp.targetPct === null ? undefined : `порог ${cmp.targetPct.toFixed(0)} %`,
    bars: bars(
      cmp,
      (v) => v.byClient[c]?.availability ?? 0,
      (v) => `${(v.byClient[c]?.availability ?? 0).toFixed(2)} %`,
      cmp.bestByClient[c],
    ),
  }))

  const deltaGroups: BarGroup[] = cmp.clients.map((c) => ({
    key: c,
    label: c,
    note: `база ${(cmp.base.byClient[c]?.availability ?? 0).toFixed(2)} %`,
    bars: cmp.variants
      .filter((v) => v.id !== cmp.base.id)
      .map((v) => {
        const d = (v.byClient[c]?.availability ?? 0) - (cmp.base.byClient[c]?.availability ?? 0)
        return {
          key: v.id,
          label: v.label,
          value: d,
          color: v.color,
          text: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(2)} п.п.`,
        }
      }),
  }))

  const deltaMax = Math.max(
    0.5,
    ...deltaGroups.flatMap((g) => g.bars.map((b) => Math.abs(b.value))),
  )

  /** Кто выигрывает по каждому пункту отдельно — база для рекомендаций. */
  const perClient = cmp.clients
    .map((c) => {
      const w = cmp.variants.find((v) => v.id === cmp.bestByClient[c])
      return w ? `${c} — «${w.label}»` : null
    })
    .filter(Boolean)
    .join(', ')

  return (
    <div className={s.stack}>
      <section className={s.verdict}>
        <h3>
          <IconBulb size={15} /> Вывод
        </h3>
        {cmp.verdict.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
        {cmp.variants.length > 1 && cmp.clients.length > 1 && (
          <p className={s.verdictSub}>Лучший вариант по каждому пункту: {perClient}.</p>
        )}
      </section>

      <div className={s.colsWide}>
        <div className={s.col}>
          <section>
            <h3>Итоговые показатели</h3>
            <Scoreboard cmp={cmp} />
            <p className={s.hint}>
              Точкой отмечено лучшее значение в столбце. «Худший пункт» — главный критерий:
              конфигурация годится, если её самый слабый наземный пункт держит порог. Переходы,
              километры и число аппаратов — это цена доступности, а не оценка: они показаны без
              отметки «лучший».
            </p>
          </section>
        </div>

        <div className={s.col}>
        <section>
          <div className={s.head}>
            <h3>Доступность связи по пунктам</h3>
            {cmp.variants.length > 1 && (
              <SegmentedControl
                value={mode}
                onChange={setMode}
                data={[
                  { label: 'значения', value: 'abs' },
                  { label: 'дельты к базе', value: 'delta' },
                ]}
              />
            )}
          </div>
          <Legend items={legendItems(cmp)} />
          <div className={s.chartBox}>
            {mode === 'abs' ? (
              <BarRows
                groups={availGroups}
                max={100}
                target={cmp.targetPct}
                targetLabel={
                  cmp.targetPct === null
                    ? undefined
                    : `целевая доступность ${cmp.targetPct.toFixed(0)} %`
                }
                format={(v) => `${v.toFixed(2)} %`}
                showSeriesLabel
              />
            ) : (
              <DeltaRows
                groups={deltaGroups}
                max={deltaMax}
                format={(v) => `${v.toFixed(2)} п.п.`}
              />
            )}
          </div>
          <p className={s.hint}>
            {mode === 'abs'
              ? 'Шкала полная, от нуля: так разница между очередями запуска видна как есть, без растянутого масштаба. Разницу в доли процента смотрите на дельтах.'
              : 'Ноль — значение базового варианта. Вправо — лучше, влево — хуже; масштаб симметричный.'}
          </p>
          </section>
        </div>
      </div>
    </div>
  )
}

interface Col {
  key: string
  label: string
  get: (v: VariantView) => number | null
  text: (v: VariantView) => string
  /** меньше — лучше */
  lower?: boolean
  /**
   * Показатель не оценочный: короткий маршрут при 12 % доступности не делает
   * вариант лучше, он просто следствие того, что длинных маршрутов не нашлось.
   * Такие столбцы показываем без отметки «лучший».
   */
  neutral?: boolean
}

function Scoreboard({ cmp }: { cmp: Comparison }) {
  const cols: Col[] = [
    {
      key: 'worst',
      label: 'Худший пункт',
      get: (v) => v.agg.worstAvailability,
      text: (v) => `${v.agg.worstAvailability.toFixed(2)} %`,
    },
    {
      key: 'met',
      label: 'В пороге',
      get: (v) => v.agg.targetsMet,
      text: (v) => `${v.agg.targetsMet} / ${v.agg.clientCount}`,
    },
    {
      key: 'avg',
      label: 'Средняя',
      get: (v) => v.agg.avgAvailability,
      text: (v) => `${v.agg.avgAvailability.toFixed(2)} %`,
    },
    {
      key: 'out',
      label: 'Σ без связи',
      get: (v) => v.agg.totalOutageS,
      text: (v) => fmtDurShort(v.agg.totalOutageS),
      lower: true,
    },
    {
      key: 'maxgap',
      label: 'Макс. перерыв',
      get: (v) => v.agg.maxGapS,
      text: (v) => fmtDurShort(v.agg.maxGapS),
      lower: true,
    },
    {
      key: 'gaps',
      label: 'Перерывов',
      get: (v) => v.agg.gapCount,
      text: (v) => String(v.agg.gapCount),
      lower: true,
    },
    {
      key: 'hops',
      label: 'Ср. переходов',
      get: (v) => v.agg.avgHops,
      text: (v) => v.agg.avgHops.toFixed(2),
      neutral: true,
    },
    {
      key: 'km',
      label: 'Ср. длина',
      get: (v) => v.agg.avgKm,
      text: (v) => fmtKm(v.agg.avgKm),
      neutral: true,
    },
    {
      key: 'sats',
      label: 'Аппаратов',
      get: (v) => v.agg.activeSats,
      text: (v) => String(v.agg.activeSats),
      neutral: true,
    },
  ]

  /** id лучшего варианта в столбце; null — все значения равны. */
  const bestIn = (c: Col): string | null => {
    if (c.neutral) return null
    const vals = cmp.variants
      .map((v) => ({ id: v.id, x: c.get(v) }))
      .filter((x): x is { id: string; x: number } => x.x !== null)
    if (vals.length < 2) return null
    const uniq = new Set(vals.map((v) => v.x))
    if (uniq.size === 1) return null
    return vals.reduce((a, b) => ((c.lower ? b.x < a.x : b.x > a.x) ? b : a)).id
  }
  const best = Object.fromEntries(cols.map((c) => [c.key, bestIn(c)]))

  return (
    <div className={s.tableScroll}>
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.sticky}>Вариант</th>
            {cols.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cmp.variants.map((v) => (
            <tr key={v.id} data-best={v.id === cmp.best.id || undefined}>
              <td className={s.sticky}>
                <span className={s.rowName}>
                  <i style={{ background: v.color }} />
                  <b>{v.label}</b>
                  {v.id === cmp.base.id && (
                    <Badge size="xs" variant="light" color="gray">
                      база
                    </Badge>
                  )}
                  {v.id === cmp.best.id && (
                    <Badge size="xs" variant="light" color="green">
                      лучший
                    </Badge>
                  )}
                </span>
              </td>
              {cols.map((c) => (
                <td key={c.key} data-best={best[c.key] === v.id || undefined}>
                  {c.text(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- вкладка «По пунктам» ----------

function Sites({ cmp }: { cmp: Comparison }) {
  return (
    <div className={s.stack}>
      <div className={s.head}>
        <span className={s.legendInline}>
          <i className={s.dotOk} /> связь
          <i className={s.dotBad} /> перерыв
        </span>
      </div>
      <p className={s.hint}>
        Одна и та же суточная сетка у всех вариантов: {cmp.nSteps} отсчётов по {cmp.stepS} с.
        Сравнивать имеет смысл не только долю, но и расположение перерывов — иногда перерыв не
        исчезает, а переезжает на другое время суток. Наведите курсор на участок, клик — переход
        по шкале времени в главном окне.
      </p>

      {cmp.clients.map((c) => {
        const target = cmp.targetPct
        return (
          <section key={c} className={s.siteBlock}>
            <div className={s.head}>
              <h3>
                {c}
                {target !== null && (
                  <span className={s.subtle}> · порог {target.toFixed(0)} %</span>
                )}
              </h3>
            </div>

            <div className={s.stripRows}>
              {cmp.variants.map((v) => {
                const m = v.byClient[c]
                const below = target !== null && (m?.availability ?? 0) < target
                return (
                  <div key={v.id} className={s.stripRow}>
                    <span className={s.stripName}>
                      <i style={{ background: v.color }} />
                      {v.label}
                    </span>
                    <div className={s.stripCell}>
                      <AvailabilityStrip
                        routes={m?.routes}
                        reasons={m?.reasons}
                        stepS={cmp.stepS}
                        height={18}
                      />
                    </div>
                    <span className={s.stripScore} data-below={below || undefined}>
                      {(m?.availability ?? 0).toFixed(2)} %
                    </span>
                    <span className={s.stripNote}>
                      {m
                        ? `${m.gapCount} ${plural(m.gapCount, 'перерыв', 'перерыва', 'перерывов')}, макс ${fmtDurShort(m.maxGapS)}`
                        : '—'}
                    </span>
                  </div>
                )
              })}
              <div className={s.stripAxisRow}>
                {[0, 6, 12, 18, 24].map((h) => (
                  <span key={h}>{h} ч</span>
                ))}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ---------- вкладка «Перерывы» ----------

/** Корзины длительности: один отсчёт, до четырёх, до десяти, дольше. */
const BUCKETS = [
  { key: 'b1', test: (d: number, step: number) => d <= step },
  { key: 'b2', test: (d: number, step: number) => d > step && d <= 4 * step },
  { key: 'b3', test: (d: number, step: number) => d > 4 * step && d <= 10 * step },
  { key: 'b4', test: (d: number, step: number) => d > 10 * step },
]

function Outages({ cmp }: { cmp: Comparison }) {
  const reasonGroups: BarGroup[] = REASONS.map((r) => ({
    key: r,
    label: REASON_LABEL[r],
    bars: bars(
      cmp,
      (v) => v.agg.outageByReason[r] ?? 0,
      (v) => fmtDurShort(v.agg.outageByReason[r] ?? 0),
    ),
  })).filter((g) => g.bars.some((b) => b.value > 0))

  const reasonMax = Math.max(1, ...reasonGroups.flatMap((g) => g.bars.map((b) => b.value)))

  const gapGroups: BarGroup[] = cmp.clients.map((c) => ({
    key: c,
    label: c,
    bars: bars(
      cmp,
      (v) => v.byClient[c]?.maxGapS ?? 0,
      (v) => fmtDurShort(v.byClient[c]?.maxGapS ?? 0),
    ),
  }))
  const gapMax = Math.max(1, ...gapGroups.flatMap((g) => g.bars.map((b) => b.value)))

  const labels = bucketLabels(cmp.stepS)
  const bucketGroups: BarGroup[] = BUCKETS.map((b, i) => ({
    key: b.key,
    label: labels[i],
    bars: bars(
      cmp,
      (v) =>
        cmp.clients.reduce(
          (n, c) =>
            n +
            (v.result.metrics[c]?.gaps ?? []).filter((g) => b.test(g.duration_s, cmp.stepS))
              .length,
          0,
        ),
      undefined,
    ),
  }))
  const bucketMax = Math.max(1, ...bucketGroups.flatMap((g) => g.bars.map((b) => b.value)))

  return (
    <div className={s.stack}>
      <Legend items={legendItems(cmp)} />

      <div className={s.cols}>
        <section className={s.col}>
          <h3>Время без связи по причинам</h3>
          <p className={s.hint}>
            Суммарно по всем наземным пунктам. Причина отвечает на вопрос, что именно чинить:
            «нет видимого спутника» лечится составом и фазированием, «разрыв межспутниковой
            сети» — дальностью ISL, «шлюз не видит аппаратов» — вторым шлюзом.
          </p>
          <div className={s.chartBox}>
            {reasonGroups.length ? (
              <BarRows
                groups={reasonGroups}
                max={reasonMax}
                format={fmtDur}
                showSeriesLabel
              />
            ) : (
              <p className={s.hint}>Перерывов нет ни в одном варианте.</p>
            )}
          </div>

          <h3 style={{ marginTop: '1.4rem' }}>Сколько перерывов какой длины</h3>
          <p className={s.hint}>
            Число перерывов по всем пунктам. Много коротких провалов и один длинный дают одну и
            ту же доступность, но разную пригодность канала.
          </p>
          <div className={s.chartBox}>
            <BarRows
              groups={bucketGroups}
              max={bucketMax}
              format={(v) => `${v}`}
              showSeriesLabel
            />
          </div>
        </section>

        <section className={s.col}>
          <h3>Самый долгий перерыв по пунктам</h3>
          <p className={s.hint}>
            Доля времени не отвечает на вопрос «сколько связи нет подряд». Два варианта с
            одинаковой доступностью различаются тем, набежала она минутными провалами или одним
            получасовым.
          </p>
          <div className={s.chartBox}>
            <BarRows groups={gapGroups} max={gapMax} format={fmtDur} showSeriesLabel />
          </div>
        </section>
      </div>
    </div>
  )
}

// ---------- вкладка «Маршруты» ----------

function Routes({ cmp }: { cmp: Comparison }) {
  const hopKeys = useMemo(() => {
    const set = new Set<string>()
    for (const v of cmp.variants) for (const k of Object.keys(v.agg.hopHistogram)) set.add(k)
    return [...set].sort((a, b) => Number(a) - Number(b))
  }, [cmp])

  const hopGroups: BarGroup[] = hopKeys.map((k) => ({
    key: k,
    label: hopsWord(Number(k)),
    bars: bars(cmp, (v) => v.agg.hopHistogram[k] ?? 0),
  }))
  const hopMax = Math.max(1, ...hopGroups.flatMap((g) => g.bars.map((b) => b.value)))

  const kmGroups: BarGroup[] = cmp.clients.map((c) => ({
    key: c,
    label: c,
    bars: bars(
      cmp,
      (v) => v.byClient[c]?.avgKm ?? 0,
      (v) => fmtKm(v.byClient[c]?.avgKm ?? null),
    ),
  }))
  const kmMax = Math.max(1, ...kmGroups.flatMap((g) => g.bars.map((b) => b.value)))

  const hopsGroups: BarGroup[] = cmp.clients.map((c) => ({
    key: c,
    label: c,
    bars: bars(
      cmp,
      (v) => v.byClient[c]?.avgHops ?? 0,
      (v) => (v.byClient[c]?.avgHops ?? 0).toFixed(2),
    ),
  }))
  const hopsMax = Math.max(1, ...hopsGroups.flatMap((g) => g.bars.map((b) => b.value)))

  return (
    <div className={s.stack}>
      <Legend items={legendItems(cmp)} />
      <p className={s.hint}>
        Характеристики маршрутов — цена доступности. Больше переходов и километров означает
        большую задержку и большее число аппаратов, от которых зависит один канал: маршрут из
        пяти переходов рвётся отказом любого из трёх промежуточных спутников.
      </p>

      <div className={s.cols}>
        <section className={s.col}>
          <h3>Распределение длины маршрута</h3>
          <p className={s.hint}>По оси — число отсчётов, в которых маршрут был такой длины.</p>
          <div className={s.chartBox}>
            <BarRows groups={hopGroups} max={hopMax} format={(v) => `${v}`} showSeriesLabel />
          </div>
        </section>

        <section className={s.col}>
          <h3>Среднее число переходов</h3>
          <div className={s.chartBox}>
            <BarRows
              groups={hopsGroups}
              max={hopsMax}
              format={(v) => v.toFixed(2)}
              showSeriesLabel
            />
          </div>

          <h3 style={{ marginTop: '1.2rem' }}>Средняя длина маршрута</h3>
          <div className={s.chartBox}>
            <BarRows groups={kmGroups} max={kmMax} format={(v) => fmtKm(v)} showSeriesLabel />
          </div>
        </section>
      </div>
    </div>
  )
}

// ---------- вкладка «Параметры» ----------

function Params({ cmp }: { cmp: Comparison }) {
  const [onlyDiff, setOnlyDiff] = useState(true)
  const rows = onlyDiff ? cmp.params.filter((p) => p.differs) : cmp.params

  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const r of rows) map.set(r.group, [...(map.get(r.group) ?? []), r])
    return [...map.entries()]
  }, [rows])

  const diffCount = cmp.params.filter((p) => p.differs).length

  return (
    <div className={s.stack}>
      <div className={s.head}>
        <h3>
          Конфигурации вариантов
          <span className={s.subtle}>
            {' '}
            · отличий {diffCount} из {cmp.params.length}
          </span>
        </h3>
        <Switch
          size="xs"
          checked={onlyDiff}
          onChange={(e) => setOnlyDiff(e.currentTarget.checked)}
          label="только отличия"
        />
      </div>

      {!rows.length ? (
        <p className={s.hint}>
          Конфигурации совпадают по всем сравниваемым параметрам. Если результаты при этом
          различаются — различие в стратегии маршрутизации или в наборе периодов недоступности.
        </p>
      ) : (
        <div className={`${s.tableScroll} ${s.narrow}`}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.sticky}>Параметр</th>
                {cmp.variants.map((v) => (
                  <th key={v.id}>
                    <span className={s.rowName}>
                      <i style={{ background: v.color }} />
                      {v.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map(([group, list]) => (
              <tbody key={group}>
                <tr className={s.groupRow}>
                  <th colSpan={cmp.variants.length + 1}>{group}</th>
                </tr>
                {list.map((p) => (
                  <tr key={p.key} data-diff={p.differs || undefined}>
                    <td className={s.sticky}>{p.label}</td>
                    {p.values.map((val, i) => (
                      <td
                        key={cmp.variants[i].id}
                        data-changed={
                          p.differs && val !== p.values[cmp.variants.indexOf(cmp.base)]
                            ? ''
                            : undefined
                        }
                      >
                        {val}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      <p className={s.hint}>
        Подсвечены значения, отличающиеся от базового варианта «{cmp.base.label}». Это и есть
        ответ на вопрос «что я поменял и что из этого вышло»: показатели того же варианта — на
        вкладке «Обзор».
      </p>
    </div>
  )
}
