import { useMemo } from 'react'
import { ActionIcon, Button, Table } from '@mantine/core'
import { IconBookmark, IconHistory, IconTrash } from '@tabler/icons-react'
import { describeScenario, REASON_LABEL, useProject } from '../stores/project'
import { usePlayback } from '../stores/playback'
import s from './MetricsPanel.module.css'

interface Row {
  client: string
  visibility: number
  availability: number
  maxGap: number
  gaps: number
  avgHops: number
  avgKm: number | null
  /** изменение доступности относительно предыдущего расчёта */
  delta: number | null
}

const fmtGap = (sec: number) =>
  sec >= 3600 ? `${(sec / 3600).toFixed(1)} ч` : `${Math.round(sec / 60)} мин`

export function MetricsPanel() {
  const result = useProject((x) => x.result)
  const previousResult = useProject((x) => x.previousResult)
  const stale = useProject((x) => x.stale)
  const variants = useProject((x) => x.variants)
  const selectedClient = useProject((x) => x.selectedClient)
  const setSelectedClient = useProject((x) => x.setSelectedClient)
  const saveVariant = useProject((x) => x.saveVariant)
  const restoreVariant = useProject((x) => x.restoreVariant)
  const removeVariant = useProject((x) => x.removeVariant)
  const seek = usePlayback((x) => x.seek)

  const rows = useMemo<Row[]>(() => {
    if (!result) return []
    return Object.entries(result.metrics).map(([client, m]) => {
      const before = previousResult?.metrics[client]?.availability_pct
      return {
        client,
        visibility: m.visibility_pct,
        availability: m.availability_pct,
        maxGap: m.max_gap_s,
        gaps: m.gaps?.length ?? 0,
        avgHops: m.hops?.avg ?? 0,
        avgKm: m.avg_path_km,
        delta: before === undefined ? null : m.availability_pct - before,
      }
    })
  }, [result, previousResult])

  /** Сравнение вариантов: дельты доступности относительно первого сохранённого. */
  const compare = useMemo(() => {
    if (variants.length < 2) return null
    const base = variants[0]
    return { base, others: variants.slice(1), clients: Object.keys(base.result.metrics) }
  }, [variants])

  /**
   * Лучший вариант максимизирует результат самого слабого клиентского пункта.
   * Так высокий процент у двух клиентов не скрывает провал у третьего.
   */
  const bestVariantId = useMemo(() => {
    if (variants.length < 2) return null
    return variants.reduce((best, current) =>
      current.result.summary.worst_availability_pct >
      best.result.summary.worst_availability_pct
        ? current
        : best,
    ).id
  }, [variants])

  const gaps = (selectedClient && result?.metrics[selectedClient]?.gaps) || []

  return (
    <div className={s.panel}>
      {result && (
        <section data-stale={stale || undefined} className={s.results}>
          <div className={s.head}>
            <h3>Показатели по пунктам</h3>
            {stale && <span className={s.staleLabel}>Результат требует пересчёта</span>}
          </div>

          <div className={s.tableScroll}>
            <Table highlightOnHover fz="xs" verticalSpacing={4} horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Пункт</Table.Th>
                  <Table.Th>Видимость</Table.Th>
                  <Table.Th>Связь</Table.Th>
                  <Table.Th>Макс. перерыв</Table.Th>
                  <Table.Th>Перерывов</Table.Th>
                  <Table.Th>Хопов</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr
                    key={r.client}
                    className={s.row}
                    data-selected={r.client === selectedClient || undefined}
                    onClick={() => setSelectedClient(r.client)}
                  >
                    <Table.Td className={s.mono}>{r.client}</Table.Td>
                    <Table.Td>{r.visibility.toFixed(2)} %</Table.Td>
                    <Table.Td>
                      {r.availability.toFixed(2)} %
                      {r.delta !== null && Math.abs(r.delta) >= 0.005 && (
                        <span className={r.delta >= 0 ? s.deltaUp : s.deltaDown}>
                          {r.delta > 0 ? '+' : ''}
                          {r.delta.toFixed(2)}
                        </span>
                      )}
                    </Table.Td>
                    <Table.Td>{fmtGap(r.maxGap)}</Table.Td>
                    <Table.Td>{r.gaps}</Table.Td>
                    <Table.Td>{r.avgHops.toFixed(2)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>

          {previousResult && !stale && (
            <p className={s.hint}>Мелким шрифтом — изменение к предыдущему расчёту.</p>
          )}
          <p className={s.hint}>
            Видимость — доля отсчётов, где виден хотя бы один активный аппарат. Связь — доля
            отсчётов, где существует сквозной маршрут до шлюза. Разница между ними и есть суть
            задачи.
          </p>
        </section>
      )}

      {result && selectedClient && (
        <section>
          <h3>Перерывы связи · {selectedClient}</h3>
          {gaps.length ? (
            <div className={s.gaps}>
              {gaps.map((g, i) => (
                <button key={i} className={s.gap} onClick={() => seek(g.start_s)}>
                  <span className={s.mono}>{(g.start_s / 3600).toFixed(2)} ч</span>
                  <span className={s.dur}>{fmtGap(g.duration_s)}</span>
                  <span className={s.reason}>{g.reason ? REASON_LABEL[g.reason] : ''}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className={s.hint}>Перерывов нет</p>
          )}
        </section>
      )}

      <section>
        <div className={s.head}>
          <h3>Сохранённые варианты</h3>
          <Button
            variant="outline"
            leftSection={<IconBookmark size={14} />}
            disabled={!result || stale}
            title={stale ? 'Сначала пересчитайте изменения или отмените их' : undefined}
            onClick={() => saveVariant()}
          >
            Сохранить текущий
          </Button>
        </div>

        {!variants.length ? (
          <p className={s.hint}>Сохраните минимум два варианта, чтобы увидеть сравнение.</p>
        ) : (
          <ul className={s.variants}>
            {variants.map((v) => (
              <li key={v.id}>
                <div className={s.vMain}>
                  <strong>{v.label}</strong>
                  <span className={s.hint}>{describeScenario(v.scenario)}</span>
                </div>
                <span className={s.variantScore}>
                  {bestVariantId === v.id && <small>лучший</small>}
                  {v.result.summary.worst_availability_pct.toFixed(2)} %
                </span>
                <ActionIcon variant="subtle" color="gray" radius="xl" onClick={() => restoreVariant(v.id)}>
                  <IconHistory size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="red" radius="xl" onClick={() => removeVariant(v.id)}>
                  <IconTrash size={14} />
                </ActionIcon>
              </li>
            ))}
          </ul>
        )}
      </section>

      {compare && (
        <section>
          <h3>Сравнение с «{compare.base.label}»</h3>
          <table className={s.cmp}>
            <thead>
              <tr>
                <th>Вариант</th>
                {compare.clients.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={s.base}>{compare.base.label}</td>
                {compare.clients.map((c) => (
                  <td key={c}>
                    {compare.base.result.metrics[c]?.availability_pct.toFixed(2)} %
                  </td>
                ))}
              </tr>
              {compare.others.map((v) => (
                <tr key={v.id}>
                  <td>{v.label}</td>
                  {compare.clients.map((c) => {
                    const m = v.result.metrics[c]
                    if (!m) return <td key={c}>—</td>
                    const delta =
                      m.availability_pct - (compare.base.result.metrics[c]?.availability_pct ?? 0)
                    return (
                      <td key={c}>
                        {m.availability_pct.toFixed(2)} %{' '}
                        <span className={delta >= 0 ? s.ok : s.bad}>({delta.toFixed(2)})</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
