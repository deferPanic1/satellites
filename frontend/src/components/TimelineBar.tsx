import { useEffect, useMemo } from 'react'
import { ActionIcon, Select, Slider } from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPause,
  IconPlayerPlay,
  IconRotate,
} from '@tabler/icons-react'
import { useProject } from '../stores/project'
import { SPEEDS, formatClock, selectNSteps, selectStepIndex, usePlayback } from '../stores/playback'
import { availabilityGradient } from '../lib/strip'
import s from './TimelineBar.module.css'

const SPEED_OPTIONS = SPEEDS.map((x) => ({ label: `×${x}`, value: String(x) }))

export function TimelineBar() {
  const result = useProject((x) => x.result)
  const stale = useProject((x) => x.stale)
  const selectedClient = useProject((x) => x.selectedClient)

  const t = usePlayback((x) => x.t)
  const playing = usePlayback((x) => x.playing)
  const speed = usePlayback((x) => x.speed)
  const stepIndex = usePlayback(selectStepIndex)
  const nSteps = usePlayback(selectNSteps)
  const configure = usePlayback((x) => x.configure)

  useEffect(() => {
    if (result) configure(result.meta.horizon_s, result.meta.step_s)
  }, [result, configure])

  const stripBackground = useMemo(
    () => (selectedClient ? availabilityGradient(result?.routes[selectedClient]) : 'transparent'),
    [result, selectedClient],
  )

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
      </div>
    </div>
  )
}
