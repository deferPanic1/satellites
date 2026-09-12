import { useMemo } from 'react'
import { Modal, Tooltip } from '@mantine/core'
import { IconTrophy } from '@tabler/icons-react'
import { useProject } from '../stores/project'
import {
  buildComparison,
  type Comparison,
} from '../lib/compare'
import { BarRows, Legend, type BarGroup } from './charts/Charts'
import { fmtDurShort, plural } from '../lib/viz'
import s from './CompareModal.module.css'

export function CompareModal() {
  const open = useProject((x) => x.compareOpen)
  const close = useProject((x) => x.closeCompare)
  const variants = useProject((x) => x.variants)
  const compareIds = useProject((x) => x.compareIds)
  const baseVariantId = useProject((x) => x.baseVariantId)
  const setBaseVariant = useProject((x) => x.setBaseVariant)

  const cmp = useMemo(() => {
    const picked = variants.filter((variant) => compareIds.includes(variant.id))
    return buildComparison(picked, baseVariantId)
  }, [variants, compareIds, baseVariantId])

  return (
    <Modal
      opened={open}
      onClose={close}
      size="64rem"
      centered
      title={
        <span className={s.modalTitle}>
          Сравнение вариантов
          {cmp && (
            <small>
              {cmp.variants.length} {plural(cmp.variants.length, 'вариант', 'варианта', 'вариантов')}
            </small>
          )}
        </span>
      }
      classNames={{ body: s.modalBody, header: s.modalHeader }}
      transitionProps={{ duration: 120 }}
    >
      {!cmp ? (
        <p className={s.empty}>Отметьте минимум два варианта для сравнения.</p>
      ) : (
        <div className={s.wrap}>
          <header className={s.toolbar}>
            <div className={s.basePicker}>
              <span>База</span>
              {cmp.variants.map((variant) => (
                <Tooltip key={variant.id} label="Считать изменения от этого варианта" withArrow>
                  <button
                    type="button"
                    className={s.baseChip}
                    data-base={variant.id === cmp.base.id || undefined}
                    onClick={() => setBaseVariant(variant.id)}
                  >
                    <i style={{ background: variant.color }} />
                    {variant.label}
                  </button>
                </Tooltip>
              ))}
            </div>
          </header>

          <main className={s.content}>
            <section className={s.summary}>
              <IconTrophy size={17} />
              <span>Лучший по минимальной доступности</span>
              <strong>{cmp.best.label}</strong>
              <b>{cmp.best.agg.worstAvailability.toFixed(2)}%</b>
              <small>{cmp.best.agg.worstClient}</small>
            </section>

            <Legend items={legendItems(cmp)} />

            <div className={s.chartsGrid}>
              <MetricChart
                title="Сквозная доступность"
                note="маршрут до шлюза"
                groups={percentageGroups(cmp, 'availability')}
                max={100}
                format={(value) => `${value.toFixed(2)}%`}
              />
              <MetricChart
                title="Видимость спутника"
                note="не гарантирует маршрут"
                groups={percentageGroups(cmp, 'visibility')}
                max={100}
                format={(value) => `${value.toFixed(2)}%`}
              />
              <MetricChart
                title="Максимальный перерыв"
                note="меньше — лучше"
                groups={gapGroups(cmp)}
                max={maxGap(cmp)}
                format={fmtDurShort}
              />
            </div>

            <section className={s.differences}>
              <div className={s.sectionHead}>
                <h3>Изменения относительно «{cmp.base.label}»</h3>
              </div>
              <ChangesTable cmp={cmp} />
            </section>
          </main>
        </div>
      )}
    </Modal>
  )
}

function ChangesTable({ cmp }: { cmp: Comparison }) {
  const rows = cmp.params.filter((param) => param.differs)
  const baseIndex = cmp.variants.findIndex((variant) => variant.id === cmp.base.id)

  if (!rows.length) return <p className={s.same}>Параметры конфигураций совпадают.</p>

  return (
    <div className={s.tableScroll}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Параметр</th>
            {cmp.variants.map((variant) => (
              <th key={variant.id}>
                <span className={s.tableVariant}>
                  <i style={{ background: variant.color }} />
                  {variant.label}
                  {variant.id === cmp.base.id && <small>база</small>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((param) => (
            <tr key={param.key}>
              <td>{param.label}</td>
              {param.values.map((value, index) => (
                <td
                  key={cmp.variants[index].id}
                  data-changed={index !== baseIndex && value !== param.values[baseIndex] ? '' : undefined}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function legendItems(cmp: Comparison) {
  return cmp.variants.map((variant) => ({
    key: variant.id,
    label: variant.label,
    color: variant.color,
    note: variant.id === cmp.base.id ? 'база' : undefined,
  }))
}

function percentageGroups(cmp: Comparison, key: 'availability' | 'visibility'): BarGroup[] {
  return cmp.clients.map((client) => ({
    key: client,
    label: client,
    bars: cmp.variants.map((variant) => ({
      key: variant.id,
      label: variant.label,
      value: variant.byClient[client]?.[key] ?? 0,
      color: variant.color,
    })),
  }))
}

function gapGroups(cmp: Comparison): BarGroup[] {
  return cmp.clients.map((client) => ({
    key: client,
    label: client,
    bars: cmp.variants.map((variant) => ({
      key: variant.id,
      label: variant.label,
      value: variant.byClient[client]?.maxGapS ?? 0,
      color: variant.color,
    })),
  }))
}

function maxGap(cmp: Comparison): number {
  return Math.max(
    cmp.stepS,
    ...cmp.variants.flatMap((variant) =>
      cmp.clients.map((client) => variant.byClient[client]?.maxGapS ?? 0),
    ),
  )
}

function MetricChart({
  title,
  note,
  groups,
  max,
  format,
}: {
  title: string
  note: string
  groups: BarGroup[]
  max: number
  format: (value: number) => string
}) {
  return (
    <section className={s.chartCard}>
      <div className={s.sectionHead}>
        <h3>{title}</h3>
        <span>{note}</span>
      </div>
      <BarRows groups={groups} max={max} format={format} />
    </section>
  )
}
