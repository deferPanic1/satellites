import { useEffect, useMemo } from 'react'
import { ActionIcon, Select, Slider } from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPause,
  IconPlayerPlay,
  IconRotate,
} from '@tabler/icons-react'
import { REASON_LABEL, useProject } from '../stores/project'
import { SPEEDS, formatClock, selectNSteps, selectStepIndex, usePlayback } from '../stores/playback'
import s from './TimelineBar.module.css'

const SPEED_OPTIONS = SPEEDS.map((x) => ({ label: `×${x}`, value: String(x) }))

export function TimelineBar() {
  const result = useProject((x) => x.result)
  const stale = useProject((x) => x.stale)
  const selectedClient = useProject((x) => x.selectedClient)
  const reasonAt = useProject((x) => x.reasonAt)
  const routeAt = useProject((x) => x.routeAt)

  const t = usePlayback((x) => x.t)
  const playing = usePlayback((x) => x.playing)
  const speed = usePlayback((x) => x.speed)
  const stepIndex = usePlayback(selectStepIndex)
  const nSteps = usePlayback(selectNSteps)
  const configure = usePlayback((x) => x.configure)

  useEffect(() => {
    if (result) configure(result.meta.horizon_s, result.meta.step_s)
  }, [result, configure])

  const currentRoute = routeAt(stepIndex)
  const currentReason = reasonAt(stepIndex)

  /**
   * Полоса доступности: для каждого отсчёта — есть маршрут или нет.
   * Рисуем как градиент из сегментов, чтобы не плодить 720 DOM-узлов.
   */
  const stripBackground = useMemo(() => {
    if (!result || !selectedClient) return 'transparent'
    const routes = result.routes[selectedClient]
    if (!routes) return 'transparent'
    const n = routes.length
    const stops: string[] = []
    let runStart = 0
    let runOk = routes[0].length > 0
    const colorOf = (ok: boolean) => (ok ? '#22c55e' : '#ef4444')
    for (let i = 1; i <= n; i++) {
      const ok = i < n ? routes[i].length > 0 : !runOk
      if (ok !== runOk || i === n) {
        const a = ((runStart / n) * 100).toFixed(3)
        const b = ((i / n) * 100).toFixed(3)
        stops.push(`${colorOf(runOk)} ${a}% ${b}%`)
        runStart = i
        runOk = ok
      }
    }
    return `linear-gradient(90deg, ${stops.join(',')})`
  }, [result, selectedClient])

  const { toggle, nudge, reset, seekStep, setSpeed } = usePlayback.getState()

  return (
    <div className={s.timeline}>
      <div className={s.controls}>
        <ActionIcon
          variant="filled"
          radius="xl"
          color={playing ? 'yellow' : 'green'}
          onClick={toggle}
          aria-label={playing ? 'пауза' : 'играть'}
        >
          {playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
        </ActionIcon>
        <ActionIcon variant="subtle" radius="xl" color="gray" onClick={() => nudge(-1)}>
          <IconChevronLeft size={16} />
        </ActionIcon>
        <ActionIcon variant="subtle" radius="xl" color="gray" onClick={() => nudge(1)}>
          <IconChevronRight size={16} />
        </ActionIcon>
        <ActionIcon variant="subtle" radius="xl" color="gray" onClick={reset}>
          <IconRotate size={16} />
        </ActionIcon>
        <Select
          value={String(speed)}
          data={SPEED_OPTIONS}
          allowDeselect={false}
          w="5.5rem"
          ml="0.4rem"
          onChange={(v) => v && setSpeed(Number(v))}
        />
      </div>

      <div className={s.track}>
        <div
          className={s.strip}
          style={{ background: stripBackground, opacity: stale ? 0.15 : undefined }}
        />
        <Slider
          value={stepIndex}
          min={0}
          max={Math.max(0, nSteps - 1)}
          step={1}
          label={null}
          onChange={seekStep}
        />
      </div>

      <div className={s.readout}>
        <span className={s.clock}>{formatClock(t)}</span>
        <span className={s.muted}>
          отсчёт {stepIndex + 1} / {nSteps}
        </span>
        {stale ? (
          <span className={s.muted}>маршрут ждёт пересчёта</span>
        ) : currentRoute ? (
          <span className={s.ok}>
            {currentRoute.length - 1} перех. · {currentRoute.join(' → ')}
          </span>
        ) : currentReason ? (
          <span className={s.bad}>{REASON_LABEL[currentReason]}</span>
        ) : (
          <span className={s.muted}>маршрут не выбран</span>
        )}
      </div>
    </div>
  )
}
