import { useMemo, useState } from 'react'
import { Button, Modal } from '@mantine/core'
import { IconArrowsMaximize, IconBookmark, IconRoute } from '@tabler/icons-react'
import { useProject } from '../stores/project'
import { selectStepIndex, usePlayback } from '../stores/playback'
import { AvailabilityStrip } from './charts/Charts'
import { fmtDurShort, fmtPct, REASONS, REASON_SHORT } from '../lib/viz'
import type { OutageReason } from '../types/api'
import s from './MetricsPanel.module.css'

interface Row {
  client: string
  visibility: number
  availability: number
  maxGap: number
  gapCount: number
  routes: string[][]
  reasons: (OutageReason | null)[]
}

const REASON_COLORS: Record<OutageReason, string> = {
  no_sat: '#d95926',
  isl_break: '#d55181',
  no_gw: '#c98500',
  gw_down: '#9085e9',
}

/** Быстрый инженерный итог с тремя обязательными показателями кейса. */
export function MetricsPanel() {
  const result = useProject((x) => x.result)
  const stale = useProject((x) => x.stale)
  const saveVariant = useProject((x) => x.saveVariant)
  const selectedClient = useProject((x) => x.selectedClient)
  const setSelectedClient = useProject((x) => x.setSelectedClient)
  const stepS = useProject((x) => x.stepS)
  const seek = usePlayback((x) => x.seek)
  const stepIndex = usePlayback(selectStepIndex)
  const [timelineOpen, setTimelineOpen] = useState(false)

  const rows = useMemo<Row[]>(() => {
    if (!result) return []
    return Object.entries(result.metrics)
      .map(([client, metric]) => ({
        client,
        visibility: metric.visibility_pct,
        availability: metric.availability_pct,
        maxGap: metric.max_gap_s,
        gapCount: metric.gaps?.length ?? 0,
        routes: result.routes[client] ?? [],
        reasons: result.reasons?.[client] ?? [],
      }))
      .sort((a, b) => a.availability - b.availability)
  }, [result])

  const worst = rows[0]
  const selected = rows.find((row) => row.client === selectedClient) ?? worst

  if (!worst || !selected) return <p className={s.empty}>Расчёт ещё не выполнен.</p>

  return (
    <>
      <div className={s.panel} data-stale={stale || undefined}>
        {stale && (
          <div className={s.staleBanner}>
            Конфигурация изменена. Пересчитайте её, чтобы обновить результат.
          </div>
        )}

        <section className={s.hero}>
          <span className={s.eyebrow}>Минимальная доступность</span>
          <div className={s.heroValue}>
            {worst.availability.toFixed(2)}<small>%</small>
          </div>
          <div className={s.heroMeta}>
            <strong>{worst.client}</strong>
            <span>самый слабый пункт</span>
          </div>
          <div className={s.heroMeter} aria-label="Минимальная доступность связи">
            <span style={{ width: `${worst.availability}%` }} />
          </div>
        </section>

        <Button
          fullWidth
          variant="light"
          leftSection={<IconBookmark size={15} />}
          disabled={stale}
          title={stale ? 'Сначала пересчитайте изменённую конфигурацию' : undefined}
          onClick={() => saveVariant()}
          className={s.saveButton}
        >
          Сохранить как вариант
        </Button>

        <section>
          <div className={s.sectionHead}>
            <h3>Наземные пункты</h3>
          </div>
          <div className={s.points}>
            {rows.map((row) => (
              <button
                key={row.client}
                type="button"
                className={s.point}
                data-selected={row.client === selected.client || undefined}
                onClick={() => setSelectedClient(row.client)}
                aria-label={`Выбрать пункт ${row.client}`}
              >
                <span className={s.pointHead}>
                  <strong>{row.client}</strong>
                  <span>
                    макс. перерыв <b>{fmtDurShort(row.maxGap)}</b>
                  </span>
                </span>
                <MetricLine label="Видимость" value={row.visibility} />
                <MetricLine label="Доступность" value={row.availability} />
              </button>
            ))}
          </div>
        </section>

        <section className={s.preview}>
          <div className={s.previewHead}>
            <div>
              <span>Связь за сутки</span>
              <strong>{selected.client}</strong>
            </div>
            <button type="button" onClick={() => setTimelineOpen(true)}>
              <IconArrowsMaximize size={14} /> Развернуть
            </button>
          </div>
          <AvailabilityStrip
            routes={selected.routes}
            reasons={selected.reasons}
            stepS={stepS}
            height={14}
            cursorStep={stepIndex}
            onSeek={seek}
          />
          <div className={s.previewMeta}>
            <span>{selected.gapCount} перерывов</span>
            <span>макс. {fmtDurShort(selected.maxGap)}</span>
          </div>
        </section>

        <p className={s.actionHint}>
          <IconRoute size={13} /> «Маршрут» покажет путь и причину разрыва в выбранный момент.
        </p>
      </div>

      <Modal
        opened={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        title="Связь в течение суток"
        size="64rem"
        centered
        classNames={{ body: s.timelineModalBody, header: s.timelineModalHeader }}
      >
        <div className={s.modalIntro}>
          <span>Цвет участка показывает причину отсутствия сквозного пути.</span>
          <div className={s.reasonLegend}>
            <span><i className={s.okSwatch} /> связь</span>
            {REASONS.map((reason) => (
              <span key={reason}>
                <i style={{ background: REASON_COLORS[reason] }} />
                {REASON_SHORT[reason]}
              </span>
            ))}
          </div>
        </div>

        <div className={s.modalRows}>
          {rows.map((row) => (
            <article key={row.client} className={s.modalRow}>
              <header>
                <strong>{row.client}</strong>
                <dl>
                  <div><dt>видимость</dt><dd>{fmtPct(row.visibility)}</dd></div>
                  <div><dt>доступность</dt><dd>{fmtPct(row.availability)}</dd></div>
                  <div><dt>макс. перерыв</dt><dd>{fmtDurShort(row.maxGap)}</dd></div>
                </dl>
              </header>
              <AvailabilityStrip
                routes={row.routes}
                reasons={row.reasons}
                stepS={stepS}
                height={20}
                axis
                cursorStep={stepIndex}
                onSeek={(time) => {
                  setSelectedClient(row.client)
                  seek(time)
                }}
              />
            </article>
          ))}
        </div>
      </Modal>
    </>
  )
}

function MetricLine({ label, value }: {
  label: string
  value: number
}) {
  return (
    <span className={s.metricLine}>
      <span>{label}</span>
      <span className={s.metricTrack}>
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <b>{fmtPct(value)}</b>
    </span>
  )
}
